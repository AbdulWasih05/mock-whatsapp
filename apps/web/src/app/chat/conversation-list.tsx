"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import type { ConversationsResponse, MessageNewEvent, MessageReadEvent } from "@wamock/shared";
import { useSocket } from "./socket-provider";
import { formatListTimestamp } from "@/lib/format";
import { Avatar } from "./avatar";

// Server-rendered initial list, then live-patched over the socket so a new
// message or a read on another tab updates this list with no refresh.
export function ConversationList(props: {
  initial: ConversationsResponse;
  currentUserId: string;
  onSync?: (conversations: ConversationsResponse) => void;
}) {
  const { initial, currentUserId, onSync } = props;
  const { socket, presence } = useSocket();
  const [conversations, setConversations] = useState(initial);
  const pathname = usePathname();

  useEffect(() => {
    onSync?.(conversations);
  }, [conversations, onSync]);

  useEffect(() => {
    if (!socket) return;

    function onMessageNew(payload: MessageNewEvent) {
      setConversations((prev) => {
        const next = prev.map((c) =>
          c.id === payload.conversationId
            ? {
                ...c,
                lastMessage: payload,
                lastMessageAt: payload.createdAt,
                unreadCount: payload.senderId === currentUserId ? c.unreadCount : c.unreadCount + 1,
              }
            : c,
        );
        return [...next].sort((a, b) => (a.lastMessageAt < b.lastMessageAt ? 1 : -1));
      });
    }

    function onMessageRead(payload: MessageReadEvent) {
      if (payload.userId !== currentUserId) return;
      setConversations((prev) => prev.map((c) => (c.id === payload.conversationId ? { ...c, unreadCount: 0 } : c)));
    }

    socket.on("message:new", onMessageNew);
    socket.on("message:read", onMessageRead);
    return () => {
      socket.off("message:new", onMessageNew);
      socket.off("message:read", onMessageRead);
    };
  }, [socket, currentUserId]);

  if (conversations.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm font-medium">No conversations yet</p>
        <p className="text-sm text-muted">Messages you send and receive will show up here.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-1 flex-col overflow-y-auto">
      {conversations.map((c) => {
        const isOnline = presence[c.otherMember.id]?.status === "online";
        const isActive = pathname === `/chat/${c.id}`;
        const preview =
          c.lastMessage?.type === "TEXT" || !c.lastMessage
            ? (c.lastMessage?.body ?? "No messages yet")
            : `${c.lastMessage.type === "IMAGE" ? "Photo" : c.lastMessage.type === "GIF" ? "GIF" : "Sticker"}`;

        return (
          <li key={c.id}>
            <Link
              href={`/chat/${c.id}`}
              className={`flex items-center gap-3 px-5 py-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2 ${
                isActive ? "bg-surface" : "hover:bg-surface"
              }`}
            >
              <Avatar name={c.otherMember.name} online={isOnline} size={44} />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-medium">{c.otherMember.name}</span>
                  <span className="shrink-0 text-xs text-muted-2">{formatListTimestamp(c.lastMessageAt)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-muted">{preview}</span>
                  {c.unreadCount > 0 && (
                    <span className="flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-foreground px-1.5 text-[11px] font-semibold text-background">
                      {c.unreadCount > 99 ? "99+" : c.unreadCount}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
