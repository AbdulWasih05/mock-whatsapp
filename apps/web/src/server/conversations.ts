import "server-only";
import type { ConversationsResponse } from "@wamock/shared";
import { prisma } from "./db";
import { serializeMessage } from "./serialize";

// Shared by the GET /api/conversations route handler and the server-rendered
// conversation list, so the two never drift.
export async function listConversationsForUser(userId: string): Promise<ConversationsResponse> {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: {
      conversation: {
        include: {
          members: { include: { user: true } },
          messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
        },
      },
    },
    orderBy: { conversation: { lastMessageAt: "desc" } },
  });

  return Promise.all(
    memberships.map(async (m) => {
      const conversation = m.conversation;
      const otherMembership = conversation.members.find((mem) => mem.userId !== userId);
      const otherUser = otherMembership?.user;
      const lastMessageRow = conversation.messages[0] ?? null;

      // Served by the same (conversationId, createdAt desc, id desc) index
      // used for paging (CLAUDE.md §3).
      const unreadCount = await prisma.message.count({
        where: {
          conversationId: conversation.id,
          senderId: { not: userId },
          createdAt: { gt: m.lastReadAt ?? new Date(0) },
        },
      });

      return {
        id: conversation.id,
        otherMember: otherUser
          ? { id: otherUser.id, name: otherUser.name, avatarUrl: otherUser.avatarUrl }
          : { id: "unknown", name: "Unknown", avatarUrl: null },
        lastMessage: lastMessageRow ? await serializeMessage(lastMessageRow) : null,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
        unreadCount,
      };
    }),
  );
}
