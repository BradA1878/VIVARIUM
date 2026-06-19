/* ============================================================================
   PerfGovernor tests — the adaptive-quality ladder's pure policy core. The
   module imports nothing from the DOM or three, so these run in plain Node on
   a synthetic clock: feed() plays constant-cost frames at a ~30fps cadence and
   the assertions pin the calibration window, the sustain/cooldown timings, and
   the pin/reset semantics the renderer builds on.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { PerfGovernor, LADDER, STEP_HIGH, STEP_LOW, snapHz } from "./perf";

/** play frames of one cost from fromMs (inclusive) to untilMs (exclusive) at a
 *  fixed cadence; returns the next un-fed timestamp so phases chain contiguously */
function feed(g: PerfGovernor, costMs: number, fromMs: number, untilMs: number, stepMs = 33): number {
  let t = fromMs;
  for (; t < untilMs; t += stepMs) g.sample(costMs, t);
  return t;
}

describe("PerfGovernor ladder", () => {
  it("starts on the HIGH step of the documented ladder", () => {
    const g = new PerfGovernor();
    expect(g.index()).toBe(STEP_HIGH);
    expect(g.step()).toEqual({ fps: 60, ratio: 1.5, bloom: true, shadows: true });
    expect(g.stepChanged).toBe(false);
    expect(LADDER).toHaveLength(5);
    expect(LADDER[0]).toEqual({ fps: 60, ratio: 1.5, bloom: true, shadows: true });
    expect(LADDER[STEP_LOW]).toEqual({ fps: 30, ratio: 1.0, bloom: false, shadows: false });
  });

  it("AUTO starts at 60fps but still auto-demotes when the machine can't hold it", () => {
    const g = new PerfGovernor(); // AUTO (un-pinned): optimistic on capable hardware…
    expect(g.step().fps).toBe(60);
    // …but a machine that can't sustain 60 blows the 16.7ms budget — the governor
    // must still walk the ladder down on its own (this is the machine auto-adjust)
    feed(g, 40, 0, 6000);
    expect(g.index()).toBeGreaterThan(STEP_HIGH);
    expect(g.step().fps).toBe(30); // sheds fps first, keeping full visual quality
  });

  it("the calibration window collects without transitions", () => {
    const g = new PerfGovernor();
    const t = feed(g, 80, 0, 2900); // hopeless cost from the very first frame
    expect(g.index()).toBe(STEP_HIGH);
    expect(g.stepChanged).toBe(false);
    feed(g, 80, t, 3300); // …and the verdict lands as soon as the window closes
    expect(g.index()).toBe(STEP_HIGH + 1);
    expect(g.stepChanged).toBe(true);
  });

  it("sustained high cost demotes exactly one step per cooldown", () => {
    const g = new PerfGovernor(LADDER, { startStep: 1 }); // mid-ladder: isolate the demote mechanics
    // neutral warm-up: 15ms sits between the promote and demote bands
    let t = feed(g, 15, 0, 4000);
    expect(g.index()).toBe(1);
    // the scene grows heavy — 28ms against the 33.3ms budget (70% = 23.3)
    t = feed(g, 28, t, 6900); // EMA crosses ~23.3 at ~5.0s; the 2s sustain isn't done
    expect(g.index()).toBe(1);
    t = feed(g, 28, t, 7500); // sustained → one step down
    expect(g.index()).toBe(2);
    t = feed(g, 28, t, 11900); // still over budget, but the cooldown holds it
    expect(g.index()).toBe(2);
    t = feed(g, 28, t, 12600); // cooldown over → exactly one more step
    expect(g.index()).toBe(3);
    t = feed(g, 28, t, 16900);
    expect(g.index()).toBe(3);
    t = feed(g, 28, t, 17600);
    expect(g.index()).toBe(4);
    feed(g, 28, t, 30000); // never demotes past the bottom step
    expect(g.index()).toBe(4);
  });

  it("an egregious sustained spike demotes fast", () => {
    const g = new PerfGovernor(LADDER, { startStep: 1 });
    let t = feed(g, 15, 0, 5000); // neutral, past calibration
    expect(g.index()).toBe(1);
    t = feed(g, 200, t, 5600); // EMA rockets past 1.5× budget, but not for 0.5s yet
    expect(g.index()).toBe(1);
    feed(g, 200, t, 6300); // spike path fires (the slow 2s-over path lands ~7.0s)
    expect(g.index()).toBe(2);
  });

  it("sustained headroom promotes after ~10s", () => {
    const g = new PerfGovernor(LADDER, { startStep: 1 }); // start below the top so a promote is possible
    // deep headroom against step0's 16.7ms budget (40% = 6.7)
    let t = feed(g, 4, 0, 9800);
    expect(g.index()).toBe(1); // not yet — the promote sustain is ~10s
    t = feed(g, 4, t, 10300);
    expect(g.index()).toBe(0);
    expect(g.step().fps).toBe(60);
    feed(g, 4, t, 60000); // never promotes past the top step
    expect(g.index()).toBe(0);
  });

  it("cooldown prevents oscillation on noisy alternating input", () => {
    const g = new PerfGovernor();
    // a pathological seesaw: 4s heavy / 4s light, repeating for 36s
    const marks: { t: number; idx: number }[] = [];
    let t = 0;
    for (let phase = 0; phase < 9; phase++) {
      const cost = phase % 2 === 0 ? 28 : 3;
      for (; t < (phase + 1) * 4000; t += 33) {
        g.sample(cost, t);
        marks.push({ t, idx: g.index() });
      }
    }
    const shifts: { t: number; from: number; to: number }[] = [];
    for (let i = 1; i < marks.length; i++) {
      if (marks[i].idx !== marks[i - 1].idx) {
        shifts.push({ t: marks[i].t, from: marks[i - 1].idx, to: marks[i].idx });
      }
    }
    // it moves — but every move is a single demotion (the 4s light phases never
    // last the ~10s a promotion needs, so it cannot flap back up)…
    expect(shifts.length).toBeGreaterThan(0);
    for (const s of shifts) expect(s.to).toBe(s.from + 1);
    // …and consecutive moves sit at least a full cooldown apart
    for (let i = 1; i < shifts.length; i++) {
      expect(shifts[i].t - shifts[i - 1].t).toBeGreaterThanOrEqual(5000);
    }
  });

  it("pin() snaps, freezes, and un-pin resumes from the current step", () => {
    const g = new PerfGovernor();
    g.pin(STEP_LOW);
    expect(g.index()).toBe(STEP_LOW);
    expect(g.stepChanged).toBe(true);
    g.stepChanged = false;
    let t = feed(g, 1, 0, 30000); // promote-grade headroom for 30s — frozen
    expect(g.index()).toBe(STEP_LOW);
    expect(g.stepChanged).toBe(false);
    g.pin(0);
    expect(g.index()).toBe(0);
    t = feed(g, 200, t, 60000); // demote-grade load for 30s — frozen
    expect(g.index()).toBe(0);
    g.stepChanged = false;
    g.pin(null); // AUTO: the warm EMA + fresh sustain evidence move it again
    feed(g, 200, t, 61000);
    expect(g.index()).toBe(1); // one spike demotion, then the cooldown holds
    expect(g.stepChanged).toBe(true);
    g.pin(99); // out-of-range pins clamp into the ladder
    expect(g.index()).toBe(STEP_LOW);
  });

  it("reset() returns to the start step and recalibrates", () => {
    const g = new PerfGovernor(LADDER, { startStep: 1 });
    let t = feed(g, 28, 0, 4000); // overload through calibration → demoted at ~3s
    expect(g.index()).toBe(2);
    g.reset();
    expect(g.index()).toBe(1); // home again, and the flag says to re-apply
    expect(g.stepChanged).toBe(true);
    g.stepChanged = false;
    t = feed(g, 60, t, 6900); // a fresh ~3s collect-only window from the next sample
    expect(g.index()).toBe(1);
    feed(g, 60, t, 8000); // window over → the sustained overload moves it again
    expect(g.index()).toBe(2);
  });

  it("info() reports the EMA, pin, and calibration state for the dev overlay", () => {
    const g = new PerfGovernor(LADDER, { startStep: 1 });
    expect(g.info().calibrating).toBe(true);
    feed(g, 10, 0, 5000); // 10ms is neutral at step1 — nothing moves
    const i = g.info();
    expect(i.step).toBe(1);
    expect(i.ema).toBeCloseTo(10, 1);
    expect(i.pinned).toBeNull();
    expect(i.calibrating).toBe(false);
    g.pin(STEP_LOW);
    expect(g.info().pinned).toBe(STEP_LOW);
  });

  it("honors an injected ladder and tunables", () => {
    const g = new PerfGovernor(
      [
        { fps: 60, ratio: 1, bloom: false, shadows: false },
        { fps: 30, ratio: 1, bloom: false, shadows: false },
      ],
      { startStep: 0, calibrateMs: 0, demoteMs: 100, cooldownMs: 0 },
    );
    feed(g, 14, 0, 500); // 14ms > 70% of the 16.7ms budget — demotes on the fast clock
    expect(g.index()).toBe(1);
    feed(g, 14, 500, 1000); // a two-step ladder still never leaves the bottom
    expect(g.index()).toBe(1);
  });
});

describe("snapHz", () => {
  it("snaps a jittery rAF-measured rate to the nearest standard panel rate", () => {
    expect(snapHz(119.8)).toBe(120); // ProMotion, measured a touch low
    expect(snapHz(60.1)).toBe(60);
    expect(snapHz(59.6)).toBe(60);
    expect(snapHz(58)).toBe(60); // closer to 60 than 30
    expect(snapHz(90.3)).toBe(90);
    expect(snapHz(144.2)).toBe(144);
    expect(snapHz(165)).toBe(165);
    expect(snapHz(240)).toBe(240);
  });
});
