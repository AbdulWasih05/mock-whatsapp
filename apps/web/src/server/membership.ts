import "server-only";
import { ApiError } from "@wamock/shared";
import { prisma } from "./db";

// Every route that touches a conversation goes through this — the single
// place membership is checked, so the 403 is guaranteed rather than
// re-derived per-route (CLAUDE.md §7).
export async function requireMembership(userId: string, conversationId: string) {
  const membership = await prisma.membership.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
  });
  if (!membership) throw new ApiError("NOT_A_MEMBER", "You are not a member of this conversation");
  return membership;
}
