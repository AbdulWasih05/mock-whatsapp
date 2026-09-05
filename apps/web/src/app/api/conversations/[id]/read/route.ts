import { NextResponse } from "next/server";
import { MarkReadRequestSchema, ApiError, type MarkReadResponse } from "@wamock/shared";
import { requireUserId } from "@/server/auth";
import { requireMembership } from "@/server/membership";
import { prisma } from "@/server/db";
import { fanout } from "@/server/fanout";
import { errorResponse } from "@/server/http";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: conversationId } = await params;
    const userId = await requireUserId();
    await requireMembership(userId, conversationId);

    const { lastReadMessageId } = MarkReadRequestSchema.parse(await request.json());

    const message = await prisma.message.findFirst({
      where: { id: lastReadMessageId, conversationId },
    });
    if (!message) throw new ApiError("VALIDATION_FAILED", "lastReadMessageId does not belong to this conversation");

    const lastReadAt = new Date();
    await prisma.membership.update({
      where: { userId_conversationId: { userId, conversationId } },
      data: { lastReadMessageId, lastReadAt },
    });

    // Fan out to the conversation (so the sender sees the tick flip) and to
    // the reader's own `user:` room (so their other open tabs stay in sync).
    void fanout({
      event: "message:read",
      rooms: [conversationId, `user:${userId}`],
      payload: { conversationId, userId, lastReadMessageId },
    });

    const response: MarkReadResponse = {
      conversationId,
      lastReadMessageId,
      lastReadAt: lastReadAt.toISOString(),
    };
    return NextResponse.json(response);
  } catch (err) {
    return errorResponse(err);
  }
}
