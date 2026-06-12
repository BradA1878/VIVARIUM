/* ============================================================================
   The Director — the planet's tactician (agent layer). It watches the colony and,
   on its own pacing, picks the hazard that would press the weak seam, escalating
   over the sols. It proposes via triggerHazard; the engine applies + logs it, so
   the deterministic core is untouched (the Director lives out here, doc §0).

   Pure decision in decide(); the store fires the command. Math.random is fine —
   this is the non-deterministic antagonist, not the engine.
   ============================================================================ */
import type { HazardKind, Snapshot } from "@shared/types";
import { scoreHazards } from "./scoring";

export interface Strike {
  kind: HazardKind;
  intensity: number;
}

export interface DirectorContext {
  /** per-hazard opening bias from cross-run memory (1 = neutral) */
  bias?: Record<HazardKind, number>;
  /** how settled the colony feels, 0..1 (from the Sentinel) — press harder when high */
  comfort?: number;
}

const BASE_GAP = 340;     // sim-seconds between hazards early on
const MIN_GAP = 200;      // floor even late — never faster than ~3.3 min apart
const SOL_RAMP = 6;       // gap shrinks this much per sol (gentle, for the long arc)
const FIRST_STRIKE = 220; // leave the player a sol+ to settle in
const REPEAT_PENALTY = 0.4; // discourage throwing the same hazard twice running

export class Director {
  private lastStrike = 0;
  private armed = false;
  private lastKind: HazardKind | null = null;

  /** decide whether to throw a hazard this observation, or null to wait */
  decide(s: Snapshot, jitter: () => number = Math.random, ctx: DirectorContext = {}): Strike | null {
    const comfort = ctx.comfort ?? 0.5;
    // one hazard at a time — never stack telegraphs/active events
    if (s.hazards.length > 0) return null;
    // breathing room: don't pile on while a pool is already going lethal
    if (s.timers.oxygen != null || s.timers.water != null || s.timers.food != null) return null;

    const gap = this.gap(s, comfort);
    if (!this.armed) { if (s.t < FIRST_STRIKE) return null; this.armed = true; this.lastStrike = s.t - gap; }
    if (s.t - this.lastStrike < gap) return null;

    // score by colony shape; bias toward how this player dies (fades as the run
    // matures into shape-based pressure); add jitter; pick the strongest seam
    const scores = scoreHazards(s);
    const biasWeight = Math.max(0, 1 - s.sol / 6);
    let best: HazardKind = "dust", bestV = -Infinity;
    for (const k of Object.keys(scores) as HazardKind[]) {
      const bias = ctx.bias ? 1 + (ctx.bias[k] - 1) * biasWeight : 1;
      let v = scores[k] * bias + jitter() * 0.3;
      if (k === this.lastKind) v *= REPEAT_PENALTY; // variety — don't spam one kind
      if (v > bestV) { bestV = v; best = k; }
    }

    this.lastStrike = s.t;
    this.lastKind = best;
    return { kind: best, intensity: this.intensity(s, comfort) };
  }

  reset(): void {
    this.lastStrike = 0;
    this.armed = false;
    this.lastKind = null;
  }

  /** strikes come faster as the colony matures — and faster still when the
   *  player has grown comfortable (the planet stops letting you settle) */
  private gap(s: Snapshot, comfort: number): number {
    return Math.max(MIN_GAP, (BASE_GAP - s.sol * SOL_RAMP) * (1 - 0.25 * comfort));
  }

  /** and harder, also nudged up by comfort */
  private intensity(s: Snapshot, comfort: number): number {
    return Math.min(1, 0.35 + s.sol * 0.04 + 0.2 * comfort);
  }
}
