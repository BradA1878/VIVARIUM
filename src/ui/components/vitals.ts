/* Pure formatting for the phone VitalsStrip (tier 2, spec §2) — the astronaut's
   one-line colony readout. Node-safe on purpose. */
import type { Pool } from "@shared/types";

export type Trend = "up" | "down" | "flat";

/** |flow| under this reads as holding steady — hides the rail's ± jitter */
const FLAT_EPS = 0.05;

export function trendOf(flow: number): Trend {
  if (flow > FLAT_EPS) return "up";
  if (flow < -FLAT_EPS) return "down";
  return "flat";
}

export function vitalText(pool: Pool): string {
  return `${Math.round(pool.amount)}/${pool.capacity}`;
}
