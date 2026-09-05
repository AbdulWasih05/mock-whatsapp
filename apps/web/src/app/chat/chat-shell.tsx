"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { ConversationsResponse } from "@wamock/shared";
import { ConversationList } from "./conversation-list";
import { SignOutButton } from "./sign-out-button";
import { ConnectionPill } from "./connection-pill";

// Two-pane desktop layout, collapsing to one pane below 768px (CLAUDE.md §8):
// the conversation list is root, opening a thread is a full-screen push on
// mobile. The list lives here, in the layout, so it never remounts/refetches
// when navigating between threads — only the right pane content changes.
export function ChatShell(props: { initial: ConversationsResponse; currentUserId: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isListRoot = pathname === "/chat";
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [conversations, setConversations] = useState(props.initial);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSwitcherOpen(true);
      }
      if (e.key === "Escape") setSwitcherOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex flex-1 min-h-0">
      <div
        className={`${isListRoot ? "flex" : "hidden"} md:flex w-full md:w-[380px] md:min-w-[380px] md:border-r md:border-border flex-col min-h-0`}
      >
        <div className="flex items-center justify-between px-5 h-16 min-h-16 border-b border-border">
          <h1 className="text-base font-medium">Chats</h1>
          <SignOutButton />
        </div>
        <ConversationList initial={conversations} currentUserId={props.currentUserId} onSync={setConversations} />
      </div>

      <div className={`${isListRoot ? "hidden" : "flex"} md:flex flex-1 min-h-0 flex-col`}>{props.children}</div>

      <ConnectionPill />

      {switcherOpen && (
        <SwitcherModal
          conversations={conversations}
          onClose={() => setSwitcherOpen(false)}
          onSelect={(id) => {
            setSwitcherOpen(false);
            router.push(`/chat/${id}`);
          }}
        />
      )}
    </div>
  );
}

function SwitcherModal(props: {
  conversations: ConversationsResponse;
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => props.conversations.filter((c) => c.otherMember.name.toLowerCase().includes(query.toLowerCase())),
    [props.conversations, query],
  );

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 pt-32" onClick={props.onClose}>
      <div
        className="w-full max-w-md rounded-xl border border-border bg-background shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && filtered[0]) props.onSelect(filtered[0].id);
          }}
          placeholder="Jump to a conversation…"
          className="w-full border-b border-border px-4 py-3 text-sm outline-none"
        />
        <ul className="max-h-72 overflow-y-auto py-1">
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => props.onSelect(c.id)}
                className="flex w-full items-center px-4 py-2 text-left text-sm hover:bg-surface focus-visible:bg-surface"
              >
                {c.otherMember.name}
              </button>
            </li>
          ))}
          {filtered.length === 0 && <li className="px-4 py-3 text-sm text-muted">No matches</li>}
        </ul>
      </div>
    </div>
  );
}
