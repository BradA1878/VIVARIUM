/* ============================================================================
   Live-narrator client. Calls the Hono /api/narrate endpoint (which holds the
   provider key) and returns one line, or null on ANY failure so the caller can
   fall back to the scripted bank. The provider key never reaches the browser
   (doc §3.2). Live generation is opt-in (VITE_LIVE_NARRATOR=1).
   ============================================================================ */
import type { ColonyEvent, Snapshot } from "@shared/types";

export const LIVE_ENABLED = import.meta.env.VITE_LIVE_NARRATOR === "1";

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

export async function narrateLive(event: ColonyEvent, snapshot: Snapshot | null): Promise<string | null> {
  try {
    const res = await fetch("/api/narrate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, snapshot: slim(snapshot) }),
    });
    if (!res.ok) return null; // 429 / 502 / 503 → scripted fallback
    const data = (await res.json()) as { line?: unknown };
    return typeof data.line === "string" && data.line ? data.line : null;
  } catch {
    return null; // network down / server off → scripted fallback
  }
}
