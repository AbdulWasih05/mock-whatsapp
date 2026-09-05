"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import type { PresenceUpdateEvent } from "@wamock/shared";
import { createSocket } from "@/lib/socket";

type PresenceState = Record<string, { status: "online" | "offline"; lastSeenAt: string }>;

const SocketContext = createContext<{ socket: Socket | null; presence: PresenceState }>({
  socket: null,
  presence: {},
});

export function useSocket() {
  return useContext(SocketContext);
}

// One socket for the whole /chat subtree — every page below reads from this
// same connection and attaches its own event listeners (CLAUDE.md §4/§5:
// "single connection").
export function SocketProvider(props: { children: React.ReactNode }) {
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [presence, setPresence] = useState<PresenceState>({});

  useEffect(() => {
    const s = createSocket();
    socketRef.current = s;
    setSocket(s);

    function onPresence(payload: PresenceUpdateEvent) {
      setPresence((prev) => ({ ...prev, [payload.userId]: { status: payload.status, lastSeenAt: payload.lastSeenAt } }));
    }
    s.on("presence:update", onPresence);

    return () => {
      s.off("presence:update", onPresence);
      s.disconnect();
    };
  }, []);

  return <SocketContext.Provider value={{ socket, presence }}>{props.children}</SocketContext.Provider>;
}
