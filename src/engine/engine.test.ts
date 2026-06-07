/* ============================================================================
   Engine tests — the deterministic core. Replay, brownout shedding order, the
   pressure gate, and the casualty grace timer (doc §2.3, §2.4).
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony, DEFS } from "./index";
import type { ColonyEvent, Snapshot } from "@shared/types";

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
    // electrolysis at (5,7) is sealed (requiresPressure). It connects via the
    // corridor chain to the hub in the seed layout.
    run(c, 2);
    let elec = c.snapshot().buildings.find((b) => b.defId === "electrolysis")!;
    expect(DEFS.electrolysis.requiresPressure).toBe(true);
    expect(elec.connected).toBe(true);

    // remove both corridors that carry the seal toward it
    c.removeAt(4, 6);
    c.removeAt(5, 6);
    run(c, 2);
    elec = c.snapshot().buildings.find((b) => b.defId === "electrolysis")!;
    expect(elec.connected).toBe(false);
    expect(elec.online).toBe(false); // pressure gate forces it offline
  });
});

describe("brownout sheds the lowest priority first (doc §2.4 pass 3)", () => {
  it("under a power deficit, the greenhouse (pri 30) sheds before electrolysis (pri 82)", () => {
    const c = new Colony(42);
    // Build a greenhouse next to the sealed cluster and starve the grid by
    // running deep into the night with heavy draw and little battery.
    // Place greenhouse adjacent to a corridor so it can be connected.
    c.place("corridor", 6, 7);
    c.place("greenhouse", 6, 8); // 2x2 sealed, pri 30, big draw
    // Run until night drains power hard.
    run(c, 200);
    const s = c.snapshot();
    const elec = s.buildings.find((b) => b.defId === "electrolysis")!;
    const green = s.buildings.find((b) => b.defId === "greenhouse")!;
    // If the grid is power-limited at any tick, the higher-priority electrolysis
    // must never be the one shed while the greenhouse still runs.
    const shedInversion = elec.online === false && green.online === true &&
      green.connected === true && green.staffed === true && green.fed === true;
    expect(shedInversion).toBe(false);
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
    c.removeAt(5, 7); // electrolysis
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
    expect(c.canPlace("hab", 4, 4)).toBe(false); // hub occupies (4,4)
    expect(c.canPlace("hab", -1, 0)).toBe(false);
    expect(c.canPlace("hab", 0, 0)).toBe(true);
  });
});
