import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const MessageTypeSchema = z.enum(["TEXT", "IMAGE", "GIF", "STICKER"]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

// ULID-shaped: 26 chars, Crockford base32. Minted client-side before send so
// retries/reconnect/duplicate tabs all converge on the same row (CLAUDE.md §5).
export const ClientMsgIdSchema = z
  .string()
  .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/i, "clientMsgId must be a ULID");

export const UserPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  avatarUrl: z.string().nullable(),
});
export type UserPublic = z.infer<typeof UserPublicSchema>;

// The server never returns a raw R2 key to the client; IMAGE messages carry a
// short-lived presigned GET URL resolved at read time instead.
export const SerializedMessageSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  senderId: z.string(),
  clientMsgId: ClientMsgIdSchema,
  type: MessageTypeSchema,
  body: z.string().nullable(),
  mediaUrl: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  createdAt: z.string(), // ISO 8601
});
export type SerializedMessage = z.infer<typeof SerializedMessageSchema>;

// ---------------------------------------------------------------------------
// GET /api/conversations
// ---------------------------------------------------------------------------

export const ConversationListItemSchema = z.object({
  id: z.string(),
  otherMember: UserPublicSchema,
  lastMessage: SerializedMessageSchema.nullable(),
  lastMessageAt: z.string(),
  unreadCount: z.number().int().nonnegative(),
});
export type ConversationListItem = z.infer<typeof ConversationListItemSchema>;

export const ConversationsResponseSchema = z.array(ConversationListItemSchema);
export type ConversationsResponse = z.infer<typeof ConversationsResponseSchema>;

// ---------------------------------------------------------------------------
// GET /api/conversations/:id/messages
// ---------------------------------------------------------------------------

// Opaque base64 of `${createdAt.toISOString()}|${id}` — see CLAUDE.md §3.
export const CursorSchema = z.string();

export const GetMessagesQuerySchema = z.object({
  // Page backwards through history (newest-first).
  cursor: CursorSchema.optional(),
  // Reconnect gap-fill: everything strictly NEWER than this cursor
  // (CLAUDE.md §5 — "on reconnect the client sends its highest known cursor
  // and pulls the gap over HTTP"). Never both at once.
  after: CursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type GetMessagesQuery = z.infer<typeof GetMessagesQuerySchema>;

export const GetMessagesResponseSchema = z.object({
  messages: z.array(SerializedMessageSchema),
  nextCursor: CursorSchema.nullable(),
  hasMore: z.boolean(),
});
export type GetMessagesResponse = z.infer<typeof GetMessagesResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/messages
// ---------------------------------------------------------------------------

export const SendMessageRequestSchema = z
  .object({
    conversationId: z.string(),
    clientMsgId: ClientMsgIdSchema,
    type: MessageTypeSchema,
    body: z.string().min(1).max(4000).optional(),
    mediaKey: z.string().optional(),
    // Known up front for GIF/STICKER sends (the local pack has fixed
    // dimensions) so the thread never reflows on load. IMAGE dimensions are
    // never trusted from the client — they're read server-side from the
    // actual file in the moderation pipeline instead.
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.type === "TEXT" && !val.body) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "TEXT messages require body", path: ["body"] });
    }
    if (val.type === "IMAGE" && !val.mediaKey) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "IMAGE messages require mediaKey", path: ["mediaKey"] });
    }
    if ((val.type === "GIF" || val.type === "STICKER") && !val.body) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${val.type} messages require body (URL)`, path: ["body"] });
    }
  });
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const SendMessageResponseSchema = SerializedMessageSchema;
export type SendMessageResponse = z.infer<typeof SendMessageResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/uploads/presign
// ---------------------------------------------------------------------------

export const ALLOWED_IMAGE_CONTENT_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB

export const PresignRequestSchema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_CONTENT_TYPES),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(MAX_IMAGE_BYTES),
});
export type PresignRequest = z.infer<typeof PresignRequestSchema>;

export const PresignResponseSchema = z.object({
  uploadUrl: z.string(),
  key: z.string(),
  expiresAt: z.string(),
});
export type PresignResponse = z.infer<typeof PresignResponseSchema>;

// ---------------------------------------------------------------------------
// POST /api/conversations/:id/read
// ---------------------------------------------------------------------------

export const MarkReadRequestSchema = z.object({
  lastReadMessageId: z.string(),
});
export type MarkReadRequest = z.infer<typeof MarkReadRequestSchema>;

export const MarkReadResponseSchema = z.object({
  conversationId: z.string(),
  lastReadMessageId: z.string(),
  lastReadAt: z.string(),
});
export type MarkReadResponse = z.infer<typeof MarkReadResponseSchema>;

// ---------------------------------------------------------------------------
// Socket event payloads
// ---------------------------------------------------------------------------

export const MessageNewEventSchema = SerializedMessageSchema;
export type MessageNewEvent = z.infer<typeof MessageNewEventSchema>;

export const MessageReadEventSchema = z.object({
  conversationId: z.string(),
  userId: z.string(),
  lastReadMessageId: z.string(),
});
export type MessageReadEvent = z.infer<typeof MessageReadEventSchema>;

// Client → server: userId is derived from the authenticated socket, never sent.
export const TypingClientEventSchema = z.object({
  conversationId: z.string(),
});
export type TypingClientEvent = z.infer<typeof TypingClientEventSchema>;

// Server → client: broadcast includes who is typing.
export const TypingServerEventSchema = z.object({
  conversationId: z.string(),
  userId: z.string(),
});
export type TypingServerEvent = z.infer<typeof TypingServerEventSchema>;

export const PresenceStatusSchema = z.enum(["online", "offline"]);
export type PresenceStatus = z.infer<typeof PresenceStatusSchema>;

export const PresenceUpdateEventSchema = z.object({
  userId: z.string(),
  status: PresenceStatusSchema,
  lastSeenAt: z.string(),
});
export type PresenceUpdateEvent = z.infer<typeof PresenceUpdateEventSchema>;

// ---------------------------------------------------------------------------
// Internal WS fanout endpoint (Next.js API -> ws service, shared-secret header)
// ---------------------------------------------------------------------------

export const InternalFanoutRequestSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("message:new"), room: z.string(), payload: MessageNewEventSchema }),
  z.object({ event: z.literal("message:read"), rooms: z.array(z.string()), payload: MessageReadEventSchema }),
]);
export type InternalFanoutRequest = z.infer<typeof InternalFanoutRequestSchema>;
