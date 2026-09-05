"use client";

import { useEffect, useState } from "react";
import { useSocket } from "./socket-provider";

// Renders only when disconnected, and only after an 800ms delay so a
// transient blip doesn't make the UI twitch. Never shows a "connected"
// badge (CLAUDE.md §8).
export function ConnectionPill() {
  const { socket } = useSocket();
  const [disconnected, setDisconnected] = useState(false);
  const [showPill, setShowPill] = useState(false);

  useEffect(() => {
    if (!socket) return;
    function onDisconnect() {
      setDisconnected(true);
    }
    function onConnect() {
      setDisconnected(false);
    }
    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);
    return () => {
      socket.off("disconnect", onDisconnect);
      socket.off("connect", onConnect);
    };
  }, [socket]);

  useEffect(() => {
    if (!disconnected) {
      setShowPill(false);
      return;
    }
    const timer = setTimeout(() => setShowPill(true), 800);
    return () => clearTimeout(timer);
  }, [disconnected]);

  if (!showPill) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-50 flex justify-center">
      <div className="rounded-full border border-border bg-background px-3 py-1 text-xs text-muted shadow-none">
        Reconnecting…
      </div>
    </div>
  );
}
