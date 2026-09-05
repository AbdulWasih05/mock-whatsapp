# CLAUDE.md

Instructions for Claude Code working in this repository.

---

## 1. What this is

A hiring assignment: a production-oriented one-to-one real-time messaging module for the web. Deadline is end of day. It is graded on five areas, in this order of weight:


| Area               | What is being judged                                                |
| ------------------ | ------------------------------------------------------------------- |
| Real-Time Behavior | Low-latency delivery, typing/read states, sensible reconnection     |
| Backend & Database | Message model, pagination, indexing, authorization, clear APIs      |
| Moderation         | Server-side profanity blocking, image moderation, bypass resistance |
| Reliability        | Duplicate prevention, retries, idempotency, multi-session behavior  |
| UI / UX            | Responsive chat layout, media picker behavior, clear message states |

The brief's closing line is the governing constraint:

> A smaller implementation that is stable, well-structured and demonstrably smooth/reliable will be valued more than a larger feature set that only works in ideal conditions.

Read that as an instruction. When a choice arises between another feature and making an existing one provably solid, always choose solid. Then write down why in the README.

---

## 2. Non-negotiable architecture

### Writes go over HTTP. The socket is read-only.

```
client → POST /api/messages  (Next.js route handler)
           ├─ 1. session auth
           ├─ 2. conversation membership check
           ├─ 3. rate limit
           ├─ 4. profanity normalize + block
           ├─ 5. image moderation gate (if media)
           ├─ 6. idempotent upsert on (conversationId, clientMsgId)
           └─ 7. internal POST → WS service (shared secret header)
                                  └─ io.to(conversationId).emit("message:new")

socket → read path only: message:new, message:read, typing:*, presence:*
```

Never accept a message write over the socket. Every security and moderation control lives on one chokepoint that cannot be bypassed by connecting a raw socket client. This single decision is what makes the moderation and security requirements demonstrable rather than merely claimed. Do not refactor it.

### Deployment shape

* **Next.js (App Router) on Vercel** — UI, API route handlers, auth, Prisma.
* **Socket.IO service on Railway** — a small standalone Node/TS process. Fanout only.
* **Neon Postgres** — via Prisma.
* **Cloudflare R2** — private bucket, presigned PUT for upload, presigned GET for read.

Single WS instance. No Redis adapter. The README documents Redis pub/sub as the horizontal-scale path and states that it was deliberately not built. Choosing not to build something, and saying why, is part of what is being graded.

---

## 3. Data model

```prisma
model User {
  id          String       @id @default(cuid())
  name        String
  email       String       @unique
  avatarUrl   String?
  lastSeenAt  DateTime     @default(now())
  memberships Membership[]
  messages    Message[]
}

model Conversation {
  id            String       @id @default(cuid())
  createdAt     DateTime     @default(now())
  lastMessageAt DateTime     @default(now())
  members       Membership[]
  messages      Message[]

  @@index([lastMessageAt(sort: Desc)])
}

model Membership {
  id                String    @id @default(cuid())
  userId            String
  conversationId    String
  lastReadMessageId String?
  lastReadAt        DateTime?
  joinedAt          DateTime  @default(now())

  user         User         @relation(fields: [userId], references: [id])
  conversation Conversation @relation(fields: [conversationId], references: [id])

  @@unique([userId, conversationId])   // membership lookup + no double-join
  @@index([conversationId])            // "who is in this conversation"
}

enum MessageType { TEXT IMAGE GIF STICKER }

model Message {
  id             String      @id @default(cuid())
  conversationId String
  senderId       String
  clientMsgId    String
  type           MessageType
  body           String?
  mediaKey       String?     // R2 object key; never a public URL
  width          Int?
  height         Int?
  createdAt      DateTime    @default(now())

  conversation Conversation @relation(fields: [conversationId], references: [id])
  sender       User         @relation(fields: [senderId], references: [id])

  @@unique([conversationId, clientMsgId])                          // idempotency
  @@index([conversationId, createdAt(sort: Desc), id(sort: Desc)]) // keyset paging
}
```

Every index above must be justified in the README by naming the query it serves.

**Pagination is keyset, never offset.** Cursor is base64 of `${createdAt.toISOString()}|${id}`.

```ts
where: {
  conversationId,
  OR: [
    { createdAt: { lt: cursorCreatedAt } },
    { createdAt: cursorCreatedAt, id: { lt: cursorId } },
  ],
},
orderBy: [{ createdAt: "desc" }, { id: "desc" }],
take: limit + 1,   // +1 sentinel to compute hasMore
```

**Unread count** = messages in the conversation with `createdAt > membership.lastReadAt` and `senderId != me`. Served by the same composite index.

---

## 4. API contract

All routes under `/api`. Validate every input with Zod at the boundary and export the inferred types to the client, so the contract is enforced by the compiler and not only by documentation.


| Method | Path                                           | Notes                                                          |
| ------ | ---------------------------------------------- | -------------------------------------------------------------- |
| GET    | `/conversations`                               | List + last message + unread count                             |
| GET    | `/conversations/:id/messages?cursor=&limit=50` | Keyset page, newest first                                      |
| POST   | `/messages`                                    | `{conversationId, clientMsgId, type, body?, mediaKey?}`        |
| POST   | `/uploads/presign`                             | `{contentType, contentLength}`→ presigned PUT to`quarantine/` |
| POST   | `/conversations/:id/read`                      | `{lastReadMessageId}`                                          |

### Error envelope

Exactly one shape everywhere:

```ts
{ error: { code: string, message: string, details?: unknown } }
```

Codes are machine-readable and stable. The client switches on `code`, never on `message` text.

`UNAUTHENTICATED` (401) · `NOT_A_MEMBER` (403) · `PROFANITY_BLOCKED` (422) · `IMAGE_REJECTED` (422) · `INVALID_FILE_TYPE` (422) · `FILE_TOO_LARGE` (422) · `RATE_LIMITED` (429) · `VALIDATION_FAILED` (400)

### Socket events


| Event                        | Direction | Payload                                       |
| ---------------------------- | --------- | --------------------------------------------- |
| `message:new`                | S→C      | full serialized message                       |
| `message:read`               | S→C      | `{conversationId, userId, lastReadMessageId}` |
| `typing:start`/`typing:stop` | C→S→C   | `{conversationId, userId}`                    |
| `presence:update`            | S→C      | `{userId, status, lastSeenAt}`                |

On connect, every socket joins `user:{userId}`**and** a room per conversation it belongs to. The `user:` room is what makes multi-tab behavior correct — read state and new messages fan out to every session of that account.

---

## 5. Reliability rules

* **Idempotency.** The client mints a ULID `clientMsgId` before sending. The insert is an upsert against `@@unique([conversationId, clientMsgId])`. A retry returns the original row. This one index solves retries, reconnect replay, and duplicate tabs.
* **Reconciliation.** Optimistic bubbles are keyed by `clientMsgId`, never by array index. Whether the server row arrives via the HTTP response or the socket echo, it matches the same key and swaps in place. The two racing is therefore a non-issue.
* **Reconnect gap-fill.** Socket.IO owns the backoff. On reconnect the client sends its highest known cursor and pulls the gap over HTTP. Never replay history through the socket.
* **Typing is ephemeral, not stored.** Emit `typing:start` on first keystroke, re-emit at most every 3s while typing, emit `typing:stop` on send or after 2s idle. The receiver expires the indicator locally after 5s regardless, so a dropped `stop` can never strand a permanent "X is typing…".
* **Presence has grace.** Do not mark offline on the first `disconnect`; wait \~10s with no socket for that user. A page refresh must not make someone blink offline.

---

## 6. Moderation

### Profanity — server side only

Normalize, then match. The normalizer is a pure function with its own unit test file; it is the most legible proof of engineering care in the repo.

1. lowercase
2. NFKD normalize, strip combining diacritics
3. fold homoglyphs (Cyrillic а/о/е/р/с → Latin)
4. leet map: `4→a 3→e 1→i !→i 0→o $→s @→a 5→s 7→t`
5. collapse repeated character runs (`fuuuuck` → `fuck`)
6. strip non-alphanumeric separators (`f.u.c.k` → `fuck`)

Match with word boundaries against the normalized form. Keep a small **allowlist** for the Scunthorpe problem: `classic, assassin, cocktail, Scunthorpe, analysis, bass, grape, shitake`. Naming that failure mode and handling it is a scored signal.

### Images — pipeline is mandatory, model is pluggable

The pipeline ships in full:

1. Client requests a presigned PUT scoped to `quarantine/{uuid}`, with content-type and content-length conditions baked into the signature.
2. Client uploads **directly to R2**. No large body ever transits the app server.
3. Client POSTs only the object key to `/api/messages`.
4. Server fetches from quarantine, verifies real type by magic bytes (`file-type` package — never trust the filename or the client-declared MIME), then runs the moderator.
5. Safe → copy to `media/`, delete the quarantine object, insert the message row. Unsafe → delete the object, return 422 `IMAGE_REJECTED`. **No row is ever created.**

The bucket is private throughout; reads go through short-lived presigned GETs. There is no code path in which a recipient can see an unmoderated image.

Behind an interface:

```ts
export interface ImageModerator {
  check(buf: Buffer): Promise<{ safe: boolean; score: number; reason?: string }>;
}
```

Ship `SkinRatioModerator`: sharp → resize 64×64 → raw RGB → convert to YCbCr → count pixels in the skin range (`Cr 133–173, Cb 77–127`) → block if ratio > threshold.

The README must state, without softening it: this is a naive heuristic, not a classifier; it has a high false-positive rate on close-up faces and beaches; and skin-tone thresholding carries known demographic bias that alone disqualifies it for production. Then state that `NSFWJS (MobileNetV2, ~2.4MB, ~200ms CPU)` drops into this same interface as a one-file change and was not shipped only because of the one-day window. Honesty about the limitation scores better than a hidden weakness.

### Rate limiting

In-memory token bucket, keyed by userId. Sends 20/10s · presign 10/min · uploads 5/min. Note in the README that this is per-instance and that Redis is the multi-instance path.

---

## 7. Security checklist

Map each of these to a line in the README and make each one curl-demonstrable:

* Reading a conversation you are not a member of → 403.
* Sending as another account → impossible; `senderId` comes from the session, never from the request body. **Never read a user id from the client.**
* Upload type validated by magic bytes, size capped, filename never trusted.
* All authz on the server. The client hides UI; it never enforces.
* Rate limits on sends, uploads, and moderation-sensitive endpoints.

---

## 8. UI direction

Clean modern product. Restraint. The polish being graded is behavioral, not decorative.

**Spend boldness in exactly one place: message state.** Everything else stays quiet.

* Near-monochrome. One accent, used only for own-message bubbles and read receipts. No gradients, no card shadows, no decorative color.
* Type: one family (Inter or Geist), 14–15px body. Bubbles capped at 65ch on desktop, 78% viewport width on mobile. Sentence case. No all-caps labels, no tracked-out eyebrows, no `→` appended to buttons.
* Radius 12px, with the tail corner at 4px.
* Group consecutive messages from the same sender within 5 minutes: no repeated avatar, tighter leading. Day dividers between dates.
* Skeleton bubbles at varied plausible widths, never spinners.
* Motion only in response to user action. No entrance animations on mount.

**Message state machine, visible:**`sending` (0.6 opacity, no tick) → `sent` (single tick) → `delivered` (double tick) → `read` (double tick, accent). 150ms fade between states.

**Scroll behavior — this is where chat apps fail:**

1. Auto-scroll on a new message *only* if the user is already within \~100px of the bottom.
2. Otherwise show a floating "3 new messages ↓" pill.
3. When prepending an older page, capture `scrollHeight` before and after and restore `scrollTop` by the delta. The viewport must not jump. This is non-optional.

**Failures render in-thread, never as toasts:**

* Send failed → bubble tints red, inline "Retry" that reuses the same `clientMsgId`, making the idempotency story visible.
* Image blocked → bubble stays, greyed, lock icon, "Blocked: explicit content detected", with a Remove action. A toast would discard the best moderation demo.
* Image pending → render the local blob immediately under a blur with "Checking image…". Moderation latency becomes a feature rather than a wait.

**Connection pill:** render only when disconnected, and only after an 800ms delay so transient blips do not make the UI twitch. Never show a green "connected" badge.

**Responsive:** below 768px the two-pane collapses to one. Conversation list is root; opening a thread is a full-screen push with a back chevron. Use `100dvh` (not `100vh`) and `env(safe-area-inset-bottom)` on the composer. Pickers become a 45vh bottom sheet.

**Keyboard:** Enter sends, Shift+Enter newline, Esc closes picker, Cmd+K conversation switcher. Visible focus rings. Respect `prefers-reduced-motion`.

**Demo affordance:** the login page has one-click "Sign in as Aisha" / "Sign in as Rohan" buttons plus "Open second window". Optimize the reviewer's five minutes.

---

## 9. Conventions

* TypeScript strict. No `any`. No non-null `!` except immediately after a checked guard.
* Zod at every boundary; infer types from schemas rather than declaring them twice.
* Server-only modules import `server-only`. Never leak Prisma or R2 creds to the client.
* Components: presentational components take data as props and hold no fetching logic.
* Prisma client is a singleton (guard against hot-reload duplication).
* Every non-obvious decision gets a one-line comment saying *why*, not *what*.
* Conventional commits. Commit at the end of each phase.
* No dead code, no commented-out blocks, no `console.log` in committed code.

---

## 10. Explicitly out of scope

Do not build these. List them in the README under "Deliberately out of scope" with one line each on why.

Group conversations (marked bonus in the brief) · Redis socket adapter · message edit/delete · reactions · message search · voice notes · E2E encryption · push notifications · file attachments beyond images.

---

## 11. Checkpoint protocol

Work through `PLAN.md` phase by phase, autonomously.

Phases are marked either **AUTO** or **🛑 CHECKPOINT**.

* **AUTO** — implement, self-verify against the phase's "Done when" list, commit, and continue straight to the next phase without asking.
* **🛑 CHECKPOINT** — stop. Present the specific decision, your recommendation, and the tradeoff in under ten lines. Wait for a reply before continuing.

Do not invent additional checkpoints. Do not ask for permission to proceed on AUTO phases. If you hit an ambiguity mid-phase that is genuinely blocking, make the smallest reasonable assumption, note it in a `DECISIONS.md` running log, and keep moving; raise it at the next checkpoint rather than stopping.

If you fall behind the time budget, cut from the bottom of the current phase, never from Phases 1–4.
