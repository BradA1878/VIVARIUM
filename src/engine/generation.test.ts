/* ============================================================================
   Generation economy tests — wind turbines ride a pure anti-solar weather
   curve, geothermal taps sit on world-gen vents, the fission reactor is a
   normal pass-4 producer, and the materials printer closes the build-currency
   loop. All deterministic (doc §0): wind is a derivation (zero draws), vents
   seed on the env stream at world-gen, and legacy saves backfill vents from a
   DERIVED rng — never the live envRng — so resume determinism holds.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { ColonyEvent } from "@shared/types";
import { Colony, DEFS, ORDER } from "./index";
import { windLevel } from "./wind";
import { BUILDING_ROLE, roleMatchCount, roleOf } from "./roster";
import { moraleMult } from "./morale";
import { canPlacePredict } from "./predict";
import { baseCenter } from "./colonists";
import type { ColonyState } from "./state";
import { emptyColonist } from "./state";
import {
  VENT_CLEAR, VENT_COUNT, VENT_EDGE, VENT_SPACING, WIND_DUST_BOOST, WIND_MIN,
  AQUIFER_CLEAR, AQUIFER_COUNT, AQUIFER_EDGE, AQUIFER_SPACING,
} from "./tuning";

/** advance a colony, collecting events */
function run(c: Colony, seconds: number, step = 0.2): ColonyEvent[] {
  const events: ColonyEvent[] = [];
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) { c.tick(step); events.push(...c.drainEvents()); }
  return events;
}

/** reach the engine's private state (the suite's seam for injecting/inspecting) */
const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

/** a colony with a controlled surface: deposits cleared (no gatherers writing
 *  materials), every scheduled visitor + resupply pushed past the horizon — so
 *  the pools and flows under test have exactly one writer */
function controlled(seed: number): { c: Colony; s: ColonyState } {
  const c = new Colony(seed);
  const s = stateOf(c);
  s.deposits = [];
  s.depositRespawn = 1e9;
  s.nextTrade = 1e9;
  s.nextUfo = 1e9;
  s.nextHazard = 1e9;
  s.nextArrival = 1e9;
  s.nextBirth = 1e9;
  s.nextResupply = 1e9; // resupply trickles into every pool — keep flows exact
  // the expansion gates are unlocks.test.ts's subject — open the defs under test
  s.unlocked.push("windturbine", "geothermal", "reactor", "printer");
  return { c, s };
}

/** windLevel of a minimal state (the curve reads only sol, tod, hazards) */
function at(sol: number, tod: number, dust = 0): number {
  return windLevel({
    sol, tod,
    hazards: dust > 0
      ? [{ kind: "dust", phase: "active", intensity: dust, tLeft: 10, activeDur: 10, cadence: 0 }]
      : [],
  } as unknown as ColonyState);
}

// ---- the wind curve ------------------------------------------------------------

describe("windLevel — a pure anti-solar weather curve", () => {
  it("stays within [WIND_MIN, 1] across sols, times of day, and dust", () => {
    for (let sol = 1; sol <= 12; sol++) {
      for (let t = 0; t < 100; t++) {
        for (const dust of [0, 0.5, 1]) {
          const w = at(sol, t / 100, dust);
          expect(w).toBeGreaterThanOrEqual(WIND_MIN);
          expect(w).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it("troughs near solar noon and peaks at night, every sol", () => {
    for (let sol = 1; sol <= 10; sol++) {
      expect(at(sol, 0.51)).toBeLessThan(at(sol, 0.01)); // noon < midnight
    }
  });

  it("an active dust storm boosts wind by exactly its intensity share", () => {
    // at solar noon the curve never clamps, so the boost is exact
    expect(at(2, 0.51, 0.6) - at(2, 0.51, 0)).toBeCloseTo(WIND_DUST_BOOST * 0.6, 9);
    expect(at(2, 0.51, 1) - at(2, 0.51, 0)).toBeCloseTo(WIND_DUST_BOOST, 9);
    // dust boost wins: a dusty midnight pins the clamp
    expect(at(1, 0.01, 1)).toBe(1);
  });
});

// ---- wind turbines (pass-2 generation) -------------------------------------------

describe("wind turbines — pass-2 generation, anti-correlated with solar", () => {
  it("an injected turbine charges the power pool at night while solar is 0", () => {
    const { c, s } = controlled(101);
    s.buildings = [];
    s.grid.fill(0); // a bare field: the turbine is the only machine
    expect(c.place("windturbine", 2, 2)).toBe(true);
    s.tod = 0.95; // deep night
    const before = s.pools.power.amount;
    c.tick(0.2); c.drainEvents();
    expect(s.solarMul).toBe(0);
    expect(s.windLevel).toBeGreaterThanOrEqual(WIND_MIN);
    expect(s.flow.power).toBeCloseTo(DEFS.windturbine.wind! * s.windLevel, 6);
    expect(s.pools.power.amount)
      .toBeCloseTo(before + DEFS.windturbine.wind! * s.windLevel * 0.2, 6);
  });

  it("a broken turbine generates nothing — buildingFunctional gates pass 2", () => {
    const { c, s } = controlled(103);
    s.buildings = [];
    s.grid.fill(0);
    expect(c.place("windturbine", 2, 2)).toBe(true);
    s.tod = 0.95;
    s.buildings[0].integrity = 0.2; // below the functional threshold
    c.tick(0.2); c.drainEvents();
    expect(s.flow.power).toBe(0);
  });
});

// ---- geothermal vents (world-gen terrain) ----------------------------------------

/** every seeded vent honors edge margin, base clearance, pairwise spacing, and
 *  sits on no building cell */
function expectValidVents(s: ColonyState): void {
  expect(s.vents.length).toBe(VENT_COUNT);
  const base = baseCenter(s);
  for (const v of s.vents) {
    expect(v.gx).toBeGreaterThanOrEqual(VENT_EDGE);
    expect(v.gx).toBeLessThanOrEqual(s.N - 1 - VENT_EDGE);
    expect(v.gy).toBeGreaterThanOrEqual(VENT_EDGE);
    expect(v.gy).toBeLessThanOrEqual(s.N - 1 - VENT_EDGE);
    expect(Math.hypot(v.gx - base.x, v.gy - base.y)).toBeGreaterThanOrEqual(VENT_CLEAR);
  }
  for (let i = 0; i < s.vents.length; i++) {
    for (let j = i + 1; j < s.vents.length; j++) {
      const a = s.vents[i], b = s.vents[j];
      expect(Math.hypot(a.gx - b.gx, a.gy - b.gy)).toBeGreaterThanOrEqual(VENT_SPACING);
    }
  }
}

describe("geothermal vents — world-gen terrain", () => {
  it("seeds 3 vents honoring edge, base clearance, and spacing; deposits avoid them", () => {
    for (const seed of [7, 777, 12345]) {
      const s = stateOf(new Colony(seed));
      expectValidVents(s);
      for (const v of s.vents) {
        expect(s.grid[v.gy * s.N + v.gx]).toBe(0); // not under a starter building
        expect(s.deposits.some((d) => d.gx === v.gx && d.gy === v.gy)).toBe(false);
      }
    }
  });

  it("vents are static over 300 s and survive a save round-trip", () => {
    const c = new Colony(777);
    const initial = stateOf(c).vents.map((v) => ({ ...v }));
    run(c, 300);
    expect(stateOf(c).vents).toEqual(initial);
    const d = Colony.load(c.serialize());
    expect(stateOf(d).vents).toEqual(initial);
    run(c, 60);
    run(d, 60);
    expect(d.snapshot()).toEqual(c.snapshot());
  });

  it("the snapshot surfaces vents and windLevel as pure values", () => {
    const c = new Colony(9);
    run(c, 1);
    const snap = c.snapshot();
    expect(snap.vents).toEqual(stateOf(c).vents);
    expect(snap.windLevel).toBe(stateOf(c).windLevel);
    expect(snap.windLevel).toBeCloseTo(windLevel(stateOf(c)), 12); // stored each tick
    snap.vents[0].gx = -99; // mutating the snapshot never touches the engine
    expect(stateOf(c).vents[0].gx).not.toBe(-99);
  });

  it("a legacy save with no vents backfills deterministically — same vents, same future", () => {
    const c = new Colony(53);
    run(c, 30);
    const save = c.serialize();
    expect(save.version).toBe(1); // no version bump for the new fields
    delete (save.state as Partial<ColonyState>).vents;
    delete (save.state as Partial<ColonyState>).windLevel;

    const d = Colony.load(save);
    const e = Colony.load(save);
    expectValidVents(stateOf(d)); // backfilled, honoring the same rules
    expect(stateOf(e).vents).toEqual(stateOf(d).vents); // derived rng → identical loads
    run(d, 300);
    run(e, 300);
    expect(e.snapshot()).toEqual(d.snapshot());
  });
});

// ---- aquifer sites (world-gen terrain) -------------------------------------------

/** every seeded aquifer honors edge margin, base clearance, pairwise spacing,
 *  and sits on no building cell or vent (mirrors expectValidVents) */
function expectValidAquifers(s: ColonyState): void {
  expect(s.aquifers.length).toBe(AQUIFER_COUNT);
  const base = baseCenter(s);
  for (const a of s.aquifers) {
    expect(a.gx).toBeGreaterThanOrEqual(AQUIFER_EDGE);
    expect(a.gx).toBeLessThanOrEqual(s.N - 1 - AQUIFER_EDGE);
    expect(a.gy).toBeGreaterThanOrEqual(AQUIFER_EDGE);
    expect(a.gy).toBeLessThanOrEqual(s.N - 1 - AQUIFER_EDGE);
    expect(Math.hypot(a.gx - base.x, a.gy - base.y)).toBeGreaterThanOrEqual(AQUIFER_CLEAR);
    expect(s.vents.some((v) => v.gx === a.gx && v.gy === a.gy)).toBe(false); // off vents
  }
  for (let i = 0; i < s.aquifers.length; i++) {
    for (let j = i + 1; j < s.aquifers.length; j++) {
      const a = s.aquifers[i], b = s.aquifers[j];
      expect(Math.hypot(a.gx - b.gx, a.gy - b.gy)).toBeGreaterThanOrEqual(AQUIFER_SPACING);
    }
  }
}

describe("aquifer sites — world-gen terrain (mirrors the vent system)", () => {
  it("seeds 2 sites honoring edge, base clearance, and spacing; deposits avoid them", () => {
    for (const seed of [7, 777, 12345]) {
      const s = stateOf(new Colony(seed));
      expectValidAquifers(s);
      for (const a of s.aquifers) {
        expect(s.grid[a.gy * s.N + a.gx]).toBe(0); // not under a starter building
        expect(s.deposits.some((d) => d.gx === a.gx && d.gy === a.gy)).toBe(false);
      }
    }
  });

  it("aquifers are static over 300 s and survive a save round-trip", () => {
    const c = new Colony(777);
    const initial = stateOf(c).aquifers.map((a) => ({ ...a }));
    run(c, 300);
    expect(stateOf(c).aquifers).toEqual(initial);
    const d = Colony.load(c.serialize());
    expect(stateOf(d).aquifers).toEqual(initial);
    run(c, 60);
    run(d, 60);
    expect(d.snapshot()).toEqual(c.snapshot());
  });

  it("the snapshot surfaces aquifers as pure values, decoupled from the engine", () => {
    const c = new Colony(9);
    run(c, 1);
    const snap = c.snapshot();
    expect(snap.aquifers).toEqual(stateOf(c).aquifers);
    snap.aquifers[0].gx = -99; // mutating the snapshot never touches the engine
    expect(stateOf(c).aquifers[0].gx).not.toBe(-99);
  });

  it("a legacy save with no aquifers backfills deterministically — same sites, same future", () => {
    const c = new Colony(53);
    run(c, 30);
    const save = c.serialize();
    expect(save.version).toBe(1); // no version bump for the new field
    // a pre-generation-economy save carries neither terrain kind; vents backfill
    // first, then aquifers (off them) — both from DERIVED rngs, never the live env
    delete (save.state as Partial<ColonyState>).vents;
    delete (save.state as Partial<ColonyState>).aquifers;

    const d = Colony.load(save);
    const e = Colony.load(save);
    expectValidAquifers(stateOf(d)); // backfilled, honoring the same rules
    expect(stateOf(e).aquifers).toEqual(stateOf(d).aquifers); // derived rng → identical loads
    run(d, 300);
    run(e, 300);
    expect(e.snapshot()).toEqual(d.snapshot());
  });

  it("a save that already carries aquifers loads them verbatim (no re-seed)", () => {
    const c = new Colony(424242);
    run(c, 20);
    const initial = stateOf(c).aquifers.map((a) => ({ ...a }));
    const d = Colony.load(c.serialize());
    expect(stateOf(d).aquifers).toEqual(initial); // round-tripped, not re-derived
  });
});

// ---- the aquifer well (terrain-restricted placement) -----------------------------

describe("aquifer well — a terrain-restricted building (mirrors the geothermal tap)", () => {
  it("canPlace refuses off-site, accepts on a site; predict mirrors via snap.aquifers", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.unlocked.push("aquifer"); // the gate is unlocks.test.ts's subject — open it here
    s.materials.amount = 300;    // afford the well
    const a = s.aquifers[0];
    // a free cell that is on no aquifer site
    let off: { x: number; y: number } | null = null;
    for (let x = 0; x < s.N && !off; x++) {
      for (let y = 0; y < s.N && !off; y++) {
        if (s.grid[y * s.N + x] !== 0) continue;
        if (s.aquifers.some((aa) => aa.gx === x && aa.gy === y)) continue;
        off = { x, y };
      }
    }
    expect(off).not.toBeNull();
    expect(c.canPlace("aquifer", off!.x, off!.y)).toBe(false);
    expect(c.canPlace("aquifer", a.gx, a.gy)).toBe(true);
    const snap = c.snapshot();
    expect(canPlacePredict(snap, "aquifer", off!.x, off!.y)).toBe(false);
    expect(canPlacePredict(snap, "aquifer", a.gx, a.gy)).toBe(true);
  });

  it("a well on a site adds its full water yield to flow (the jackpot)", () => {
    // isolate the well's contribution as a with/without delta (like the reactor
    // test), since flow.water nets the crew's life-support draw against it
    const mk = (withWell: boolean) => {
      const { c, s } = controlled(19);
      s.unlocked.push("aquifer");
      const a = s.aquifers[0];
      s.buildings = [];
      s.grid.fill(0);
      if (withWell) expect(c.place("aquifer", a.gx, a.gy)).toBe(true);
      s.tod = 0.5; // daytime so solar covers the small power draw
      s.pools.water.amount = 0; // headroom so the produced water lands in flow
      c.tick(0.2); c.drainEvents();
      return s;
    };
    const a = mk(false);
    const b = mk(true);
    const well = b.buildings.find((bb) => bb.defId === "aquifer")!;
    expect(well.online).toBe(true);
    expect(b.flow.water - a.flow.water).toBeCloseTo(DEFS.aquifer.produces.water!, 6);
  });
});

// ---- the geothermal tap (terrain-restricted placement + flat output) -------------

describe("geothermal tap — the first terrain-restricted building", () => {
  it("canPlace refuses off-vent, accepts on a vent; predict mirrors via snap.vents", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.unlocked.push("geothermal"); // the gate is unlocks.test.ts's subject — open it here
    const v = s.vents[0];
    // a free cell that is on no vent
    let off: { x: number; y: number } | null = null;
    for (let x = 0; x < s.N && !off; x++) {
      for (let y = 0; y < s.N && !off; y++) {
        if (s.grid[y * s.N + x] !== 0) continue;
        if (s.vents.some((vv) => vv.gx === x && vv.gy === y)) continue;
        off = { x, y };
      }
    }
    expect(off).not.toBeNull();
    expect(c.canPlace("geothermal", off!.x, off!.y)).toBe(false);
    expect(c.canPlace("geothermal", v.gx, v.gy)).toBe(true);
    const snap = c.snapshot();
    expect(canPlacePredict(snap, "geothermal", off!.x, off!.y)).toBe(false);
    expect(canPlacePredict(snap, "geothermal", v.gx, v.gy)).toBe(true);
  });

  it("a tap on a vent yields flat steady power, day or night", () => {
    const { c, s } = controlled(19);
    const v = s.vents[0];
    s.buildings = [];
    s.grid.fill(0);
    expect(c.place("geothermal", v.gx, v.gy)).toBe(true);
    s.tod = 0.95; // night — solar is 0, geothermal doesn't care
    c.tick(0.2); c.drainEvents();
    expect(s.flow.power).toBeCloseTo(DEFS.geothermal.steady!, 6);
  });
});

// ---- the fission reactor (a normal pass-4 producer) -------------------------------

describe("the fission reactor — a pass-4 producer behind every existing gate", () => {
  it("produces power × eff into the pool, visible in flow.power; consumes unscaled", () => {
    const mk = (withReactor: boolean) => {
      const { c, s } = controlled(61);
      s.materials.amount = 300;
      if (withReactor) expect(c.place("reactor", 0, 0)).toBe(true);
      s.tod = 0.9; // night — solar contributes nothing either way
      const eff = moraleMult(s); // pass 4 reads pre-tick morale; roleMult 1 on tick 1
      c.tick(0.2); c.drainEvents();
      return { s, eff };
    };
    const a = mk(false);
    const b = mk(true);
    const r = b.s.buildings.find((x) => x.defId === "reactor")!;
    expect(r.online).toBe(true);
    expect(r.staffed).toBe(true);
    expect(r.fed).toBe(true);
    expect(r.util).toBe(1);
    expect(b.s.flow.power - a.s.flow.power)
      .toBeCloseTo(DEFS.reactor.produces.power! * b.eff, 5);
    // eff scales produces only — water draw is the flat recipe rate
    expect(b.s.flow.water - a.s.flow.water).toBeCloseTo(-DEFS.reactor.consumes.water!, 5);
  });

  it("unstaffed → no output (the labor gate applies)", () => {
    const { c, s } = controlled(67);
    s.materials.amount = 300;
    expect(c.place("reactor", 0, 0)).toBe(true);
    s.population = 1; // labor 1 — electrolysis (lower uid) claims it first
    s.tod = 0.9;
    c.tick(0.2); c.drainEvents();
    const r = s.buildings.find((b) => b.defId === "reactor")!;
    expect(r.staffed).toBe(false);
    expect(r.online).toBe(false);
    expect(r.util).toBe(0);
    expect(s.flow.power).toBeLessThan(0); // night, nothing generating
  });

  it("starved of water → fed false → no power", () => {
    const { c, s } = controlled(71);
    s.materials.amount = 300;
    expect(c.place("reactor", 0, 0)).toBe(true);
    c.removeAt(8, 8); // the extractor — no water source refills the pool mid-pass
    s.pools.water.amount = 0;
    s.tod = 0.9;
    c.tick(0.2); c.drainEvents();
    const r = s.buildings.find((b) => b.defId === "reactor")!;
    expect(r.fed).toBe(false);
    expect(r.online).toBe(false);
    expect(s.flow.power).toBeLessThan(0); // the reactor contributed nothing
  });

  it("the engineer's trade covers electrolysis AND the reactor (BUILDING_ROLE)", () => {
    expect(BUILDING_ROLE.extractor).toBe("miner");
    expect(BUILDING_ROLE.electrolysis).toBe("engineer");
    expect(BUILDING_ROLE.reactor).toBe("engineer");
    expect(BUILDING_ROLE.greenhouse).toBe("botanist");
    expect(BUILDING_ROLE.medbay).toBe("medic");
    // roleMatchCount counts an engineer holding a reactor slot
    const eng = emptyColonist(2, 0, 0); // id 2 → engineer
    eng.workUid = 11;
    const s = { colonists: [eng] } as unknown as ColonyState;
    expect(roleOf(2)).toBe("engineer");
    expect(roleMatchCount(s, 11, "reactor")).toBe(1);
    expect(roleMatchCount(s, 11, "greenhouse")).toBe(0);
  });

  it("a free engineer claims the reactor in the role-match pass", () => {
    const { c, s } = controlled(73);
    s.materials.amount = 300;
    c.removeAt(5, 7); // the electrolysis unit — frees the engineer
    expect(c.place("reactor", 0, 0)).toBe(true);
    c.tick(0.2); c.drainEvents(); // assign() runs inside the tick
    const reactorUid = s.buildings.find((b) => b.defId === "reactor")!.uid;
    const engineer = s.colonists.find((k) => roleOf(k.id) === "engineer")!;
    expect(engineer.workUid).toBe(reactorUid);
  });
});

// ---- the materials printer ---------------------------------------------------------

describe("the materials printer", () => {
  it("trickles producesMat × eff into materials and clamps at the cap", () => {
    const { c, s } = controlled(83);
    expect(c.place("printer", 0, 0)).toBe(true);
    const eff = moraleMult(s); // staffing 0 → roleMult 1; morale is the whole eff
    const before = s.materials.amount;
    c.tick(0.2); c.drainEvents();
    expect(s.materials.amount)
      .toBeCloseTo(before + DEFS.printer.producesMat! * eff * 0.2, 6);

    s.materials.amount = s.materials.capacity;
    c.tick(0.2); c.drainEvents();
    expect(s.materials.amount).toBe(s.materials.capacity); // clamped, never over
  });

  it("a brownout sheds the printer before life support", () => {
    const { c, s } = controlled(89);
    expect(c.place("printer", 0, 0)).toBe(true);
    s.tod = 0.9; // night — no generation refills the pool
    s.pools.power.amount = 3.5; // covers every draw this tick except the printer's
    const before = s.materials.amount;
    c.tick(0.2); c.drainEvents();
    const printer = s.buildings.find((b) => b.defId === "printer")!;
    const elec = s.buildings.find((b) => b.defId === "electrolysis")!;
    expect(printer.online).toBe(false); // shed first
    expect(elec.online).toBe(true); // life support held
    expect(s.materials.amount).toBe(before); // a shed printer prints nothing
    expect(DEFS.printer.priority).toBeLessThan(DEFS.greenhouse.priority);
  });
});

// ---- defs + palette order ----------------------------------------------------------

describe("defs + palette order", () => {
  it("appends the four after deflector, preserving medbay-after-greenhouse", () => {
    // the fabricator bays (roverbay, roboticsbay) append after these four
    expect(ORDER.slice(ORDER.indexOf("deflector") + 1, ORDER.indexOf("deflector") + 5))
      .toEqual(["windturbine", "geothermal", "reactor", "printer"]);
    expect(ORDER[ORDER.indexOf("greenhouse") + 1]).toBe("medbay");
  });

  it("carries the agreed recipes and knobs", () => {
    expect(DEFS.windturbine.wind).toBe(9);
    expect(DEFS.windturbine.matCost).toBe(28);
    expect(DEFS.geothermal.steady).toBe(6);
    expect(DEFS.geothermal.needsVent).toBe(true);
    expect(DEFS.geothermal.matCost).toBe(45);
    expect(DEFS.reactor.produces.power).toBe(20);
    expect(DEFS.reactor.consumes.water).toBe(0.5);
    expect(DEFS.reactor.staffing).toBe(1);
    expect(DEFS.reactor.matCost).toBe(120);
    expect(DEFS.printer.producesMat).toBe(0.35);
    expect(DEFS.printer.consumes.power).toBe(6);
    expect(DEFS.printer.priority).toBe(15);
    expect(DEFS.printer.matCost).toBe(40);
    for (const id of ["windturbine", "geothermal", "reactor", "printer"]) {
      expect(DEFS[id].requiresPressure).toBe(false);
      expect(DEFS[id].priority === 0 || id === "printer").toBe(true);
    }
  });
});

// ---- determinism with the generation economy in play -------------------------------

describe("determinism with the generation economy in play", () => {
  it("two same-seed colonies stay in lockstep for 300 s", () => {
    const a = new Colony(24601);
    const b = new Colony(24601);
    const evA = run(a, 300);
    const evB = run(b, 300);
    expect(evB).toEqual(evA);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it("Colony(seed) ≡ Colony(seed, 'normal') still holds", () => {
    const a = new Colony(8675309);
    const b = new Colony(8675309, "normal");
    run(a, 300);
    run(b, 300);
    expect(b.snapshot()).toEqual(a.snapshot());
  });
});
