/* ============================================================================
   A tiny in-memory rate limiter — a public Easter egg has no auth, so every
   visitor can trigger calls. This is the cost-faucet guard (doc §3.2): a fixed
   token bucket per client key, refilling slowly.
   ============================================================================ */

interface Bucket {
  tokens: number;
  last: number;
}

const buckets = new Map<string, Bucket>();

const CAPACITY = 8; // burst
const REFILL_PER_SEC = 0.25; // ~1 line every 4s sustained

/** returns true if the request is allowed (and consumes a token) */
export function allowRequest(key: string, nowMs: number): boolean {
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: CAPACITY, last: nowMs };
    buckets.set(key, b);
  }
  const elapsed = (nowMs - b.last) / 1000;
  b.tokens = Math.min(CAPACITY, b.tokens + elapsed * REFILL_PER_SEC);
  b.last = nowMs;
  if (b.tokens >= 1) {
    b.tokens -= 1;
    return true;
  }
  return false;
}
