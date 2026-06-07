/* ============================================================================
   Director tests — it aims at the weak seam (scoring) and paces itself (decide).
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "@/engine";
import type { Snapshot } from "@shared/types";
import { scoreHazards, colonyShape } from "./scoring";
import { Director } from "./director";

/** a base snapshot we can mutate per test */
function snap(mut: (s: Snapshot) => void = () => {}): Snapshot {
  const s = new Colony().snapshot();
  mut(s);
  return s;
}

describe("scoring aims at the weak seam", () => {
  it("a battery-poor, solar-dependent colony invites flares more than a buffered one", () => {
    const buffered = scoreHazards(snap()); // seed has a battery (cap 200)
    const fragile = scoreHazards(snap((s) => { s.pools.power.capacity = 80; })); // no buffer
    expect(fragile.flare).toBeGreaterThan(buffered.flare);
    expect(colonyShape(snap((s) => { s.pools.power.capacity = 80; })).powerFragility)
      .toBeGreaterThan(colonyShape(snap()).powerFragility);
  });
});

describe("decide pacing", () => {
  it("holds fire until the colony has settled, then throws", () => {
    const d = new Director();
    expect(d.decide(snap((s) => { s.t = 10; }), () => 0)).toBeNull();   // too early
    const strike = d.decide(snap((s) => { s.t = 200; }), () => 0);      // armed + past gap
    expect(strike).not.toBeNull();
    expect(strike!.intensity).toBeGreaterThan(0);
  });

  it("never stacks onto an active hazard or a lethal crisis", () => {
    const d = new Director();
    d.decide(snap((s) => { s.t = 200; }), () => 0); // arm + fire once
    expect(d.decide(snap((s) => { s.t = 400; s.hazards = [{ kind: "dust", phase: "active", intensity: 1, remaining: 5 }]; }), () => 0)).toBeNull();
    expect(d.decide(snap((s) => { s.t = 400; s.timers = { oxygen: 10, water: null, food: null }; }), () => 0)).toBeNull();
  });

  it("escalates intensity with the sols", () => {
    const d1 = new Director(); const early = d1.decide(snap((s) => { s.t = 200; s.sol = 1; }), () => 0);
    const d2 = new Director(); const late = d2.decide(snap((s) => { s.t = 200; s.sol = 9; }), () => 0);
    expect(late!.intensity).toBeGreaterThan(early!.intensity);
  });
});
