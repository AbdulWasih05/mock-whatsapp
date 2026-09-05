import "server-only";

// In-memory token bucket, keyed by userId (CLAUDE.md §6). Per-instance only
// — Redis is the documented multi-instance path, deliberately not built
// (see README "Deliberately out of scope").
type Bucket = { tokens: number; lastRefillAt: number };
type BucketName = "send" | "presign" | "upload";

const LIMITS: Record<BucketName, { capacity: number; windowMs: number }> = {
  send: { capacity: 20, windowMs: 10_000 },
  presign: { capacity: 10, windowMs: 60_000 },
  upload: { capacity: 5, windowMs: 60_000 },
};

const buckets = new Map<string, Bucket>();

function takeToken(key: string, capacity: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key) ?? { tokens: capacity, lastRefillAt: now };

  const elapsedMs = now - bucket.lastRefillAt;
  bucket.tokens = Math.min(capacity, bucket.tokens + (elapsedMs / windowMs) * capacity);
  bucket.lastRefillAt = now;

  if (bucket.tokens < 1) {
    buckets.set(key, bucket);
    return false;
  }
  bucket.tokens -= 1;
  buckets.set(key, bucket);
  return true;
}

export function checkRateLimit(userId: string, bucket: BucketName): { limited: boolean } {
  const { capacity, windowMs } = LIMITS[bucket];
  const allowed = takeToken(`${bucket}:${userId}`, capacity, windowMs);
  return { limited: !allowed };
}
