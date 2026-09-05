import "server-only";
import type { Message } from "@prisma/client";
import type { SerializedMessage } from "@wamock/shared";
import { presignRead } from "./storage";

// Async because an IMAGE message resolves `mediaKey` to a short-lived
// presigned GET URL here — never a raw R2/storage key to the client
// (CLAUDE.md §6: "the bucket is private throughout").
export async function serializeMessage(message: Message): Promise<SerializedMessage> {
  return {
    id: message.id,
    conversationId: message.conversationId,
    senderId: message.senderId,
    clientMsgId: message.clientMsgId,
    type: message.type,
    body: message.body,
    mediaUrl: message.mediaKey ? await presignRead(message.mediaKey) : null,
    width: message.width,
    height: message.height,
    createdAt: message.createdAt.toISOString(),
  };
}
