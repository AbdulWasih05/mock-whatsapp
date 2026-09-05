# Real-time 1:1 messaging

A production-oriented one-to-one messaging module: live delivery, typing and
read state, server-side moderation, and idempotent sends that survive
retries, reconnects and duplicate tabs.

Runs locally (see [Local setup](#local-setup)). Two one-click demo logins —
**Aisha** and **Rohan** — plus an "Open second window" link on the sign-in
page, so a reviewer can see both sides of a conversation in under a minute.

---

## Architecture

```
                    ┌──────────────────────────────────────────┐
                    │  Next.js (App Router)                    │
  browser  ────────▶│  POST /api/messages   ← THE CHOKEPOINT   │
   (write)          │    1. session auth                       │
                    │    2. conversation membership check      │
                    │    3. rate limit (token bucket)          │
                    │    4. profanity normalize + block        │
                    │    5. image moderation gate (if media)   │
                    │    6. idempotent insert                  │
                    │       @@unique(conversationId,           │
                    │                clientMsgId)              │
                    │    7. internal POST ──────────┐          │
                    └───────────────────────────────┼──────────┘
                                                    │ shared secret header
                                                    ▼
                    ┌──────────────────────────────────────────┐
  browser  ◀────────│  Socket.IO service (apps/ws)             │
   (read)           │  fanout only — never accepts writes      │
                    │  io.to(conversation:id).emit(...)        │
                    └──────────────────────────────────────────┘

  Postgres (Neon) ── Prisma          Object storage (S3-compatible)
                                     quarantine/ → media/, private
```

## Why writes go over HTTP and the socket is read-only

**This is the load-bearing decision in the whole submission.**

Every message write goes through exactly one function: the `POST /api/messages`
route handler. Auth, membership authorization, rate limiting, profanity
filtering, and image moderation all live on that single path, in that order,
before any row is created.

The socket service does one thing: relay events that the API already
committed. It has no write endpoint, no database credentials, and no
message-creation code path at all. Its only inbound trust boundary is an
internal fanout endpoint guarded by a shared secret that only the Next.js
server knows.

The consequence is what makes the moderation and security claims here
*demonstrable* rather than merely asserted: **there is no way to reach the
database by connecting a raw socket client.** An attacker who opens a
WebSocket to the service and starts emitting `message:new` events accomplishes
nothing — the service has no handler that writes. Contrast with the common
design where the socket accepts sends: then every control has to be duplicated
on the socket path too, and any one omission is a bypass.

Two smaller consequences fall out of the same decision:

- **Sending works when the socket is down.** Writes are plain HTTP. Kill the
  socket service and messages still send and persist; only live *delivery*
  pauses, and reconnect gap-fill (below) closes the gap afterwards.
- **The socket never carries history.** On reconnect the client asks the API
  for what it missed. The socket is a notification channel, not a data store.

---

## Data model

```prisma
model User         { id, name, email @unique, avatarUrl?, lastSeenAt, ... }
model Conversation { id, createdAt, lastMessageAt, members[], messages[] }
model Membership   { id, userId, conversationId, lastReadMessageId?, lastReadAt?, joinedAt }
model Message      { id, conversationId, senderId, clientMsgId, type,
                     body?, mediaKey?, width?, height?, createdAt }
```

Every index earns its place by serving a named query:

| Index | Query it serves |
|---|---|
| `Conversation @@index([lastMessageAt desc])` | `GET /api/conversations` — list the caller's conversations ordered by recent activity, no sort on fetched rows |
| `Membership @@unique([userId, conversationId])` | "Am I a member of this conversation?" — the authorization check on every conversation-scoped route. Also prevents double-join |
| `Membership @@index([conversationId])` | "Who is in this conversation?" — resolving fanout targets and unread joins |
| `Message @@unique([conversationId, clientMsgId])` | **Idempotency.** The insert target for every send; a retry collides here and returns the original row |
| `Message @@index([conversationId, createdAt desc, id desc])` | Keyset pagination and the unread count, both `WHERE conversationId = ? ORDER BY createdAt DESC, id DESC` |

**Pagination is keyset, never offset.** The cursor is base64url of
`${createdAt.toISOString()}|${id}`. `EXPLAIN ANALYZE` against the seeded
12,000-message conversation confirms an **index scan, not a seq scan**,
at 0.08 ms — full query plan in [`DECISIONS.md`](./DECISIONS.md).

**Unread count** = messages in the conversation with `createdAt >
membership.lastReadAt` and `senderId != me` — served by the same composite
index.

---

## Reliability

**Idempotency.** The client mints a ULID `clientMsgId` *before* sending. The
server looks that up first: if a row already exists for
`(conversationId, clientMsgId)`, it returns that row untouched (HTTP 200) and
skips rate limiting, profanity checking, and the image pipeline entirely — a
retry is a pure lookup, never a re-execution. A genuinely concurrent
double-submit falls through to the unique constraint and the `P2002` handler
returns the winner's row.

Verified: 6 concurrent identical submits returned **one 201, five 200s, all
carrying the same row id**, with exactly 1 row in the database.

**Reconciliation.** Optimistic bubbles are keyed by `clientMsgId`, never by
array index. Whether the server row arrives via the HTTP response or the
socket echo, it matches the same key and swaps in place — so the two racing
is a non-issue.

**Reconnect gap-fill.** Socket.IO owns the backoff. On reconnect the client
sends its highest known cursor to
`GET /api/conversations/:id/messages?after=<cursor>` and pulls the gap over
HTTP, merging by message id. History never replays through the socket.

Verified: WS service killed → 4 messages sent (HTTP still works) → service
restarted → the gap filled with zero duplicates and zero losses.

**Typing is ephemeral, never stored.** `typing:start` on first keystroke,
re-emitted at most every 3s, `typing:stop` on send or after 2s idle. The
receiver expires the indicator locally after 5s regardless, so a dropped
`stop` can never strand a permanent "X is typing…".

**Presence has grace.** A user is not marked offline on the first
`disconnect` — the service waits ~10s for any socket of that account. A page
refresh therefore never makes someone blink offline for the other party.

Presence is also **snapshotted on join**: broadcasts only fire on transitions,
so a client that connects second would otherwise never learn that someone
already online *is* online. Each joining socket receives the current state for
the users it shares conversations with. (This bug was caught by recording the
demo — the second window showed the first user as offline.)

**Multi-session.** On connect, every socket joins `user:{userId}` *and* a room
per conversation. Read state and new messages fan out to every session of that
account, so a second tab stays consistent: sending in tab A shows exactly one
bubble in tab B, and reading in tab A clears the unread badge in tab B.

---

## Moderation

### Profanity — server side only

A pure, unit-tested normalizer
([`packages/shared/src/moderation/normalize.ts`](./packages/shared/src/moderation/normalize.ts))
runs before any row is created:

| Step | Transform | Example |
|---|---|---|
| 1 | lowercase | `FUCK` → `fuck` |
| 2 | NFKD normalize, strip combining diacritics | `café` → `cafe` |
| 3 | fold Cyrillic homoglyphs (а/о/е/р/с → Latin) | `сunt` → `cunt` |
| 4 | leet map (`4→a 3→e 1→i !→i 0→o $→s @→a 5→s 7→t`) | `sh1t` → `shit` |
| 5 | collapse repeated character runs (3+) | `fuuuuck` → `fuck` |
| 6 | strip separators between single-character tokens | `f.u.c.k`, `f u c k` → `fuck` |

Matched against the blocklist, with an **allowlist for the Scunthorpe
problem** (`classic, assassin, cocktail, Scunthorpe, analysis, bass, grape,
shitake`) masked out *before* the blocklist scan — so "I live in Scunthorpe"
passes while "you are a bitch" in the same message still blocks.

Two deliberate departures from a naive reading of the spec, both found by
tracing false positives before shipping:

- **Step 5 collapses only 3+ repeats, not 2+.** A 2+ threshold shrinks the
  blocklist word `ass` (an ordinary double letter) into `as` — a substring so
  common that "as soon as possible" would be blocked.
- **Step 6 preserves word boundaries.** Blanket-stripping every separator
  merges adjacent *words* ("as soon" → "assoon", which contains "ass"), not
  just the spaced-out *letters* the step exists to catch. Only runs of
  consecutive single-character tokens are glued together.

**30 unit tests** cover plain hits, casing, `f u c k`, `f.u.c.k`, `fuuuck`,
leet `sh1t`/`5h1t`/`sh!t`, Cyrillic homoglyphs, every allowlist term passing
clean, and the word-boundary regression above.

### Images — pipeline is mandatory, model is pluggable

The pipeline ships in full and there is **no code path in which a recipient
can see an unmoderated image**:

1. Client requests a presigned PUT scoped to `quarantine/{uuid}`, with
   content-type and content-length **baked into the signature**.
2. Client uploads **directly to object storage** — no large body ever transits
   the app server.
3. Client POSTs only the object key to `/api/messages`.
4. Server fetches from quarantine, verifies the **real type by magic bytes**
   (`file-type` — never the filename, never the client-declared MIME), then
   runs the moderator.
5. Safe → copy to `media/`, delete the quarantine object, insert the row.
   Unsafe → delete the object, return `422 IMAGE_REJECTED`. **No row is ever
   created.**

The bucket is private throughout; reads go through short-lived presigned GETs
generated at serialization time. The client never receives a raw storage key.

The moderator sits behind an interface:

```ts
export interface ImageModerator {
  check(buf: Buffer): Promise<{ safe: boolean; score: number; reason?: string }>;
}
```

Shipped implementation: `SkinRatioModerator` — sharp → resize 64×64 → raw RGB
→ convert to YCbCr → count pixels in the skin range (`Cr 133–173,
Cb 77–127`) → block if the ratio exceeds 0.4.

**This is a naive heuristic, not a classifier.** It has a high false-positive
rate on close-up faces and beaches — measured, not guessed: a solid skin-tone
frame scores 1.00 and blocks, and a sand-over-water gradient scores 0.50 and
also blocks (table in [`DECISIONS.md`](./DECISIONS.md)). Skin-tone
thresholding also carries known demographic bias that alone disqualifies it
for production use. **NSFWJS (MobileNetV2, ~2.4 MB, ~200 ms CPU) drops into
this same interface as a one-file change** and was not shipped only because of
the one-day window — the pipeline around it, which is the part that is hard to
retrofit, is complete.

### Rate limiting

In-memory token bucket keyed by userId: **sends 20/10s · presign 10/min ·
uploads 5/min**. This is per-instance; Redis is the multi-instance path and is
deliberately not built.

---

## Security checklist

Each item maps to a control on the server, and each is curl-demonstrable.
(Sign in first: `curl -c cookies.txt -X POST localhost:3000/api/auth/sign-in -H 'Content-Type: application/json' -d '{"as":"aisha"}'`)

| Requirement | How it's enforced | Demonstrate |
|---|---|---|
| Reading a conversation you're not a member of → 403 | `requireMembership()` on every conversation-scoped route | `curl -b cookies.txt localhost:3000/api/conversations/<other-conv-id>/messages` → `403 NOT_A_MEMBER` |
| Sending as another account is impossible | `senderId` comes from the signed session cookie; the request body has no user-id field at all | Inspect `SendMessageRequestSchema` — there is nothing to spoof |
| Upload type validated by magic bytes | `file-type` on the fetched bytes, not the declared MIME | Rename a `.exe` to `.jpg`, upload, send → `422 INVALID_FILE_TYPE` |
| Upload size capped | `contentLength` capped in Zod *and* baked into the presigned URL signature | PUT an oversized body to a presigned URL → `403 SignatureDoesNotMatch`, rejected by storage before reaching the app |
| Filename never trusted | Server generates `quarantine/{uuid}`; the client never supplies a key | Inspect `newQuarantineKey()` |
| All authorization on the server | The client hides UI; it never enforces. Every route re-checks session + membership | Any curl above, run without the cookie → `401 UNAUTHENTICATED` |
| Rate limits on sends, uploads, moderation-sensitive endpoints | Token bucket on `send`, `presign`, `upload` | 25 rapid sends → `429 RATE_LIMITED` from request 22 |

**Profanity, demonstrated with no browser involved:**

```bash
curl -b cookies.txt -X POST localhost:3000/api/messages \
  -H 'Content-Type: application/json' \
  -d '{"conversationId":"<id>","clientMsgId":"<ULID>","type":"TEXT","body":"sh1t"}'
# → 422 {"error":{"code":"PROFANITY_BLOCKED","details":{"matchedTerm":"shit"}}}
```

---

## API

All routes under `/api`, every input validated with Zod at the boundary, with
the inferred types exported to the client so the contract is enforced by the
compiler and not only by documentation.

| Method | Path | Notes |
|---|---|---|
| GET | `/conversations` | List + last message + unread count |
| GET | `/conversations/:id/messages?cursor=&limit=50` | Keyset page, newest first |
| GET | `/conversations/:id/messages?after=<cursor>` | Reconnect gap-fill — everything newer than the cursor |
| POST | `/messages` | `{conversationId, clientMsgId, type, body?, mediaKey?, width?, height?}` |
| POST | `/uploads/presign` | `{contentType, contentLength}` → presigned PUT to `quarantine/` |
| POST | `/conversations/:id/read` | `{lastReadMessageId}` |

**One error envelope everywhere.** The client switches on `code`, never on
`message` text:

```ts
{ error: { code: string, message: string, details?: unknown } }
```

`UNAUTHENTICATED` (401) · `NOT_A_MEMBER` (403) · `PROFANITY_BLOCKED` (422) ·
`IMAGE_REJECTED` (422) · `INVALID_FILE_TYPE` (422) · `FILE_TOO_LARGE` (422) ·
`RATE_LIMITED` (429) · `VALIDATION_FAILED` (400)

**Socket events** (all server→client except typing):

| Event | Direction | Payload |
|---|---|---|
| `message:new` | S→C | full serialized message |
| `message:read` | S→C | `{conversationId, userId, lastReadMessageId}` |
| `typing:start` / `typing:stop` | C→S→C | `{conversationId, userId}` |
| `presence:update` | S→C | `{userId, status, lastSeenAt}` |

---

## UI

Near-monochrome, one accent used only for own-message bubbles and read
receipts. The polish is behavioral, not decorative:

- **Message state machine, visible:** `sending` (0.6 opacity, no tick) →
  `sent` (single tick) → `delivered` (double tick) → `read` (double tick,
  accent), with a 150 ms transition.
- **Scroll behavior** — where chat apps usually fail: auto-scroll on a new
  message *only* if already within ~100 px of the bottom, otherwise a floating
  "N new messages ↓" pill; and when prepending an older page, `scrollHeight`
  is captured before and after so `scrollTop` is restored by the delta — the
  viewport does not jump.
- **Failures render in-thread, never as toasts.** A failed send tints the
  bubble and offers an inline Retry that reuses the same `clientMsgId`, which
  makes the idempotency story visible. A blocked image keeps its bubble,
  greyed with a lock icon and "Blocked: explicit content detected".
- **Image pending** renders the local blob under a blur with "Checking
  image…" — moderation latency becomes a feature rather than a wait.
- **Connection pill** appears only when disconnected, and only after an 800 ms
  delay so transient blips don't make the UI twitch. There is no green
  "connected" badge.
- Message grouping within 5 minutes, day dividers, skeleton bubbles at varied
  widths (never spinners), two-pane desktop layout collapsing to one below
  768 px with a back chevron, `100dvh` and `env(safe-area-inset-bottom)` on
  the composer, Enter sends / Shift+Enter newline / Esc closes picker / Cmd+K
  conversation switcher, visible focus rings, and `prefers-reduced-motion`
  respected.

---

## Deliberately out of scope

Each of these was a deliberate choice, not an oversight:

- **Group conversations** (marked bonus in the brief) — the 1:1 case is what
  the reliability and moderation story is built on; groups would add fanout
  and read-state complexity without deepening either.
- **Redis socket adapter** — the documented horizontal-scale path. With a
  single WS instance, in-memory rooms are correct; Redis pub/sub is what you
  add when there's a second instance, and nothing in the design blocks it.
- **Message edit / delete, reactions, message search, voice notes, E2E
  encryption, push notifications, file attachments beyond images** — feature
  surface that would trade against making the shipped features provably
  solid, which the brief explicitly weights higher.

---

## Known limitations

Stated plainly, worst first:

1. **The image moderator is a naive skin-ratio heuristic**, not a classifier.
   High false-positive rate on close-up faces and beaches (measured above),
   and skin-tone thresholding carries demographic bias that disqualifies it
   for production. It exists to prove the *pipeline*; NSFWJS drops into the
   same interface as a one-file change.
2. **Profanity matching is substring-based**, so a word containing a blocked
   term but absent from the given allowlist (e.g. "class" contains "ass")
   still over-blocks. Covered by an explicit test that asserts the actual
   behavior rather than hiding it.
3. **"Delivered" is a heuristic.** There is no separate device-ack channel; a
   message is marked delivered if the recipient's presence was online at the
   moment the send committed. Honest approximation, not a guarantee.
4. **Rate limiting is per-instance** (in-memory). Correct for one instance,
   not for a horizontally scaled deployment — Redis is the path.
5. **A rate-limited image send can orphan a quarantine object**, since the
   limit is checked after the browser has already uploaded. The production fix
   is a lifecycle rule expiring `quarantine/` after ~24h, which is the right
   backstop for *any* orphan cause (client crash, network drop mid-flow).
6. **Environment substitutions in this build** — documented in full in
   [`DECISIONS.md`](./DECISIONS.md): no Cloudflare account was available, so
   object storage points at a local MinIO container (identical S3 API, only
   env vars differ); and no Tenor/Giphy key was available, so the GIF picker
   searches a small local pack (swapping in real search is a one-function
   change).
7. **Mobile layout not visually verified at 390 px** — the responsive collapse
   uses ordinary Tailwind `md:` breakpoints, but the browser automation in
   this environment could not actually resize the viewport to confirm it
   visually.

---

## Local setup

```bash
pnpm install

# 1. Database — any Postgres. Set DATABASE_URL / DIRECT_URL in apps/web/.env
#    (see apps/web/.env.example)
pnpm --filter @wamock/web prisma migrate deploy
pnpm db:seed          # 2 demo users + 2 more, 12,027 messages over ~60 days

# 2. Object storage — any S3-compatible endpoint. For local dev:
docker run -d --name wamock-minio -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=wamock -e MINIO_ROOT_PASSWORD=wamock123 \
  minio/minio server /data --console-address ":9001"
#    then create the bucket named in STORAGE_BUCKET

# 3. Run both services (separate terminals)
pnpm dev:ws           # Socket.IO fanout service, :4001
pnpm dev:web          # Next.js app, :3000
```

Open http://localhost:3000, click **Sign in as Aisha**, then use **Open second
window** and sign in as **Rohan** to see both sides.

```bash
pnpm test             # profanity normalizer unit tests
pnpm typecheck        # all three packages
```

Environment variables are documented in `apps/web/.env.example` and
`apps/ws/.env.example`. `AUTH_SECRET` and `WS_INTERNAL_SECRET` must match
between the two services.
