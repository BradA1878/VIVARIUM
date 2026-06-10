/* ============================================================================
   Colony morale — one colony-level scalar in [moraleFloor, 1], a pure function
   of state (zero RNG draws, doc §0). Crises and brownouts drain it; calm and
   campaign progress restore it; the big emits step it (MORALE_BUMP). The
   low/recovered pair latches like detectBrownout. moraleMult feeds the
   production pass and scales produces only — morale never touches movement,
   so a sad colony cannot death-spiral into a slow one.
   ============================================================================ */
import type { ColonyState } from "./state";
import type { Emit } from "./tick";
import { techMoraleFloor } from "./techs";
import {
  MORALE_FLOOR, MORALE_START, MORALE_EFF, MORALE_LOW_T, MORALE_OK_T,
  MORALE_CRISIS_RATE, MORALE_BROWNOUT_RATE, MORALE_CALM_RATE, MORALE_PROGRESS_RATE,
} from "./tuning";

/** the floor morale can sink to — MORALE_FLOOR, raised by alien tech (harmonizer) */
export function moraleFloor(s: ColonyState): number {
  return Math.max(MORALE_FLOOR, techMoraleFloor(s));
}

/** step morale by delta, clamped into [moraleFloor, 1] */
export function bumpMorale(s: ColonyState, delta: number): void {
  s.morale = Math.min(1, Math.max(moraleFloor(s), s.morale + delta));
}

/** production multiplier — exactly 1.0 at a fresh colony's MORALE_START */
export function moraleMult(s: ColonyState): number {
  return 1 + MORALE_EFF * (s.morale - MORALE_START);
}

/** the tick's morale pass (6b) — continuous drivers + the latched thresholds */
export function updateMorale(s: ColonyState, dt: number, emit: Emit): void {
  let crises = 0;
  for (const k of ["oxygen", "water", "food"] as const) if (s.timers[k] != null) crises += 1;
  let rate = -MORALE_CRISIS_RATE * crises;
  if (s.brownLatch) rate -= MORALE_BROWNOUT_RATE;
  if (crises === 0 && !s.brownLatch && s.population > 0) rate += MORALE_CALM_RATE;
  if (s.selfSufficientFor > 0) rate += MORALE_PROGRESS_RATE;
  bumpMorale(s, rate * dt);

  // latched threshold pair (mirrors detectBrownout)
  if (s.morale < MORALE_LOW_T && !s.moraleLatch) {
    s.moraleLatch = true;
    emit({ type: "morale_low" });
  }
  if (s.morale > MORALE_OK_T && s.moraleLatch) {
    s.moraleLatch = false;
    emit({ type: "morale_recovered" });
  }
}
