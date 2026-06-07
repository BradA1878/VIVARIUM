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

const BASE_GAP = 110;     // sim-seconds between strikes early on
const MIN_GAP = 48;       // floor as it escalates
const FIRST_STRIKE = 120; // leave the player a sol or so to settle in

export class Director {
  private lastStrike = 0;
  private armed = false;

  /** decide whether to throw a hazard this observation, or null to wait */
  decide(s: Snapshot, jitter: () => number = Math.random): Strike | null {
    // one hazard at a time — never stack telegraphs/active events
    if (s.hazards.length > 0) return null;
    // breathing room: don't pile on while a pool is already going lethal
    if (s.timers.oxygen != null || s.timers.water != null || s.timers.food != null) return null;

    if (!this.armed) { if (s.t < FIRST_STRIKE) return null; this.armed = true; this.lastStrike = s.t - this.gap(s) ; }
    if (s.t - this.lastStrike < this.gap(s)) return null;

    // score, add unpredictability, pick the strongest seam
    const scores = scoreHazards(s);
    let best: HazardKind = "dust", bestV = -Infinity;
    for (const k of Object.keys(scores) as HazardKind[]) {
      const v = scores[k] + jitter() * 0.3;
      if (v > bestV) { bestV = v; best = k; }
    }

    this.lastStrike = s.t;
    return { kind: best, intensity: this.intensity(s) };
  }

  reset(): void {
    this.lastStrike = 0;
    this.armed = false;
  }

  /** strikes come faster as the colony matures */
  private gap(s: Snapshot): number {
    return Math.max(MIN_GAP, BASE_GAP - s.sol * 5);
  }

  /** and harder */
  private intensity(s: Snapshot): number {
    return Math.min(1, 0.4 + s.sol * 0.045);
  }
}
