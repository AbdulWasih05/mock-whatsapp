import { NextResponse } from "next/server";
import { GetMessagesQuerySchema, encodeCursor, decodeCursor, type GetMessagesResponse } from "@wamock/shared";
import { requireUserId } from "@/server/auth";
import { requireMembership } from "@/server/membership";
import { prisma } from "@/server/db";
import { serializeMessage } from "@/server/serialize";
import { errorResponse } from "@/server/http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: conversationId } = await params;
    const userId = await requireUserId();
    await requireMembership(userId, conversationId);

    const url = new URL(request.url);
    const { cursor, after, limit } = GetMessagesQuerySchema.parse({
      cursor: url.searchParams.get("cursor") ?? undefined,
      after: url.searchParams.get("after") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });

    // Gap-fill mode: everything newer than `after`, oldest-first internally
    // so a bounded page always starts at the gap's beginning and stays
    // contiguous, then reversed to the newest-first response shape the
    // client already handles.
    if (after) {
      const decodedAfter = decodeCursor(after);
      const rows = await prisma.message.findMany({
        where: {
          conversationId,
          ...(decodedAfter
            ? {
                OR: [
                  { createdAt: { gt: decodedAfter.createdAt } },
                  { createdAt: decodedAfter.createdAt, id: { gt: decodedAfter.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit + 1,
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const newest = page.at(-1);

      const response: GetMessagesResponse = {
        messages: await Promise.all([...page].reverse().map(serializeMessage)),
        nextCursor: hasMore && newest ? encodeCursor(newest.createdAt, newest.id) : null,
        hasMore,
      };
      return NextResponse.json(response);
    }

    const decoded = cursor ? decodeCursor(cursor) : null;

    const rows = await prisma.message.findMany({
      where: {
        conversationId,
        ...(decoded
          ? {
              OR: [
                { createdAt: { lt: decoded.createdAt } },
                { createdAt: decoded.createdAt, id: { lt: decoded.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1, // +1 sentinel to compute hasMore
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    const nextCursor = hasMore && last ? encodeCursor(last.createdAt, last.id) : null;

    const response: GetMessagesResponse = {
      messages: await Promise.all(page.map(serializeMessage)),
      nextCursor,
      hasMore,
    };

    return NextResponse.json(response);
  } catch (err) {
    return errorResponse(err);
  }
}
