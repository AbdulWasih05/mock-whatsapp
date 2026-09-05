"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { ulid } from "ulid";
import type { MessageNewEvent, MessageReadEvent, SerializedMessage, TypingServerEvent } from "@wamock/shared";
import { ALLOWED_IMAGE_CONTENT_TYPES, MAX_IMAGE_BYTES, encodeCursor } from "@wamock/shared";
import { api, ClientApiError, uploadToPresignedUrl } from "@/lib/api";
import { useSocket } from "../socket-provider";
import { Avatar } from "../avatar";
import { formatBubbleTime, formatDayDivider } from "@/lib/format";
import type { PickerAsset } from "@/lib/picker-assets";
import { Ticks, type TickStatus } from "./ticks";
import { Picker } from "./picker";

type LocalStatus = "sending" | "sent" | "delivered" | "failed" | "checking" | "blocked";
type ChatMessage = SerializedMessage & { localStatus: LocalStatus; localPreviewUrl?: string; blockReason?: string };

const TYPING_EMIT_THROTTLE_MS = 3000;
const TYPING_IDLE_STOP_MS = 2000;
const TYPING_RECEIVER_TTL_MS = 5000;
const GROUP_WINDOW_MS = 5 * 60 * 1000;
const NEAR_BOTTOM_PX = 100;

const SKELETON_WIDTHS = [180, 240, 140, 200, 260, 160];

export function ThreadView(props: {
  conversationId: string;
  currentUserId: string;
  otherMemberId: string;
  otherMemberName: string;
  otherReadMessageId: string | null;
}) {
  const { conversationId, currentUserId, otherMemberId, otherMemberName } = props;
  const { socket, presence } = useSocket();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [input, setInput] = useState("");
  const [otherTyping, setOtherTyping] = useState(false);
  const [otherReadMessageId, setOtherReadMessageId] = useState(props.otherReadMessageId);
  const [pillCount, setPillCount] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingScrollRestore = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const typingTtlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const lastEmitAt = useRef(0);
  const idleStopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFiles = useRef(new Map<string, File>());
  // Mirrors `messages` so socket callbacks can read the latest list without
  // re-subscribing on every state change (and without stale closures).
  const messagesRef = useRef<ChatMessage[]>([]);
  const hasLoadedRef = useRef(false);

  function isNearBottom(): boolean {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }

  function scrollToBottom() {
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Merge a fetched page into the thread by message id — the same
  // reconciliation the socket path uses, so a message arriving twice (live
  // event *and* gap-fill) still lands exactly once (CLAUDE.md §5).
  function mergeMessages(incoming: ChatMessage[]) {
    if (incoming.length === 0) return;
    setMessages((prev) => {
      const byId = new Map(prev.map((m) => [m.id, m]));
      let changed = false;
      for (const m of incoming) {
        if (byId.has(m.id)) continue;
        byId.set(m.id, m);
        changed = true;
      }
      if (!changed) return prev;
      return [...byId.values()].sort((a, b) =>
        a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt),
      );
    });
  }

  // Initial load + mark-read.
  useEffect(() => {
    let cancelled = false;
    setInitialLoading(true);
    hasLoadedRef.current = false;
    (async () => {
      const page = await api.getMessages(conversationId);
      if (cancelled) return;
      const ascending = [...page.messages].reverse().map((m) => ({ ...m, localStatus: "sent" as const }));
      setMessages(ascending);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
      setInitialLoading(false);
      hasLoadedRef.current = true;

      const newest = ascending.at(-1);
      if (newest) void api.markRead(conversationId, newest.id);

      scrollToBottom();
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId]);

  // Reconnect gap-fill: after a drop, pull everything newer than the
  // highest message we already have, over HTTP — history is never replayed
  // through the socket (CLAUDE.md §5).
  useEffect(() => {
    if (!socket) return;

    async function fillGap() {
      if (!hasLoadedRef.current) return;
      const newest = messagesRef.current.filter((m) => !m.id.startsWith("optimistic-")).at(-1);
      if (!newest) return;

      let after = encodeCursor(newest.createdAt, newest.id);
      for (let guard = 0; guard < 50; guard++) {
        const page = await api.getMessages(conversationId, { after });
        if (page.messages.length === 0) return;

        const ascending = [...page.messages].reverse().map((m) => ({ ...m, localStatus: "sent" as const }));
        mergeMessages(ascending);

        const newestInPage = ascending.at(-1);
        if (!newestInPage || !page.hasMore) {
          if (newestInPage) void api.markRead(conversationId, newestInPage.id);
          return;
        }
        after = encodeCursor(newestInPage.createdAt, newestInPage.id);
      }
    }

    socket.on("connect", fillGap);
    return () => {
      socket.off("connect", fillGap);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, conversationId]);

  // Socket listeners: message:new / message:read / typing:*.
  useEffect(() => {
    if (!socket) return;

    function onMessageNew(payload: MessageNewEvent) {
      if (payload.conversationId !== conversationId) return;
      const fromOther = payload.senderId !== currentUserId;
      const nearBottom = isNearBottom();

      setMessages((prev) => {
        if (prev.some((m) => m.id === payload.id)) return prev;
        const existingIndex = prev.findIndex((m) => m.clientMsgId === payload.clientMsgId);
        if (existingIndex !== -1) {
          const next = [...prev];
          next[existingIndex] = { ...payload, localStatus: next[existingIndex]!.localStatus };
          return next;
        }
        return [...prev, { ...payload, localStatus: "sent" }];
      });

      if (fromOther) {
        if (nearBottom) {
          void api.markRead(conversationId, payload.id);
          scrollToBottom();
        } else {
          setPillCount((n) => n + 1);
        }
      }
    }

    function onMessageRead(payload: MessageReadEvent) {
      if (payload.conversationId !== conversationId) return;
      if (payload.userId === otherMemberId) setOtherReadMessageId(payload.lastReadMessageId);
    }

    function onTypingStart(payload: TypingServerEvent) {
      if (payload.conversationId !== conversationId || payload.userId === currentUserId) return;
      setOtherTyping(true);
      if (typingTtlTimer.current) clearTimeout(typingTtlTimer.current);
      typingTtlTimer.current = setTimeout(() => setOtherTyping(false), TYPING_RECEIVER_TTL_MS);
    }

    function onTypingStop(payload: TypingServerEvent) {
      if (payload.conversationId !== conversationId || payload.userId === currentUserId) return;
      if (typingTtlTimer.current) clearTimeout(typingTtlTimer.current);
      setOtherTyping(false);
    }

    socket.on("message:new", onMessageNew);
    socket.on("message:read", onMessageRead);
    socket.on("typing:start", onTypingStart);
    socket.on("typing:stop", onTypingStop);
    return () => {
      socket.off("message:new", onMessageNew);
      socket.off("message:read", onMessageRead);
      socket.off("typing:start", onTypingStart);
      socket.off("typing:stop", onTypingStop);
      if (typingTtlTimer.current) clearTimeout(typingTtlTimer.current);
    };
  }, [socket, conversationId, currentUserId, otherMemberId]);

  // Restore scroll position after prepending an older page so the viewport
  // doesn't jump (CLAUDE.md §8 — "non-optional").
  useLayoutEffect(() => {
    const el = containerRef.current;
    const pending = pendingScrollRestore.current;
    if (el && pending) {
      el.scrollTop = el.scrollHeight - pending.scrollHeight + pending.scrollTop;
      pendingScrollRestore.current = null;
    }
  }, [messages]);

  async function loadOlder() {
    if (!hasMore || loadingOlder || !cursor) return;
    const el = containerRef.current;
    setLoadingOlder(true);
    try {
      const page = await api.getMessages(conversationId, { cursor });
      const olderAscending = [...page.messages].reverse().map((m) => ({ ...m, localStatus: "sent" as const }));
      if (el) pendingScrollRestore.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop };
      setMessages((prev) => [...olderAscending, ...prev]);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } finally {
      setLoadingOlder(false);
    }
  }

  function onScroll() {
    const el = containerRef.current;
    if (el && el.scrollTop < 100) void loadOlder();
    if (pillCount > 0 && isNearBottom()) {
      setPillCount(0);
      const newest = messages.at(-1);
      if (newest) void api.markRead(conversationId, newest.id);
    }
  }

  function dismissPill() {
    setPillCount(0);
    scrollToBottom();
    const newest = messages.at(-1);
    if (newest) void api.markRead(conversationId, newest.id);
  }

  function stopTyping() {
    if (idleStopTimer.current) clearTimeout(idleStopTimer.current);
    if (isTypingRef.current) {
      isTypingRef.current = false;
      socket?.emit("typing:stop", { conversationId });
    }
  }

  function onComposerChange(value: string) {
    setInput(value);
    if (!socket) return;

    if (idleStopTimer.current) clearTimeout(idleStopTimer.current);
    idleStopTimer.current = setTimeout(stopTyping, TYPING_IDLE_STOP_MS);

    const now = Date.now();
    if (!isTypingRef.current || now - lastEmitAt.current > TYPING_EMIT_THROTTLE_MS) {
      socket.emit("typing:start", { conversationId });
      isTypingRef.current = true;
      lastEmitAt.current = now;
    }
  }

  async function submitText(clientMsgId: string, body: string) {
    try {
      const saved = await api.sendMessage({ conversationId, clientMsgId, type: "TEXT", body });
      const delivered = presence[otherMemberId]?.status === "online";
      setMessages((prev) =>
        prev.map((m) => (m.clientMsgId === clientMsgId ? { ...saved, localStatus: delivered ? "delivered" : "sent" } : m)),
      );
    } catch {
      setMessages((prev) => prev.map((m) => (m.clientMsgId === clientMsgId ? { ...m, localStatus: "failed" } : m)));
    }
  }

  async function send() {
    const text = input.trim();
    if (!text) return;
    setInput("");
    stopTyping();

    const clientMsgId = ulid();
    const optimistic: ChatMessage = {
      id: `optimistic-${clientMsgId}`,
      conversationId,
      senderId: currentUserId,
      clientMsgId,
      type: "TEXT",
      body: text,
      mediaUrl: null,
      width: null,
      height: null,
      createdAt: new Date().toISOString(),
      localStatus: "sending",
    };
    setMessages((prev) => [...prev, optimistic]);
    scrollToBottom();
    await submitText(clientMsgId, text);
  }

  async function retryText(message: ChatMessage) {
    setMessages((prev) => prev.map((m) => (m.clientMsgId === message.clientMsgId ? { ...m, localStatus: "sending" } : m)));
    await submitText(message.clientMsgId, message.body ?? "");
  }

  // Image pending → local blob under a blur with "Checking image…"; the
  // moderation round trip becomes a visible feature, not a silent wait
  // (CLAUDE.md §8).
  async function submitImage(clientMsgId: string, file: File) {
    try {
      const presign = await api.presignUpload({ contentType: file.type as (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number], contentLength: file.size });
      await uploadToPresignedUrl(presign.uploadUrl, file);
      const saved = await api.sendMessage({ conversationId, clientMsgId, type: "IMAGE", mediaKey: presign.key });
      const delivered = presence[otherMemberId]?.status === "online";
      setMessages((prev) =>
        prev.map((m) => (m.clientMsgId === clientMsgId ? { ...saved, localStatus: delivered ? "delivered" : "sent" } : m)),
      );
      pendingFiles.current.delete(clientMsgId);
    } catch (err) {
      if (err instanceof ClientApiError && err.code === "IMAGE_REJECTED") {
        setMessages((prev) =>
          prev.map((m) => (m.clientMsgId === clientMsgId ? { ...m, localStatus: "blocked", blockReason: err.message } : m)),
        );
      } else {
        setMessages((prev) => prev.map((m) => (m.clientMsgId === clientMsgId ? { ...m, localStatus: "failed" } : m)));
      }
    }
  }

  function onPickImage(file: File | undefined) {
    if (!file) return;
    if (!ALLOWED_IMAGE_CONTENT_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_CONTENT_TYPES)[number])) return;
    if (file.size > MAX_IMAGE_BYTES) return;

    const clientMsgId = ulid();
    pendingFiles.current.set(clientMsgId, file);

    const optimistic: ChatMessage = {
      id: `optimistic-${clientMsgId}`,
      conversationId,
      senderId: currentUserId,
      clientMsgId,
      type: "IMAGE",
      body: null,
      mediaUrl: null,
      width: null,
      height: null,
      createdAt: new Date().toISOString(),
      localStatus: "checking",
      localPreviewUrl: URL.createObjectURL(file),
    };
    setMessages((prev) => [...prev, optimistic]);
    scrollToBottom();
    void submitImage(clientMsgId, file);
  }

  function removeMessage(clientMsgId: string) {
    setMessages((prev) => prev.filter((m) => m.clientMsgId !== clientMsgId));
    pendingFiles.current.delete(clientMsgId);
  }

  // GIF/STICKER sends skip the moderation chokepoint steps that only apply
  // to user-generated TEXT/IMAGE content (CLAUDE.md §2) — the asset comes
  // from a curated local pack, not an upload. Dimensions are known up
  // front, so the bubble never reflows once the image loads.
  async function sendAsset(asset: PickerAsset, type: "GIF" | "STICKER") {
    setPickerOpen(false);
    const clientMsgId = ulid();
    const optimistic: ChatMessage = {
      id: `optimistic-${clientMsgId}`,
      conversationId,
      senderId: currentUserId,
      clientMsgId,
      type,
      body: asset.url,
      mediaUrl: null,
      width: asset.width,
      height: asset.height,
      createdAt: new Date().toISOString(),
      localStatus: "sending",
    };
    setMessages((prev) => [...prev, optimistic]);
    scrollToBottom();
    try {
      const saved = await api.sendMessage({
        conversationId,
        clientMsgId,
        type,
        body: asset.url,
        width: asset.width,
        height: asset.height,
      });
      const delivered = presence[otherMemberId]?.status === "online";
      setMessages((prev) =>
        prev.map((m) => (m.clientMsgId === clientMsgId ? { ...saved, localStatus: delivered ? "delivered" : "sent" } : m)),
      );
    } catch {
      setMessages((prev) => prev.map((m) => (m.clientMsgId === clientMsgId ? { ...m, localStatus: "failed" } : m)));
    }
  }

  function pickEmoji(emoji: string) {
    setInput((prev) => prev + emoji);
  }

  const readBoundaryIndex = otherReadMessageId ? messages.findIndex((m) => m.id === otherReadMessageId) : -1;
  const otherPresence = presence[otherMemberId];
  const isOnline = otherPresence?.status === "online";

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex h-16 min-h-16 items-center gap-3 border-b border-border px-4 md:px-6">
        <Link
          href="/chat"
          className="rounded-md p-1 text-muted md:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          aria-label="Back to chats"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12.5 4L6.5 10L12.5 16" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
        <Avatar name={otherMemberName} online={isOnline} size={36} />
        <div className="flex flex-col">
          <span className="font-medium leading-tight">{otherMemberName}</span>
          <span className="text-xs leading-tight text-muted transition-opacity duration-150" style={{ opacity: otherTyping ? 1 : 0 }}>
            typing…
          </span>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} onScroll={onScroll} className="h-full overflow-y-auto px-4 py-4 md:px-6">
          {initialLoading ? (
            <SkeletonBubbles />
          ) : (
            <MessageList
              messages={messages}
              currentUserId={currentUserId}
              readBoundaryIndex={readBoundaryIndex}
              loadingOlder={loadingOlder}
              onRetryText={retryText}
              onRemove={removeMessage}
            />
          )}
        </div>

        {pillCount > 0 && (
          <button
            onClick={dismissPill}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-border bg-background px-3.5 py-1.5 text-xs font-medium shadow-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          >
            {pillCount} new message{pillCount > 1 ? "s" : ""} ↓
          </button>
        )}
      </div>

      {pickerOpen && (
        <Picker
          onClose={() => setPickerOpen(false)}
          onPickEmoji={pickEmoji}
          onPickAsset={(asset, type) => void sendAsset(asset, type)}
        />
      )}

      <div
        className="flex items-end gap-2 border-t border-border px-4 py-3 md:px-6"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept={ALLOWED_IMAGE_CONTENT_TYPES.join(",")}
          hidden
          onChange={(e) => {
            onPickImage(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          aria-label="Attach image"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <rect x="1.5" y="2.5" width="15" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="6" cy="7" r="1.4" stroke="currentColor" strokeWidth="1.2" />
            <path d="M2.5 13L6.5 9.5L9 11.5L12.5 8L15.5 11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          onClick={() => setPickerOpen((v) => !v)}
          aria-label="Emoji, GIF, and sticker picker"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
            pickerOpen ? "text-accent" : "text-muted"
          }`}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="7.25" stroke="currentColor" strokeWidth="1.4" />
            <circle cx="6.25" cy="7.5" r="0.9" fill="currentColor" />
            <circle cx="11.75" cy="7.5" r="0.9" fill="currentColor" />
            <path d="M5.5 11c.9 1.1 2.1 1.7 3.5 1.7s2.6-.6 3.5-1.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <textarea
          value={input}
          onChange={(e) => onComposerChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={1}
          placeholder="Message"
          className="flex-1 resize-none rounded-2xl border border-border bg-surface px-4 py-2.5 text-[15px] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
        <button
          onClick={() => void send()}
          aria-label="Send"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-contrast focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40"
          disabled={!input.trim()}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M14.5 1.5L7 9M14.5 1.5L10 14.5L7 9M14.5 1.5L1.5 6L7 9"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

function SkeletonBubbles() {
  return (
    <div className="flex flex-col gap-3">
      {SKELETON_WIDTHS.map((w, i) => (
        <div
          key={i}
          className={`h-9 animate-pulse rounded-2xl bg-surface ${i % 2 === 0 ? "self-start" : "self-end"}`}
          style={{ width: w }}
        />
      ))}
    </div>
  );
}

function MessageList(props: {
  messages: ChatMessage[];
  currentUserId: string;
  readBoundaryIndex: number;
  loadingOlder: boolean;
  onRetryText: (m: ChatMessage) => void;
  onRemove: (clientMsgId: string) => void;
}) {
  const { messages, currentUserId, readBoundaryIndex, loadingOlder } = props;

  return (
    <div className="flex flex-col">
      {loadingOlder && (
        <div className="flex flex-col gap-2 pb-3">
          {SKELETON_WIDTHS.slice(0, 3).map((w, i) => (
            <div key={i} className="h-8 animate-pulse rounded-2xl bg-surface self-start" style={{ width: w }} />
          ))}
        </div>
      )}

      {messages.map((m, i) => {
        const prev = messages[i - 1];
        const next = messages[i + 1];
        const isOwn = m.senderId === currentUserId;

        const newDay = !prev || formatDayDivider(prev.createdAt) !== formatDayDivider(m.createdAt);
        const groupedWithPrev =
          !newDay && prev && prev.senderId === m.senderId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS;
        const groupedWithNext =
          next &&
          next.senderId === m.senderId &&
          formatDayDivider(next.createdAt) === formatDayDivider(m.createdAt) &&
          new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() < GROUP_WINDOW_MS;

        const isLastInGroup = !groupedWithNext;
        const status: TickStatus = isOwn ? (i <= readBoundaryIndex ? "read" : (m.localStatus as TickStatus)) : "sent";

        const radius = isLastInGroup
          ? isOwn
            ? "rounded-2xl rounded-br-[4px]"
            : "rounded-2xl rounded-bl-[4px]"
          : "rounded-2xl";

        const showFooter = m.localStatus !== "checking" && m.localStatus !== "blocked";

        return (
          <div key={m.id}>
            {newDay && (
              <div className="my-4 flex justify-center">
                <span className="rounded-full bg-surface px-3 py-1 text-xs text-muted">{formatDayDivider(m.createdAt)}</span>
              </div>
            )}
            <div
              className={`flex max-w-[78%] md:max-w-[65ch] flex-col ${isOwn ? "ml-auto items-end" : "mr-auto items-start"}`}
              style={{ marginTop: groupedWithPrev ? 2 : 12 }}
            >
              {m.type === "IMAGE" ? (
                <ImageBubble message={m} radius={radius} onRemove={() => props.onRemove(m.clientMsgId)} />
              ) : m.type === "GIF" || m.type === "STICKER" ? (
                m.body && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={m.body}
                    alt=""
                    width={m.width ?? undefined}
                    height={m.height ?? undefined}
                    loading="lazy"
                    className={`${radius} ${m.type === "STICKER" ? "w-28" : "max-w-56"} ${m.localStatus === "sending" ? "opacity-60" : ""}`}
                  />
                )
              ) : (
                <div
                  className={`px-3.5 py-2 text-[15px] leading-relaxed transition-opacity duration-150 ${radius} ${
                    isOwn
                      ? `bg-accent-soft text-foreground ${m.localStatus === "sending" ? "opacity-60" : ""} ${
                          m.localStatus === "failed" ? "bg-red-50 dark:bg-red-950" : ""
                        }`
                      : "bg-surface text-foreground"
                  }`}
                >
                  {m.body}
                </div>
              )}
              {showFooter && (
                <div className="mt-0.5 flex items-center gap-1 px-1 text-[11px] text-muted-2">
                  <span>{formatBubbleTime(m.createdAt)}</span>
                  {isOwn && <Ticks status={status} />}
                  {isOwn && m.localStatus === "failed" && m.type === "TEXT" && (
                    <button onClick={() => props.onRetryText(m)} className="ml-1 underline">
                      Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ImageBubble(props: { message: ChatMessage; radius: string; onRemove: () => void }) {
  const { message, radius } = props;

  if (message.localStatus === "checking") {
    return (
      <div className={`relative h-48 w-48 overflow-hidden ${radius}`}>
        {message.localPreviewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={message.localPreviewUrl} alt="" className="h-full w-full scale-105 object-cover blur-md" />
        )}
        <div className="absolute inset-0 flex items-center justify-center bg-black/25 text-xs font-medium text-white">
          Checking image…
        </div>
      </div>
    );
  }

  if (message.localStatus === "blocked") {
    return (
      <div className={`flex h-48 w-48 flex-col items-center justify-center gap-2 bg-surface px-4 text-center ${radius}`}>
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect x="4" y="9" width="12" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" className="text-muted" />
          <path d="M6.5 9V6.5a3.5 3.5 0 0 1 7 0V9" stroke="currentColor" strokeWidth="1.4" className="text-muted" />
        </svg>
        <span className="text-xs text-muted">Blocked: explicit content detected</span>
        <button onClick={props.onRemove} className="text-xs underline text-muted">
          Remove
        </button>
      </div>
    );
  }

  if (message.localStatus === "failed") {
    return (
      <div className={`flex h-48 w-48 flex-col items-center justify-center gap-2 bg-red-50 px-4 text-center dark:bg-red-950 ${radius}`}>
        <span className="text-xs text-muted">Upload failed</span>
        <button onClick={props.onRemove} className="text-xs underline text-muted">
          Remove
        </button>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={message.mediaUrl ?? message.localPreviewUrl}
      alt=""
      loading="lazy"
      className={`max-h-72 max-w-72 object-cover ${radius}`}
    />
  );
}
