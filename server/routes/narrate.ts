/* ============================================================================
   POST /api/narrate — the live VIVARIUM voice endpoint. Rate-limited, cached by
   event signature, and gated so a public, auth-free Easter egg can't become a
   cost faucet (doc §3.2). On any miss it returns a non-200 and the client falls
   back to its scripted line bank — the game never depends on this.
   ============================================================================ */
import { Hono } from "hono";
import { generateLine, liveAvailable } from "../mxf/claude";
import { allowRequest } from "../ratelimit";

export const narrate = new Hono();

interface CacheEntry {
  line: string;
  at: number;
}
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 25_000;

function signature(event: { type?: string; res?: string }): string {
  return `${event.type ?? "?"}:${event.res ?? ""}`;
}

narrate.post("/narrate", async (c) => {
  if (!liveAvailable()) {
    return c.json({ error: "live narrator unavailable", fallback: "scripted" }, 503);
  }

  let body: { event?: Record<string, unknown>; snapshot?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad request" }, 400);
  }
  const event = body.event;
  if (!event || typeof event !== "object") {
    return c.json({ error: "missing event" }, 400);
  }

  const now = Date.now();

  // cache by event signature — repeats within the window reuse a line
  const sig = signature(event as { type?: string; res?: string });
  const cached = cache.get(sig);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return c.json({ line: cached.line, source: "cache" });
  }

  // rate limit per client (no auth on a public toy)
  const key =
    c.req.header("x-forwarded-for")?.split(",")[0].trim() ||
    c.req.header("x-real-ip") ||
    "local";
  if (!allowRequest(key, now)) {
    return c.json({ error: "rate limited", fallback: "scripted" }, 429);
  }

  const line = await generateLine(event, body.snapshot ?? null);
  if (!line) {
    return c.json({ error: "generation failed", fallback: "scripted" }, 502);
  }

  cache.set(sig, { line, at: now });
  return c.json({ line, source: "live" });
});
