/* ============================================================================
   Wind — a PURE curve of (sol, tod, active dust). A derivation, never a draw
   (doc §0): zero RNG, so both rng streams are untouched and replay/save hold.
   Deliberately anti-correlated with solar — trough near solar noon, peak at
   night, boosted while dust is active (storms ARE wind) — so a turbine is the
   panel's complement, not a cheaper panel. Knobs live in tuning.ts.
   ============================================================================ */
import {
  WIND_BASE_LEVEL, WIND_DIURNAL, WIND_DUST_BOOST, WIND_MIN, WIND_SWELL,
  WIND_SWELL_PERIOD,
} from "./tuning";
import type { ColonyState } from "./state";

/** the strongest active dust hazard right now, 0..1 (telegraphs don't blow) */
function maxActiveDustIntensity(s: ColonyState): number {
  let max = 0;
  for (const h of s.hazards) {
    if (h.kind === "dust" && h.phase === "active" && h.intensity > max) max = h.intensity;
  }
  return max;
}

/** current wind level, clamped to [WIND_MIN, 1]. 0.51 is solar noon (the
 *  DAY_START..DAY_END midpoint), so the diurnal term bottoms exactly when the
 *  panels peak. */
export function windLevel(s: ColonyState): number {
  const raw = WIND_BASE_LEVEL
    - WIND_DIURNAL * Math.cos(2 * Math.PI * (s.tod - 0.51))
    + WIND_SWELL * Math.sin((2 * Math.PI * (s.sol + s.tod)) / WIND_SWELL_PERIOD)
    + WIND_DUST_BOOST * maxActiveDustIntensity(s);
  return Math.max(WIND_MIN, Math.min(1, raw));
}
