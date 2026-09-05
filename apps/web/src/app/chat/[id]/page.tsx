import { notFound, redirect } from "next/navigation";
import { getSessionUserId } from "@/server/auth";
import { prisma } from "@/server/db";
import { ThreadView } from "./thread-view";

export default async function ThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: conversationId } = await params;
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const membership = await prisma.membership.findUnique({
    where: { userId_conversationId: { userId, conversationId } },
    include: {
      conversation: {
        include: { members: { include: { user: true } } },
      },
    },
  });
  if (!membership) notFound();

  const otherMembership = membership.conversation.members.find((m) => m.userId !== userId);
  const otherMember = otherMembership?.user;

  return (
    <ThreadView
      conversationId={conversationId}
      currentUserId={userId}
      otherMemberId={otherMember?.id ?? "unknown"}
      otherMemberName={otherMember?.name ?? "Unknown"}
      otherReadMessageId={otherMembership?.lastReadMessageId ?? null}
    />
  );
}
