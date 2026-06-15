/* ============================================================================
   Colony.fastForward — the deterministic catch-up core (parallel-colonies Round 4).
   An away colony advances by a main-computed dt budget, replayed as the REAL tick
   in fixed CATCHUP_STEP sub-steps. Reproducible (same save + budget → byte-identical)
   so off-screen progression can genuinely kill a colony without forking determinism.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "./index";
import { SOL_LENGTH } from "./tuning";

describe("fastForward (catch-up)", () => {
  it("fastForward(0) is a no-op", () => {
    const a = new Colony(7);
    const before = a.snapshot();
    a.fastForward(0);
    expect(a.snapshot()).toEqual(before);
  });

  it("is reproducible — same seed + budget → byte-identical", () => {
    const a = new Colony(7), b = new Colony(7);
    a.fastForward(SOL_LENGTH * 3);
    b.fastForward(SOL_LENGTH * 3);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it("advances sim time by roughly the budget", () => {
    const a = new Colony(7);
    const sol0 = a.snapshot().sol;
    a.fastForward(SOL_LENGTH * 2);
    expect(a.snapshot().sol).toBeGreaterThan(sol0);
  });

  it("an unattended colony deterministically dies during a long catch-up", () => {
    const a = new Colony(7), b = new Colony(7);
    const ea = a.fastForward(SOL_LENGTH * 30, true); // collect events
    const eb = b.fastForward(SOL_LENGTH * 30, true);
    expect(a.snapshot().outcome).toBe("defeat"); // unattended colony reliably loses
    expect(b.snapshot().outcome).toBe(a.snapshot().outcome);
    expect(a.snapshot().sol).toBe(b.snapshot().sol); // same death sol
    expect(eb.map((e) => e.type)).toEqual(ea.map((e) => e.type)); // identical event stream
  });

  it("stops once the run ends — further catch-up is a no-op", () => {
    const a = new Colony(7);
    a.fastForward(SOL_LENGTH * 30); // dies
    const dead = a.snapshot();
    a.fastForward(SOL_LENGTH * 10);
    expect(a.snapshot()).toEqual(dead);
  });
});
