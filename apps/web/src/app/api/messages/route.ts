import { NextResponse } from "next/server";
import { SendMessageRequestSchema, ApiError, type SendMessageResponse } from "@wamock/shared";
import { requireUserId } from "@/server/auth";
import { requireMembership } from "@/server/membership";
import { prisma } from "@/server/db";
import { serializeMessage } from "@/server/serialize";
import { checkProfanity } from "@/server/moderation";
import { processQuarantinedImage } from "@/server/image-pipeline";
import { checkRateLimit } from "@/server/rate-limit";
import { fanout } from "@/server/fanout";
import { errorResponse } from "@/server/http";

// The chokepoint from CLAUDE.md §2. Every write to the Message table goes
// through here — the socket is read-only and never accepts writes.
export async function POST(request: Request) {
  try {
    // 1. session auth
    const userId = await requireUserId();

    const body = SendMessageRequestSchema.parse(await request.json());

    // 2. conversation membership check
    await requireMembership(userId, body.conversationId);

    // A retry (same conversationId + clientMsgId) is a pure lookup — rate
    // limiting, profanity, and the image pipeline only ever run once per
    // logical message. Re-running the image pipeline on a retry would also
    // break: the quarantine object it reads is deleted (moved to media/ or
    // rejected) after the first attempt.
    const existing = await prisma.message.findUnique({
      where: { conversationId_clientMsgId: { conversationId: body.conversationId, clientMsgId: body.clientMsgId } },
    });
    if (existing) {
      const response: SendMessageResponse = await serializeMessage(existing);
      return NextResponse.json(response, { status: 200 });
    }

    // 3. rate limit
    const rate = checkRateLimit(userId, "send");
    if (rate.limited) throw new ApiError("RATE_LIMITED", "Too many messages, slow down");

    // 4. profanity normalize + block
    if (body.type === "TEXT" && body.body) {
      const profanity = checkProfanity(body.body);
      if (profanity.blocked) {
        throw new ApiError("PROFANITY_BLOCKED", "Message blocked by content filter", {
          matchedTerm: profanity.matchedTerm,
        });
      }
    }

    // 5. image moderation gate (if media). Uses the FINAL media/ key below,
    // never the client-supplied quarantine key — CLAUDE.md §6: no row is
    // ever created for an unsafe or invalid-type upload.
    let mediaKey: string | null = null;
    let width: number | null = null;
    let height: number | null = null;
    if (body.type === "IMAGE" && body.mediaKey) {
      const uploadRate = checkRateLimit(userId, "upload");
      if (uploadRate.limited) throw new ApiError("RATE_LIMITED", "Too many image uploads, slow down");

      const result = await processQuarantinedImage(body.mediaKey);
      if (!result.ok) {
        if (result.code === "INVALID_FILE_TYPE") {
          throw new ApiError("INVALID_FILE_TYPE", "Uploaded file is not a valid image");
        }
        throw new ApiError("IMAGE_REJECTED", "Image blocked by content filter", { reason: result.reason });
      }
      mediaKey = result.mediaKey;
      width = result.width;
      height = result.height;
    }

    // GIF/STICKER dimensions come from the (trusted, server-owned) local
    // pack via the client request — unlike IMAGE, there's no upload to
    // verify server-side, so the declared size is simply used as-is.
    if (body.type === "GIF" || body.type === "STICKER") {
      width = body.width ?? null;
      height = body.height ?? null;
    }

    // 6. insert. Idempotency for a genuinely concurrent double-submit (not
    // a sequential retry, which was already handled above) still falls back
    // to a unique-constraint race — see the P2002 catch.
    let message;
    try {
      message = await prisma.message.create({
        data: {
          conversationId: body.conversationId,
          senderId: userId,
          clientMsgId: body.clientMsgId,
          type: body.type,
          body: body.body ?? null,
          mediaKey,
          width,
          height,
        },
      });
    } catch (err) {
      const isUniqueViolation =
        err instanceof Error && "code" in err && (err as { code?: string }).code === "P2002";
      if (!isUniqueViolation) throw err;
      message = await prisma.message.findUniqueOrThrow({
        where: { conversationId_clientMsgId: { conversationId: body.conversationId, clientMsgId: body.clientMsgId } },
      });
      const response: SendMessageResponse = await serializeMessage(message);
      return NextResponse.json(response, { status: 200 });
    }

    await prisma.conversation.update({
      where: { id: body.conversationId },
      data: { lastMessageAt: message.createdAt },
    });

    // 7. internal POST -> WS service fanout. The socket is read-only; this
    // is the only path that ever produces a "message:new" event.
    const serialized = await serializeMessage(message);
    void fanout({ event: "message:new", room: body.conversationId, payload: serialized });

    const response: SendMessageResponse = serialized;
    return NextResponse.json(response, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
