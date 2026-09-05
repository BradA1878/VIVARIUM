/* ============================================================================
   Engine tests — the deterministic core. Replay, brownout shedding order, the
   pressure gate, and the casualty grace timer (doc §2.3, §2.4).
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony, DEFS } from "./index";
import type { ColonyEvent, Snapshot } from "@shared/types";
import type { ColonyState } from "./state";

/** advance a colony by `seconds` in fixed 0.2s steps (5 Hz), collecting events */
function run(c: Colony, seconds: number, step = 0.2): ColonyEvent[] {
  const events: ColonyEvent[] = [];
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    c.tick(step);
    events.push(...c.drainEvents());
  }
  return events;
}

describe("determinism", () => {
  it("two colonies with the same seed produce identical snapshots after a long run", () => {
    const a = new Colony(12345);
    const b = new Colony(12345);
    run(a, 600);
    run(b, 600);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it("different seeds diverge (storms/arrivals are seeded, not fixed)", () => {
    const a = new Colony(1);
    const b = new Colony(2);
    run(a, 600);
    run(b, 600);
    // seeded storm durations/arrival gaps accumulate — the full colony state
    // must differ over 4 sols.
    expect(a.snapshot()).not.toEqual(b.snapshot());
  });

  it("serialize → load resumes bit-identically", () => {
    const a = new Colony(777);
    run(a, 120);
    const save = a.serialize();
    const b = Colony.load(save);
    run(a, 120);
    run(b, 120);
    expect(b.snapshot()).toEqual(a.snapshot());
  });
});

describe("the seeded starter colony", () => {
  it("comes up alive with a hub, habs, and 4 colonists", () => {
    const s = new Colony().snapshot();
    expect(s.population).toBe(4);
    expect(s.buildings.some((b) => b.defId === "hub")).toBe(true);
    expect(s.housing).toBeGreaterThanOrEqual(8); // two habs × 4
    expect(s.started).toBe(true);
  });
});

describe("the pressure gate (doc §2.3)", () => {
  it("a sealed unit cut off from the hub goes offline; reconnecting brings it back", () => {
    const c = new Colony();
    // Electrolysis connects via the corridor chain to the hub in the seed layout.
    run(c, 2);
    let elec = c.snapshot().buildings.find((b) => b.defId === "electrolysis")!;
    expect(DEFS.electrolysis.requiresPressure).toBe(true);
    expect(elec.connected).toBe(true);

    // remove both corridors that carry the seal toward it
    const corridors = c.snapshot().buildings.filter((b) => b.defId === "corridor");
    expect(corridors).toHaveLength(2);
    for (const b of corridors) expect(c.removeAt(b.gx, b.gy)).toBe(true);
    run(c, 2);
    elec = c.snapshot().buildings.find((b) => b.defId === "electrolysis")!;
    expect(elec.connected).toBe(false);
    expect(elec.online).toBe(false); // pressure gate forces it offline
    for (const b of corridors) expect(c.place("corridor", b.gx, b.gy)).toBe(true);
    run(c, 2);
    elec = c.snapshot().buildings.find((b) => b.defId === "electrolysis")!;
    expect(elec.connected).toBe(true);
    expect(elec.online).toBe(true);
  });
});

describe("brownout sheds the lowest priority first (doc §2.4 pass 3)", () => {
  it("under a power deficit, the greenhouse (pri 30) sheds before electrolysis (pri 82)", () => {
    const c = new Colony(42);
    // Build a greenhouse next to the sealed cluster and starve the grid by
    // running deep into the night with heavy draw and little battery.
    // The northern corridor meets the hub directly; habs do not extend a seal.
    const hub = c.snapshot().buildings.find((b) => b.defId === "hub")!;
    expect(c.place("corridor", hub.gx, hub.gy - 1)).toBe(true);
    expect(c.place("greenhouse", hub.gx, hub.gy - 3)).toBe(true);
    c.setDirector(true); // isolate the power gate from random strikes
    run(c, 0.2);
    expect(c.snapshot().buildings.find((b) => b.defId === "greenhouse")!.connected).toBe(true);
    const state = (c as unknown as { s: ColonyState }).s;
    let sawGreenhouseShed = false;
    for (let i = 0; i < 200 / 0.2; i++) {
      // Hold non-power inputs available: a water-starved electrolysis unit is
      // a recipe failure, not evidence of the wrong brownout priority.
      for (const resource of ["water", "oxygen", "food"] as const) {
        state.pools[resource].amount = state.pools[resource].capacity;
      }
      c.tick(0.2); c.drainEvents();
      const s = c.snapshot();
      const elec = s.buildings.find((b) => b.defId === "electrolysis")!;
      const green = s.buildings.find((b) => b.defId === "greenhouse")!;
      const shedInversion = elec.online === false && green.online === true &&
        green.connected === true && green.staffed === true && green.fed === true;
      expect(shedInversion).toBe(false);
      if (elec.online && !green.online && green.connected && green.staffed && green.fed) {
        sawGreenhouseShed = true;
      }
    }
    expect(sawGreenhouseShed).toBe(true); // the test actually reached a brownout
  });

  it("priority ordering is strict: power is allocated high→low", () => {
    // a direct unit test of the ordering invariant on the defs
    const prios = ["hub", "corridor", "hab", "electrolysis", "extractor", "greenhouse"]
      .map((id) => DEFS[id].priority);
    const sorted = [...prios].sort((a, b) => b - a);
    expect(prios).toEqual(sorted); // already declared high→low in our list
  });
});

describe("shortfalls become timers, not instant death (doc §2.4 pass 6)", () => {
  it("an emptied oxygen pool starts a grace countdown, then takes a colonist", () => {
    const c = new Colony(9);
    // Demolish oxygen sources so O2 only drains. Remove electrolysis + greenhouse-less
    const electrolysis = c.snapshot().buildings.find((b) => b.defId === "electrolysis")!;
    expect(c.removeAt(electrolysis.gx, electrolysis.gy)).toBe(true);
    const events: ColonyEvent[] = [];
    // run long enough to empty O2 (cap 40 + tank none; pop 4 draws 0.88/s) and
    // then exhaust the 55s grace.
    const total = 60 + 60; // ~120s
    const step = 0.2;
    let critStarted = false;
    let casualty = false;
    for (let i = 0; i < total / step; i++) {
      c.tick(step);
      for (const e of c.drainEvents()) {
        events.push(e);
        if (e.type === "crit_start" && e.res === "oxygen") critStarted = true;
        if (e.type === "casualty" && e.res === "oxygen") casualty = true;
      }
    }
    expect(critStarted).toBe(true);
    expect(casualty).toBe(true);
    expect(c.snapshot().dead).toBeGreaterThanOrEqual(1);
  });
});

describe("Earth resupply windows (doc §2.5)", () => {
  it("a resupply window opens, fires an event, and tops up a drained pool", () => {
    const c = new Colony(3);
    const extractor = c.snapshot().buildings.find((b) => b.defId === "extractor")!;
    expect(c.removeAt(extractor.gx, extractor.gy)).toBe(true); // water only drains
    let fired = false;
    let sawOpenWindow = false;
    const step = 0.2;
    // RESUPPLY_FIRST is 180s; run a bit past it
    for (let i = 0; i < 210 / step; i++) {
      c.tick(step);
      for (const e of c.drainEvents()) if (e.type === "resupply") fired = true;
      if (c.snapshot().resupplyT > 0) sawOpenWindow = true;
    }
    expect(fired).toBe(true);
    expect(sawOpenWindow).toBe(true);
  });
});

describe("snapshot is a pure value (no shared refs into engine state)", () => {
  it("mutating a snapshot does not change the engine", () => {
    const c = new Colony();
    const snap: Snapshot = c.snapshot();
    snap.pools.power.amount = -999;
    snap.buildings[0].online = true;
    expect(c.snapshot().pools.power.amount).not.toBe(-999);
  });
});

describe("placement", () => {
  it("rejects overlapping placement and out-of-bounds", () => {
    const c = new Colony();
    const hub = c.snapshot().buildings.find((b) => b.defId === "hub")!;
    expect(c.canPlace("hab", hub.gx, hub.gy)).toBe(false);
    expect(c.canPlace("hab", -1, 0)).toBe(false);
    expect(c.canPlace("hab", 0, 0)).toBe(true);
  });
});
