import { createServer } from "node:http";
import { Server, type Socket } from "socket.io";
import { verifySessionToken, InternalFanoutRequestSchema } from "@wamock/shared";

const PORT = Number(process.env.PORT ?? 4001);
const AUTH_SECRET = process.env.AUTH_SECRET;
const WS_INTERNAL_SECRET = process.env.WS_INTERNAL_SECRET;
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

if (!AUTH_SECRET) throw new Error("AUTH_SECRET is not set");
if (!WS_INTERNAL_SECRET) throw new Error("WS_INTERNAL_SECRET is not set");

const httpServer = createServer((req, res) => {
  if (req.method === "POST" && req.url === "/internal/fanout") {
    handleFanout(req, res);
    return;
  }
  res.writeHead(404).end();
});

const io = new Server(httpServer, {
  cors: { origin: WEB_ORIGIN },
});

// userId -> count of live sockets + pending offline timer. Presence has
// grace: only announce offline after ~10s with zero sockets, so a page
// refresh never blinks a user offline (CLAUDE.md §5).
const presence = new Map<string, { socketCount: number; offlineTimer?: NodeJS.Timeout; conversations: Set<string> }>();

function conversationRoom(id: string) {
  return `conversation:${id}`;
}
function userRoom(id: string) {
  return `user:${id}`;
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token;
  if (typeof token !== "string") return next(new Error("unauthorized"));
  const verified = await verifySessionToken(token, AUTH_SECRET!);
  if (!verified) return next(new Error("unauthorized"));
  socket.data.userId = verified.userId;
  socket.data.conversations = verified.conversations;
  next();
});

io.on("connection", (socket: Socket) => {
  const userId: string = socket.data.userId;
  const conversations: string[] = socket.data.conversations;

  socket.join(userRoom(userId));
  for (const conversationId of conversations) socket.join(conversationRoom(conversationId));

  let entry = presence.get(userId);
  if (!entry) {
    entry = { socketCount: 0, conversations: new Set() };
    presence.set(userId, entry);
  }
  for (const c of conversations) entry.conversations.add(c);

  const wasOffline = entry.socketCount === 0;
  entry.socketCount++;
  if (entry.offlineTimer) {
    clearTimeout(entry.offlineTimer);
    entry.offlineTimer = undefined;
  }
  if (wasOffline) broadcastPresence(userId, "online", entry.conversations);

  // Presence snapshot for the joiner. Broadcasts only fire on transitions,
  // so without this a client that connects second never learns that someone
  // who was already online *is* online — they'd show offline until that
  // person happened to reconnect.
  const myConversations = new Set(conversations);
  for (const [otherUserId, other] of presence) {
    if (otherUserId === userId || other.socketCount <= 0) continue;
    const shares = [...other.conversations].some((c) => myConversations.has(c));
    if (shares) {
      socket.emit("presence:update", {
        userId: otherUserId,
        status: "online",
        lastSeenAt: new Date().toISOString(),
      });
    }
  }

  socket.on("typing:start", (payload: unknown) => handleTyping(socket, userId, payload, "typing:start"));
  socket.on("typing:stop", (payload: unknown) => handleTyping(socket, userId, payload, "typing:stop"));

  socket.on("disconnect", () => {
    const e = presence.get(userId);
    if (!e) return;
    e.socketCount--;
    if (e.socketCount <= 0) {
      e.offlineTimer = setTimeout(() => {
        broadcastPresence(userId, "offline", e.conversations);
        presence.delete(userId);
      }, 10_000);
    }
  });
});

function broadcastPresence(userId: string, status: "online" | "offline", conversations: Set<string>) {
  const payload = { userId, status, lastSeenAt: new Date().toISOString() };
  for (const conversationId of conversations) {
    io.to(conversationRoom(conversationId)).emit("presence:update", payload);
  }
}

function handleTyping(socket: Socket, userId: string, payload: unknown, event: "typing:start" | "typing:stop") {
  if (typeof payload !== "object" || payload === null) return;
  const conversationId = (payload as { conversationId?: unknown }).conversationId;
  if (typeof conversationId !== "string") return;
  // Only relay into rooms this socket actually belongs to — a client can't
  // claim to be typing in a conversation it never joined.
  if (!socket.rooms.has(conversationRoom(conversationId))) return;
  socket.to(conversationRoom(conversationId)).emit(event, { conversationId, userId });
}

function handleFanout(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) {
  if (req.headers["x-internal-secret"] !== WS_INTERNAL_SECRET) {
    res.writeHead(401).end();
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const parsed = InternalFanoutRequestSchema.parse(JSON.parse(body));
      if (parsed.event === "message:new") {
        io.to(conversationRoom(parsed.room)).emit("message:new", parsed.payload);
      } else if (parsed.event === "message:read") {
        for (const room of parsed.rooms) {
          const target = room.startsWith("user:") ? room : conversationRoom(room);
          io.to(target).emit("message:read", parsed.payload);
        }
      }
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ error: String(err) }));
    }
  });
}

httpServer.listen(PORT, () => {
  console.log(`ws service listening on :${PORT}`);
});
