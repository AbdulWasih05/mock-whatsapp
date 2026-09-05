import "server-only";
import type { InternalFanoutRequest } from "@wamock/shared";

// Fire-and-forget: a fanout failure must never fail the write that already
// committed (CLAUDE.md §2 chokepoint) — a missed live update is recovered by
// Phase 7's reconnect gap-fill, not by blocking the HTTP response here.
export async function fanout(request: InternalFanoutRequest): Promise<void> {
  const url = process.env.WS_INTERNAL_URL;
  const secret = process.env.WS_INTERNAL_SECRET;
  if (!url || !secret) return;

  try {
    await fetch(`${url}/internal/fanout`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": secret },
      body: JSON.stringify(request),
    });
  } catch (err) {
    console.error("fanout failed", err);
  }
}
