import {
  ApiErrorBodySchema,
  type ApiErrorBody,
  type ConversationsResponse,
  type GetMessagesResponse,
  type MarkReadResponse,
  type PresignRequest,
  type PresignResponse,
  type SendMessageRequest,
  type SendMessageResponse,
} from "@wamock/shared";

// The client switches on `.code`, never on `.message` text (CLAUDE.md §4).
export class ClientApiError extends Error {
  code: ApiErrorBody["error"]["code"];
  details?: unknown;

  constructor(body: ApiErrorBody) {
    super(body.error.message);
    this.code = body.error.code;
    this.details = body.error.details;
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const json: unknown = await res.json().catch(() => null);
    const parsed = json ? ApiErrorBodySchema.safeParse(json) : null;
    if (parsed?.success) throw new ClientApiError(parsed.data);
    throw new Error(`Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getConversations: () => request<ConversationsResponse>("/api/conversations"),

  getMessages: (conversationId: string, opts?: { cursor?: string; after?: string; limit?: number }) => {
    const params = new URLSearchParams();
    if (opts?.cursor) params.set("cursor", opts.cursor);
    if (opts?.after) params.set("after", opts.after);
    params.set("limit", String(opts?.limit ?? 50));
    return request<GetMessagesResponse>(`/api/conversations/${conversationId}/messages?${params.toString()}`);
  },

  sendMessage: (payload: SendMessageRequest) =>
    request<SendMessageResponse>("/api/messages", {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  markRead: (conversationId: string, lastReadMessageId: string) =>
    request<MarkReadResponse>(`/api/conversations/${conversationId}/read`, {
      method: "POST",
      body: JSON.stringify({ lastReadMessageId }),
    }),

  presignUpload: (payload: PresignRequest) =>
    request<PresignResponse>("/api/uploads/presign", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
};

// Direct upload to the presigned URL — the image body never transits our
// app server (CLAUDE.md §6).
export async function uploadToPresignedUrl(uploadUrl: string, file: File): Promise<void> {
  const res = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
}
