import { redirect } from "next/navigation";
import { getSessionUserId } from "@/server/auth";
import { listConversationsForUser } from "@/server/conversations";
import { SocketProvider } from "./socket-provider";
import { ChatShell } from "./chat-shell";

export default async function ChatLayout({ children }: { children: React.ReactNode }) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/");

  const conversations = await listConversationsForUser(userId);

  return (
    <SocketProvider>
      <ChatShell initial={conversations} currentUserId={userId}>
        {children}
      </ChatShell>
    </SocketProvider>
  );
}
