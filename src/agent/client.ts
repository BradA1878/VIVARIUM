/* ============================================================================
   Live-narrator client. Calls the Hono /api/narrate endpoint (which holds the
   provider key) and returns one line, or null on ANY failure so the caller can
   fall back to the scripted bank. The provider key never reaches the browser
   (doc §3.2). Live generation is opt-in (VITE_LIVE_NARRATOR=1).
   ============================================================================ */
import type { ColonyEvent, Snapshot } from "@shared/types";

export const LIVE_ENABLED = import.meta.env.VITE_LIVE_NARRATOR === "1";

// Circuit breaker: if the narrator server is down (or absent), stop hammering it.
// After a few consecutive failures we go quiet for a while — the council just
// speaks its scripted lines until the endpoint comes back. (Agent layer, main
// thread — Date.now() is fine here; the determinism rule is the engine's, doc §0.)
const FAIL_THRESHOLD = 3;
const COOLDOWN_MS = 30_000;
let consecutiveFailures = 0;
let disabledUntil = 0;

function recordFailure(): void {
  if (++consecutiveFailures >= FAIL_THRESHOLD) {
    disabledUntil = Date.now() + COOLDOWN_MS;
    consecutiveFailures = 0;
  }
}

/** read-only breaker state for the UI: true while the circuit is closed (live
 *  lines will be attempted), false while it is open and the council is speaking
 *  from the scripted bank. Display only — it never changes narration behavior. */
export function liveNarratorHealthy(): boolean {
  return Date.now() >= disabledUntil;
}

/** a compact snapshot for the prompt — just what gives the line its context */
function slim(s: Snapshot | null) {
  if (!s) return null;
  return {
    sol: s.sol,
    weather: s.weather,
    population: s.population,
    dead: s.dead,
    solarPct: Math.round(s.solarMul * 100),
    pools: {
      power: Math.round(s.pools.power.amount),
      oxygen: Math.round(s.pools.oxygen.amount),
      water: Math.round(s.pools.water.amount),
      food: Math.round(s.pools.food.amount),
    },
  };
}

export async function narrateLive(
  event: ColonyEvent,
  snapshot: Snapshot | null,
  persona = "vivarium",
): Promise<string | null> {
  if (Date.now() < disabledUntil) return null; // breaker open — don't even try
  try {
    const res = await fetch("/api/narrate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, snapshot: slim(snapshot), persona }),
    });
    if (!res.ok) { recordFailure(); return null; } // 429 / 502 / 503 → scripted
    consecutiveFailures = 0;
    const data = (await res.json()) as { line?: unknown };
    return typeof data.line === "string" && data.line ? data.line : null;
  } catch {
    recordFailure();
    return null; // network down / server off → scripted fallback
  }
}
