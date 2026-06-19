/* ============================================================================
   PerfGovernor — the renderer's adaptive-quality policy, pure and unit-testable
   (no DOM/three imports; the renderer owns the clocks and the levers). Each
   frame it is fed the measured cost of the frame BODY — the time spent inside
   the update+render work, never the inter-frame delta, which the fps throttle
   clamps to the cap and so says nothing about headroom. It walks a ladder of
   quality steps: demote when the smoothed cost crowds the current step's frame
   budget, promote when there is deep sustained headroom at the next-better
   step — behind a calibration window, contiguous sustain evidence, and a
   cooldown so it never flaps. pin() snaps + freezes it (the explicit LOW/HIGH
   tiers); un-pinning is AUTO. The sim is untouched by all of this: the worker
   ticks at its fixed cadence whatever the render rate does.
   ============================================================================ */

export interface PerfStep {
  /** render-loop fps cap */
  fps: number;
  /** device-pixel-ratio cap (the actual DPR still floors it) */
  ratio: number;
  bloom: boolean;
  shadows: boolean;
}

/** the quality ladder, best first — STEP_HIGH is the HIGH tier and the AUTO
 *  start (60fps at full quality); the governor demotes down it under load — it
 *  sheds fps first (60→30), then resolution/effects. STEP_LOW ≈ today's LOW */
export const LADDER: readonly PerfStep[] = [
  { fps: 60, ratio: 1.5, bloom: true, shadows: true },
  { fps: 30, ratio: 1.5, bloom: true, shadows: true },
  { fps: 30, ratio: 1.25, bloom: true, shadows: true },
  { fps: 30, ratio: 1.0, bloom: true, shadows: false },
  { fps: 30, ratio: 1.0, bloom: false, shadows: false },
];

/** ladder indices the explicit quality tiers pin to. AUTO starts here too
 *  (startStep) — optimistic at 60fps, and the governor auto-demotes any machine
 *  that can't hold it, so the adaptive behaviour is preserved, just top-down. */
export const STEP_HIGH = 0;
export const STEP_LOW = LADDER.length - 1;

/** standard display refresh rates — a noisy rAF-measured rate snaps to the
 *  nearest of these so the frame-pacing divisor is a clean integer */
const COMMON_HZ = [24, 30, 60, 90, 120, 144, 165, 240] as const;

/** snap a measured refresh rate (Hz) to the nearest standard panel rate, so a
 *  jittery rAF estimate like 119.7 becomes a clean 120 for the pacing stride */
export function snapHz(measured: number): number {
  let best: number = COMMON_HZ[0];
  let bestDelta = Math.abs(measured - best);
  for (const hz of COMMON_HZ) {
    const d = Math.abs(measured - hz);
    if (d < bestDelta) {
      best = hz;
      bestDelta = d;
    }
  }
  return best;
}

export interface PerfTunables {
  /** collect-only window after construction/reset — no transitions */
  calibrateMs: number;
  /** render-cost EMA time constant */
  emaTauMs: number;
  /** EMA above this share of the current step's frame budget (1000/fps)… */
  demoteFrac: number;
  /** …for this long → drop a step */
  demoteMs: number;
  /** EMA past this multiple of the budget (an egregious spike)… */
  spikeFactor: number;
  /** …for this long → drop a step fast */
  spikeMs: number;
  /** EMA below this share of the NEXT-BETTER step's budget… */
  promoteFrac: number;
  /** …for this long → climb a step */
  promoteMs: number;
  /** quiet period after ANY transition */
  cooldownMs: number;
  /** the ladder index a fresh/reset governor sits on */
  startStep: number;
}

export const TUNABLES: PerfTunables = {
  calibrateMs: 3000,
  emaTauMs: 1000,
  demoteFrac: 0.7,
  demoteMs: 2000,
  spikeFactor: 1.5,
  spikeMs: 500,
  promoteFrac: 0.4,
  promoteMs: 10_000,
  cooldownMs: 5000,
  startStep: STEP_HIGH,
};

// a sample gap past this (hidden tab, debugger pause) breaks the contiguous
// sustain evidence; the EMA's α is clamped too, so one late frame can't own it
const STALE_GAP_MS = 1000;
const EMA_MAX_DT_MS = 250;

export class PerfGovernor {
  /** raised on every step change (transition, pin snap, reset) — the consumer
   *  applies the new step and clears it */
  stepChanged = false;

  private readonly ladder: readonly PerfStep[];
  private readonly t: PerfTunables;
  private idx: number;
  private pinnedIdx: number | null = null;
  private emaMs: number | null = null;
  private lastSampleAt: number | null = null;
  /** the first sample after construction/reset — anchors the calibration window */
  private calibratedFrom: number | null = null;
  // contiguous-evidence anchors: when the EMA first crossed each threshold
  private overSince: number | null = null;
  private spikeSince: number | null = null;
  private underSince: number | null = null;
  private lastShiftAt: number | null = null;

  constructor(ladder: readonly PerfStep[] = LADDER, tunables: Partial<PerfTunables> = {}) {
    this.ladder = ladder;
    this.t = { ...TUNABLES, ...tunables };
    this.idx = this.clampIdx(this.t.startStep);
  }

  step(): PerfStep {
    return this.ladder[this.idx];
  }

  index(): number {
    return this.idx;
  }

  pinned(): number | null {
    return this.pinnedIdx;
  }

  /** DEV observability — one small object, built on demand (never per frame) */
  info(): { step: number; ema: number; pinned: number | null; calibrating: boolean } {
    return {
      step: this.idx,
      ema: this.emaMs ?? 0,
      pinned: this.pinnedIdx,
      calibrating: this.calibrating(this.lastSampleAt ?? 0),
    };
  }

  /** feed one frame's measured BODY cost — scalar state only, no allocations */
  sample(renderCostMs: number, nowMs: number): void {
    const rawDt = this.lastSampleAt == null ? 0 : Math.max(0, nowMs - this.lastSampleAt);
    this.lastSampleAt = nowMs;
    if (this.calibratedFrom == null) this.calibratedFrom = nowMs;
    // EMA: α from the sample gap (clamped), seeded by the first cost
    const a = 1 - Math.exp(-Math.min(rawDt, EMA_MAX_DT_MS) / this.t.emaTauMs);
    this.emaMs = this.emaMs == null ? renderCostMs : this.emaMs + (renderCostMs - this.emaMs) * a;
    if (this.pinnedIdx != null) return; // frozen: keep measuring, never move
    if (rawDt > STALE_GAP_MS) this.clearAnchors(); // a long gap voids the evidence

    // contiguous time over/under each threshold
    const ema = this.emaMs;
    const budget = 1000 / this.ladder[this.idx].fps;
    this.overSince = ema > budget * this.t.demoteFrac ? this.overSince ?? nowMs : null;
    this.spikeSince = ema > budget * this.t.spikeFactor ? this.spikeSince ?? nowMs : null;
    const headroom = this.idx > 0 && ema < (1000 / this.ladder[this.idx - 1].fps) * this.t.promoteFrac;
    this.underSince = headroom ? this.underSince ?? nowMs : null;

    if (this.calibrating(nowMs)) return; // collect only — no transitions yet
    if (this.lastShiftAt != null && nowMs - this.lastShiftAt < this.t.cooldownMs) return;

    const canDemote = this.idx < this.ladder.length - 1;
    if (canDemote && this.spikeSince != null && nowMs - this.spikeSince >= this.t.spikeMs) {
      this.shift(this.idx + 1, nowMs);
    } else if (canDemote && this.overSince != null && nowMs - this.overSince >= this.t.demoteMs) {
      this.shift(this.idx + 1, nowMs);
    } else if (this.idx > 0 && this.underSince != null && nowMs - this.underSince >= this.t.promoteMs) {
      this.shift(this.idx - 1, nowMs);
    }
  }

  /** snap to a step and freeze there (the explicit LOW/HIGH tiers); null un-pins
   *  and lets transitions resume from the current step on fresh evidence */
  pin(i: number | null): void {
    this.clearAnchors(); // either way, the sustain evidence restarts
    if (i == null) {
      this.pinnedIdx = null;
      return;
    }
    const idx = this.clampIdx(i);
    this.pinnedIdx = idx;
    if (idx !== this.idx) {
      this.idx = idx;
      this.stepChanged = true;
    }
  }

  /** forget everything measured and recalibrate from the next sample; a pinned
   *  governor stays snapped, an auto one returns to the start step */
  reset(): void {
    this.emaMs = null;
    this.lastSampleAt = null;
    this.calibratedFrom = null;
    this.lastShiftAt = null;
    this.clearAnchors();
    const home = this.pinnedIdx ?? this.clampIdx(this.t.startStep);
    if (home !== this.idx) {
      this.idx = home;
      this.stepChanged = true;
    }
  }

  private calibrating(nowMs: number): boolean {
    return this.calibratedFrom == null || nowMs - this.calibratedFrom < this.t.calibrateMs;
  }

  private shift(to: number, nowMs: number): void {
    this.idx = to;
    this.lastShiftAt = nowMs;
    this.clearAnchors();
    this.stepChanged = true;
  }

  private clearAnchors(): void {
    this.overSince = null;
    this.spikeSince = null;
    this.underSince = null;
  }

  private clampIdx(i: number): number {
    return Math.max(0, Math.min(this.ladder.length - 1, Math.floor(i)));
  }
}
