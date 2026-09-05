import { NextResponse } from "next/server";
import { requireUserId, signSocketToken } from "@/server/auth";
import { prisma } from "@/server/db";
import { errorResponse } from "@/server/http";

// Short-lived token used only to authenticate the socket handshake — never
// stored as a cookie, refetched on every (re)connect by the client.
export async function GET() {
  try {
    const userId = await requireUserId();
    const memberships = await prisma.membership.findMany({ where: { userId }, select: { conversationId: true } });
    const token = await signSocketToken(
      userId,
      memberships.map((m) => m.conversationId),
    );
    return NextResponse.json({ token });
  } catch (err) {
    return errorResponse(err);
  }
}
