# PLAN.md

Execution plan. Work top to bottom. Read `CLAUDE.md` first; it holds the architecture, contracts and conventions that every phase depends on.

Phases marked **AUTO** run without asking. Phases marked **🛑 CHECKPOINT** stop and wait.

Times are elapsed budget against a \~14-hour day. If you slip, cut from the bottom of the current phase — never from Phases 1–3.

---

## Phase 0 — Foundation · `0:00–1:00` · AUTO → 🛑 CHECKPOINT 1

**Goal:** the data layer and the API contract exist and are correct before anything depends on them. Everything downstream is cheap to change; this is not.

**Tasks**

* Scaffold: Next.js App Router + TypeScript strict, Tailwind, Prisma, Zod.
* Monorepo-lite layout: `/apps/web` (Next.js), `/apps/ws` (Socket.IO service), `/packages/shared` (Zod schemas + inferred types + the error-code enum, imported by both).
* Write the full Prisma schema exactly as specified in `CLAUDE.md` §3. Migrate to Neon.
* Write `packages/shared/contracts.ts`: Zod schemas for every request and response body in `CLAUDE.md` §4, plus the socket event payloads.
* Seed script:
  * Two users, Aisha and Rohan, with avatars.
  * One shared conversation.
  * **12,000 messages** in that conversation with realistic timestamps spread over \~60 days and a plausible back-and-forth distribution.
  * Two smaller side conversations so the list view is not a single row.
* Dev auth: session cookie holding userId, signed with `jose`. Two one-click sign-in buttons. No password flow, no OAuth.

**Done when**

* `pnpm db:seed` completes and `SELECT count(*)` returns 12,000+.
* `EXPLAIN ANALYZE` on the keyset paging query shows an **index scan**, not a seq scan. Paste the plan into `DECISIONS.md`.
* `packages/shared` compiles and is importable from both apps.

> ### 🛑 CHECKPOINT 1 — Schema and contract sign-off
>
> Present, compactly:
>
> 1. The final Prisma schema, with a one-line justification per index naming the query it serves.
> 2. The API + socket contract tables as built.
> 3. The `EXPLAIN ANALYZE` output for the paging query.
> 4. Your recommendation on auth: dev-only signed cookie with two seed users (fast, honest, documented as dev-only) versus NextAuth credentials (slower, more conventional, \~45 min cost).
>
> Wait for a reply. This is the only cheap moment to change the data model.

---

## Phase 1 — Core messaging over HTTP · `1:00–3:00` · AUTO

**Goal:** a working chat with no realtime at all. Refresh-to-see is acceptable here. Correct data flow first, sockets second.

**Tasks**

* `GET /api/conversations` — list with last message and unread count.
* `GET /api/conversations/:id/messages` — keyset pagination, `limit + 1` sentinel, base64 cursor, returns `{ messages, nextCursor, hasMore }`.
* `POST /api/messages` — the full chokepoint from `CLAUDE.md` §2, with moderation steps stubbed as no-op functions that will be filled in Phases 4 and 5. Auth, membership check and idempotent upsert are real from the start.
* `POST /api/conversations/:id/read`.
* Client: conversation list, message list, composer. Optimistic send keyed by `clientMsgId`. Infinite scroll upward.
* Unified error envelope and the code enum wired through both sides.

**Done when**

* Two browser profiles can exchange messages, visible after refresh.
* Scrolling to the top of the 12,000-message thread pages smoothly and terminates correctly at the beginning of history.
* POSTing the same `clientMsgId` twice creates exactly one row. Verify with curl.
* Requesting a conversation you are not a member of returns 403 with `NOT_A_MEMBER`.

---

## Phase 2 — Realtime layer · `3:00–5:00` · AUTO

**Goal:** live delivery, typing, presence, read receipts, multi-tab correctness.

**Tasks**

* `/apps/ws`: standalone Socket.IO service. Auth the handshake off the same signed cookie. On connect, join `user:{userId}` plus a room per conversation.
* Internal fanout endpoint on the WS service, guarded by a shared-secret header. Only the Next.js API calls it. Never exposed to browsers.
* `POST /api/messages` fires the fanout after a successful commit.
* Typing: throttled emit, 2s idle stop, **5s receiver-side TTL expiry**.
* Presence: online on connect, offline only after \~10s with no socket for that user.
* Read receipts: `POST .../read` updates `Membership`, fans out `message:read` to the conversation *and* to the reader's own `user:` room so their other tabs sync.
* Client socket layer: single connection, event handlers reconcile into the same store the HTTP layer writes to, matching on `clientMsgId`.

**Done when**

* Message appears in the other window with no refresh, visibly under \~200ms locally.
* Typing indicator appears and reliably disappears, including when `typing:stop` is dropped (test by killing the sender's tab mid-type).
* Same account open in two tabs: sending in tab A shows exactly one bubble in tab B; reading in tab A clears the unread badge in tab B.
* Refreshing a page does not make that user blink offline in the other window.

---

## Phase 3 — UI pass · `5:00–7:00` · AUTO → 🛑 CHECKPOINT 2

**Goal:** the surface that carries the UI/UX score. Build everything in `CLAUDE.md` §8.

**Tasks**

* Layout, type scale, spacing, near-monochrome palette with a single accent.
* Message grouping within 5 minutes, day dividers, avatar suppression.
* The four-state tick machine with 150ms transitions.
* All three scroll behaviors — especially `scrollTop` restoration on prepend.
* New-messages pill. Skeleton bubbles. Empty state as an invitation to act.
* Connection pill with the 800ms delay.
* Responsive collapse below 768px, `100dvh`, safe-area composer.
* Keyboard shortcuts, focus rings, `prefers-reduced-motion`.
* One-click demo sign-in buttons and "Open second window".

**Done when**

* Prepending an older page produces zero viewport jump. Verify by video, not by feel.
* Scrolled up 500px, an incoming message does not yank the view; the pill appears.
* 390px viewport is fully usable with the software keyboard open.
* Tab-only navigation reaches every interactive element with a visible ring.

> ### 🛑 CHECKPOINT 2 — Visual review
>
> Screenshot four states: desktop conversation open, mobile 390px, the scrolled-up state with the new-messages pill, and a message mid-`sending`. Name anything you think reads as generic. Wait for a reply before proceeding.

---

## Phase 4 — Profanity and rate limiting · `7:00–8:30` · AUTO

**Goal:** the cheapest full-marks item on the rubric. Do it properly.

**Tasks**

* `packages/shared/moderation/normalize.ts` — the six-step pipeline from `CLAUDE.md` §6, as a pure function.
* Allowlist for the Scunthorpe problem.
* **Unit tests** covering: plain hit, casing, `f u c k`, `f.u.c.k`, `fuuuck`, leet `sh1t`, Cyrillic homoglyph, and every allowlist term passing clean. Aim for \~25 cases.
* Wire into `POST /api/messages` before the insert. Return 422 `PROFANITY_BLOCKED` with the matched term in `details`.
* In-memory token-bucket rate limiter on sends, presign and uploads.

**Done when**

* Test suite green.
* `curl` posting `sh1t` directly to the API is blocked — no browser involved. This exact command goes in the README and the recording.
* 25 rapid sends trip a 429 with `RATE_LIMITED`.

---

## Phase 5 — Image pipeline · `8:30–10:30` · AUTO → 🛑 CHECKPOINT 3

**Goal:** the full quarantine architecture. The classifier behind it is deliberately naive and honestly labelled.

**Tasks**

* R2 private bucket, `quarantine/` and `media/` prefixes.
* `POST /api/uploads/presign` — presigned PUT with content-type and content-length conditions baked into the signature.
* Client uploads direct to R2, then POSTs only the object key.
* Server: fetch from quarantine → magic-byte type check with `file-type` → moderate.
* `ImageModerator` interface + `SkinRatioModerator` (sharp, 64×64, YCbCr ratio).
* Safe → copy to `media/`, delete quarantine object, insert row. Unsafe → delete object, 422 `IMAGE_REJECTED`, **no row created**.
* Reads via short-lived presigned GET. Lazy-load images with `IntersectionObserver`.
* UI: blurred local preview with "Checking image…", then the blocked-bubble state.

**Done when**

* A rejected image leaves no `Message` row and no surviving R2 object. Verify both.
* The recipient's window never renders the rejected image, not even briefly.
* Renaming a `.exe` to `.jpg` is rejected by magic bytes with `INVALID_FILE_TYPE`.
* A file over the cap is rejected by R2 itself, before reaching the app server.

> ### 🛑 CHECKPOINT 3 — Moderation framing
>
> Report the measured threshold and false-positive rate across \~10 ordinary test images (faces, beach, food, screenshots). Then propose the exact README wording covering: the heuristic's nature, its high FPR, its known skin-tone bias, and NSFWJS as the documented drop-in. Wait for a reply — this wording is the difference between a scoped decision and a hidden weakness.

---

## Phase 6 — GIF and sticker pickers · `10:30–11:30` · AUTO

**Goal:** one scored line. Deliberately time-boxed. Do not gold-plate.

**Tasks**

* One picker shell, three tabs: Emoji, GIF, Sticker. Bottom sheet on mobile.
* GIF: Tenor or Giphy, 300ms debounced search, two-column masonry, `fixed_width_small` previews, `IntersectionObserver` lazy load, send the original URL.
* Stickers: one pack of static webp in `/public`, four-column grid.
* Both render as `MessageType.GIF` / `STICKER` with fixed intrinsic dimensions so the list does not reflow on load.

**Done when**

* Searching and sending a GIF does not cause a visible frame drop in the message list.
* No layout shift when GIFs load, because width and height are known ahead of paint.

> ### 🛑 CHECKPOINT 4 — Scope triage
>
> State elapsed time versus the \~14h budget and list what remains. Recommend what to cut, if anything. Default recommendation if behind: cut the emoji tab and the sticker pack before touching Phase 7. Wait for a reply.

---

## Phase 7 — Reliability hardening · `11:30–13:00` · AUTO

**Goal:** the segment of the demo that wins the interview.

**Tasks**

* Reconnect gap-fill: on `connect` after a drop, send the highest known cursor and pull missed messages over HTTP.
* Retry path on failed send, reusing the same `clientMsgId`, with the in-thread red bubble and inline Retry.
* Verify no duplicates across: retry, reconnect, double tab, and rapid double-submit.
* Multi-tab pass over every state: unread badges, read receipts, presence, typing.

**Done when**

* WS service killed → messages queue and send → service restarted → the gap fills with **zero duplicates and zero losses**. This is the single most important demo moment.
* Airplane-mode toggle mid-conversation recovers cleanly.
* Three windows (two accounts, one duplicated) stay consistent throughout.

---

## Phase 8 — Ship · `13:00–14:00` · AUTO → 🛑 CHECKPOINT 5

**Tasks**

* Deploy: Vercel (web) + Railway (ws) + Neon + R2. Seed production. Verify end-to-end on the deployed URL, not just locally.
* README, in this order:
  1. Live URL and the two demo logins.
  2. Architecture diagram — the HTTP-write / socket-read box.
  3. **Why writes go over HTTP and the socket is read-only.** Lead with this; it is the strongest decision in the submission.
  4. Data model, with every index justified by the query it serves.
  5. Reliability: idempotency, reconciliation, gap-fill, multi-session.
  6. Moderation: the profanity normalizer table, plus the image pipeline with model, inference location, size, latency and decision rule as required by the brief.
  7. Security checklist mapped one-to-one to the brief's seven bullets, each with its curl command.
  8. Deliberately out of scope, with one line each on why.
  9. Known limitations — the moderation heuristic first, stated plainly.
  10. Local setup.
* Recording script, in this order — strongest material first:
  1. Two windows side by side: live send, typing, read receipt.
  2. Scroll up through 12,000 messages: paging with no viewport jump.
  3. Profanity blocked in the UI, **then blocked again via raw curl** to prove it is not client-side.
  4. Explicit image blocked before delivery; the recipient's window never flickers.
  5. Kill the WS service, send messages, restart, gap fills with no duplicates.
  6. `curl` a conversation the account does not belong to → 403.

**Done when**

* The deployed URL works from a clean browser profile with no local state.
* Every curl command in the README runs successfully against production.

> ### 🛑 CHECKPOINT 5 — Submission review
>
> Present the full README and the recording script. Flag anything overstated against what actually shipped. Wait for a reply before recording.

---

## Running notes

Maintain `DECISIONS.md` alongside this file: every assumption made mid-phase, every tradeoff taken, with a one-line reason. It feeds the README and it is the evidence that the work was reasoned rather than generated.
