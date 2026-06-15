/* ============================================================================
   Colony.fastForward — the deterministic catch-up core (parallel-colonies Round 4).
   An away colony advances by an integer count of fixed CATCHUP_STEP sub-steps (the
   step count computed main-side). Driving by a COUNT (not a float budget) makes it
   reproducible AND chunking-invariant, so the host can stream catch-up across frames
   without forking determinism — and off-screen progression can genuinely kill a
   colony reproducibly.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "./index";
import { SOL_LENGTH, CATCHUP_STEP } from "./tuning";

const STEPS_PER_SOL = Math.round(SOL_LENGTH / CATCHUP_STEP); // 1500

describe("fastForward (catch-up)", () => {
  it("fastForward(0) is a no-op", () => {
    const a = new Colony(7);
    const before = a.snapshot();
    a.fastForward(0);
    expect(a.snapshot()).toEqual(before);
  });

  it("is reproducible — same seed + step count → byte-identical", () => {
    const a = new Colony(7), b = new Colony(7);
    a.fastForward(STEPS_PER_SOL * 3);
    b.fastForward(STEPS_PER_SOL * 3);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it("is chunking-invariant — fastForward(i)+fastForward(j) === fastForward(i+j)", () => {
    // a SURVIVING colony (short total so outcome stays null) — this is the seam the
    // float-budget version broke: split vs single-shot must be byte-identical.
    const split = new Colony(7), whole = new Colony(7);
    split.fastForward(80);
    split.fastForward(120);
    whole.fastForward(200);
    expect(split.snapshot().outcome).toBeNull(); // still alive
    expect(split.snapshot()).toEqual(whole.snapshot());
  });

  it("advances sim time by roughly the step count", () => {
    const a = new Colony(7);
    const sol0 = a.snapshot().sol;
    a.fastForward(STEPS_PER_SOL * 2);
    expect(a.snapshot().sol).toBeGreaterThan(sol0);
  });

  it("an unattended colony deterministically dies during a long catch-up", () => {
    const a = new Colony(7), b = new Colony(7);
    const ea = a.fastForward(STEPS_PER_SOL * 30, true); // collect events
    const eb = b.fastForward(STEPS_PER_SOL * 30, true);
    expect(a.snapshot().outcome).toBe("defeat"); // unattended colony reliably loses
    expect(b.snapshot().outcome).toBe(a.snapshot().outcome);
    expect(a.snapshot().sol).toBe(b.snapshot().sol); // same death sol
    expect(eb.map((e) => e.type)).toEqual(ea.map((e) => e.type)); // identical event stream
  });

  it("a colony that dies mid-catch-up is chunking-invariant too (the outcome guard halts both)", () => {
    const split = new Colony(7), whole = new Colony(7);
    split.fastForward(STEPS_PER_SOL * 15);
    split.fastForward(STEPS_PER_SOL * 15);
    whole.fastForward(STEPS_PER_SOL * 30);
    expect(split.snapshot()).toEqual(whole.snapshot());
  });

  it("stops once the run ends — further catch-up is a no-op", () => {
    const a = new Colony(7);
    a.fastForward(STEPS_PER_SOL * 30); // dies
    const dead = a.snapshot();
    a.fastForward(STEPS_PER_SOL * 10);
    expect(a.snapshot()).toEqual(dead);
  });
});
