/* ============================================================================
   Abundance unlocks + calmer pacing — the expansion palette opens as the colony
   proves itself (a data table of gates over ColonyState, latched once,
   engine-authoritative at placement), while the planet eases off: a later
   first strike and wider gaps for both the Director and the engine scheduler.
   Gates are pure derivations — ZERO rng draws — so the main hazard/arrival
   stream is byte-identical, and difficulty multipliers still apply AFTER the
   draw (draw-count neutrality preserved).
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { BuildingState, ColonyEvent } from "@shared/types";
import { Colony, ORDER } from "./index";
import { GATES, computeUnlocks, defLocked, updateUnlocks } from "./unlocks";
import { SCHED_FIRST, updateHazards } from "./hazards";
import { canPlacePredict } from "./predict";
import { Director } from "../agent/director/director";
import { DIFFICULTY } from "./tuning";
import type { ColonyState } from "./state";
import type { RNG } from "./rng";

/** advance a colony, collecting events */
function run(c: Colony, seconds: number, step = 0.2): ColonyEvent[] {
  const events: ColonyEvent[] = [];
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) { c.tick(step); events.push(...c.drainEvents()); }
  return events;
}

/** reach the engine's private state (the suite's seam for injecting/inspecting) */
const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

const noEmit = (): void => {};

/** a minimal state carrying only what the gates read */
function gateState(over: Partial<ColonyState> = {}): ColonyState {
  return {
    sol: 1, population: 4,
    materials: { amount: 0, capacity: 400 },
    buildings: [], hazards: [], unlocked: [],
    ...over,
  } as unknown as ColonyState;
}

const mat = (amount: number) => ({ amount, capacity: 400 });
const activeDust = () =>
  [{ kind: "dust", phase: "active", intensity: 1, tLeft: 10, activeDur: 10, cadence: 0 }] as ColonyState["hazards"];
const telegraphDust = () =>
  [{ kind: "dust", phase: "telegraph", intensity: 1, tLeft: 6, activeDur: 10, cadence: 0 }] as ColonyState["hazards"];
const reactorBuilt = () => [{ defId: "reactor" } as BuildingState];

type Emitted = Omit<ColonyEvent, "t" | "sol" | "tod">;
function collector(): { events: Emitted[]; emit: (e: Emitted) => void } {
  const events: Emitted[] = [];
  return { events, emit: (e) => events.push(e) };
}

const FOUNDING = [
  "hub", "corridor", "hab", "solar", "battery",
  "extractor", "electrolysis", "greenhouse", "medbay", "cistern", "o2tank", "deflector",
];

// ---- the gate table -----------------------------------------------------------

describe("GATES — the truth table, by state injection", () => {
  it("roverbay: sol ≥ 3 OR materials ≥ 80", () => {
    expect(GATES.roverbay(gateState())).toBe(false);
    expect(GATES.roverbay(gateState({ sol: 2, materials: mat(79) }))).toBe(false);
    expect(GATES.roverbay(gateState({ sol: 3 }))).toBe(true);
    expect(GATES.roverbay(gateState({ materials: mat(80) }))).toBe(true);
  });

  it("printer: population ≥ 6", () => {
    expect(GATES.printer(gateState({ population: 5 }))).toBe(false);
    expect(GATES.printer(gateState({ population: 6 }))).toBe(true);
  });

  it("windturbine: sol ≥ 4 OR an ACTIVE dust hazard (a telegraph doesn't count)", () => {
    expect(GATES.windturbine(gateState({ sol: 3 }))).toBe(false);
    expect(GATES.windturbine(gateState({ sol: 4 }))).toBe(true);
    expect(GATES.windturbine(gateState({ sol: 1, hazards: activeDust() }))).toBe(true);
    expect(GATES.windturbine(gateState({ sol: 1, hazards: telegraphDust() }))).toBe(false);
  });

  it("geothermal: sol ≥ 6", () => {
    expect(GATES.geothermal(gateState({ sol: 5 }))).toBe(false);
    expect(GATES.geothermal(gateState({ sol: 6 }))).toBe(true);
  });

  it("reactor: population ≥ 8 AND materials ≥ 150", () => {
    expect(GATES.reactor(gateState({ population: 8, materials: mat(149) }))).toBe(false);
    expect(GATES.reactor(gateState({ population: 7, materials: mat(150) }))).toBe(false);
    expect(GATES.reactor(gateState({ population: 8, materials: mat(150) }))).toBe(true);
  });

  it("roboticsbay: a reactor exists OR (population ≥ 10 AND materials ≥ 200)", () => {
    expect(GATES.roboticsbay(gateState())).toBe(false);
    expect(GATES.roboticsbay(gateState({ buildings: reactorBuilt() }))).toBe(true);
    expect(GATES.roboticsbay(gateState({ population: 10, materials: mat(200) }))).toBe(true);
    expect(GATES.roboticsbay(gateState({ population: 10, materials: mat(199) }))).toBe(false);
    expect(GATES.roboticsbay(gateState({ population: 9, materials: mat(200) }))).toBe(false);
  });

  it("fabricator: a roboticsbay exists AND materials ≥ 250", () => {
    const bayBuilt = () => [{ defId: "roboticsbay" } as BuildingState];
    expect(GATES.fabricator(gateState())).toBe(false);
    expect(GATES.fabricator(gateState({ buildings: bayBuilt(), materials: mat(249) }))).toBe(false);
    expect(GATES.fabricator(gateState({ materials: mat(250) }))).toBe(false); // rich, but no bay
    expect(GATES.fabricator(gateState({ buildings: bayBuilt(), materials: mat(250) }))).toBe(true);
  });
});

// ---- the latch ------------------------------------------------------------------

describe("updateUnlocks — latch once, announce once", () => {
  it("emits `unlock` with defId AND the display name, exactly once per def", () => {
    const s = gateState({ sol: 6, materials: mat(90) }); // roverbay + windturbine + geothermal + awg (sol ≥ 5)
    const { events, emit } = collector();
    updateUnlocks(s, emit);
    const unlocks = events.filter((e) => e.type === "unlock");
    expect(unlocks.map((e) => e.defId).sort())
      .toEqual(["awg", "geothermal", "roverbay", "windturbine"]);
    expect(unlocks.find((e) => e.defId === "geothermal")!.detail).toBe("Geothermal Tap");
    expect(unlocks.find((e) => e.defId === "roverbay")!.detail).toBe("Rover Bay");
    expect(unlocks.find((e) => e.defId === "awg")!.detail).toBe("Atmospheric Water Generator");
    expect(s.unlocked.sort()).toEqual(["awg", "geothermal", "roverbay", "windturbine"]);

    updateUnlocks(s, emit); // already latched — silence
    expect(events.filter((e) => e.type === "unlock")).toHaveLength(4);
  });

  it("the latch survives condition regression — an unlock never revokes", () => {
    const s = gateState({ materials: mat(80) });
    const { events, emit } = collector();
    updateUnlocks(s, emit);
    expect(s.unlocked).toContain("roverbay");

    s.materials.amount = 0; // the stock is spent — the gate's condition is gone
    updateUnlocks(s, emit);
    expect(s.unlocked).toContain("roverbay");
    expect(defLocked(s, "roverbay")).toBe(false);
    expect(computeUnlocks(s).roverbay).toBe(true);
    expect(events.filter((e) => e.type === "unlock")).toHaveLength(1); // still just the one
  });
});

// ---- computeUnlocks ----------------------------------------------------------------

describe("computeUnlocks — the snapshot's palette map", () => {
  it("covers every ORDER id; the 12 founding defs are always true", () => {
    const u = computeUnlocks(gateState());
    expect(Object.keys(u).sort()).toEqual([...ORDER].sort());
    for (const id of FOUNDING) expect(u[id]).toBe(true);
    for (const id of Object.keys(GATES)) expect(u[id]).toBe(false); // nothing earned yet
  });

  it("a fresh colony's snapshot carries the map; the founding tier is open", () => {
    const snap = new Colony(3).snapshot();
    for (const id of FOUNDING) expect(snap.unlocks[id]).toBe(true);
    expect(snap.unlocks.printer).toBe(false);
    expect(snap.unlocks.roboticsbay).toBe(false);
  });
});

// ---- engine wiring ------------------------------------------------------------------

describe("the tick latches gates and the engine refuses locked placements", () => {
  it("a fresh normal colony latches roverbay on its first tick (materials 90 ≥ 80)", () => {
    const c = new Colony(7);
    expect(c.snapshot().unlocks.roverbay).toBe(false); // not latched until the tick runs
    c.tick(0.2);
    const unlocks = c.drainEvents().filter((e) => e.type === "unlock");
    // only roverbay (materials ≥ 80) latches on the first tick. The reclaimer is gated on
    // population 6 / a built Hydroponics — neither of which a founding colony has — so it
    // stays locked (electrolysis is a founding building and must NOT open it at sol 0).
    expect(unlocks.map((e) => e.defId)).toEqual(["roverbay"]);
    expect(unlocks[0].detail).toBe("Rover Bay");
    expect(c.snapshot().unlocks.roverbay).toBe(true);
    expect(c.snapshot().unlocks.reclaimer).toBe(false); // still behind its mid-game gate
  });

  it("canPlace is blocked while locked, allowed after unlock; predict mirrors", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = 300; // affordability is not the question here
    expect(c.canPlace("printer", 0, 0)).toBe(false); // population 4 < 6 — locked
    expect(c.place("printer", 0, 0)).toBe(false);
    expect(canPlacePredict(c.snapshot(), "printer", 0, 0)).toBe(false);
    expect(c.canPlace("hab", 0, 0)).toBe(true); // the founding tier is untouched

    s.population = 6;
    c.tick(0.2); c.drainEvents(); // updateUnlocks latches the printer
    expect(c.canPlace("printer", 0, 0)).toBe(true);
    expect(canPlacePredict(c.snapshot(), "printer", 0, 0)).toBe(true);
    expect(c.place("printer", 0, 0)).toBe(true);
  });
});

// ---- persistence ---------------------------------------------------------------------

describe("persistence — the latch rides the save", () => {
  it("save → load keeps the latch, never re-announces, and survives regression", () => {
    const c = new Colony(11);
    c.tick(0.2); c.drainEvents(); // roverbay latches
    const d = Colony.load(c.serialize());
    expect(stateOf(d).unlocked).toContain("roverbay");
    expect(d.snapshot().unlocks.roverbay).toBe(true);

    stateOf(d).materials.amount = 0; // regression after the load
    d.tick(0.2);
    expect(d.drainEvents().filter((e) => e.type === "unlock")).toHaveLength(0);
    expect(d.snapshot().unlocks.roverbay).toBe(true);
  });

  it("a legacy save (no unlocked field) re-derives on its first tick, re-emits once, then resumes deterministically", () => {
    const c = new Colony(53);
    run(c, 30);
    const save = c.serialize();
    expect(save.version).toBe(1); // no version bump for the new field
    delete (save.state as Partial<ColonyState>).unlocked;

    const d = Colony.load(save);
    const e = Colony.load(save);
    expect(stateOf(d).unlocked).toEqual([]); // the graceful default
    const evsD = run(d, 1);
    const evsE = run(e, 1);
    // at t≈30: sol 1, pop 4, materials ≥ 80 → only roverbay re-derives, once (the
    // reclaimer's population/greenhouse gate isn't met yet), in GATES insertion order
    expect(evsD.filter((x) => x.type === "unlock").map((x) => x.defId)).toEqual(["roverbay"]);
    expect(stateOf(d).unlocked).toEqual(["roverbay"]);
    expect(evsE).toEqual(evsD);
    run(d, 300);
    run(e, 300);
    expect(e.snapshot()).toEqual(d.snapshot()); // the re-derived future is deterministic
  });
});

// ---- calmer pacing: the Director -------------------------------------------------------

describe("Director pacing — later first strike, wider gaps, gentler intensity", () => {
  const snapAt = (t: number, sol: number) => {
    const s = new Colony().snapshot();
    s.t = t; s.sol = sol;
    return s;
  };

  it("holds fire until t=220", () => {
    const d = new Director();
    expect(d.decide(snapAt(219, 1), () => 0, { comfort: 0.5 })).toBeNull();
    expect(d.decide(snapAt(220, 1), () => 0, { comfort: 0.5 })).not.toBeNull();
  });

  it("gap ≈ 292/271/245/219 at sols 1/5/10/15 with comfort 0.5; intensity 0.35 + 0.04·sol + 0.2·comfort", () => {
    const GAP: Record<number, number> = { 1: 292.25, 5: 271.25, 10: 245, 15: 218.75 };
    for (const sol of [1, 5, 10, 15]) {
      const d = new Director();
      expect(d.decide(snapAt(1000, sol), () => 0, { comfort: 0.5 })).not.toBeNull(); // arm + fire
      expect(d.decide(snapAt(1000 + GAP[sol] - 1, sol), () => 0, { comfort: 0.5 })).toBeNull();
      const strike = d.decide(snapAt(1000 + GAP[sol] + 1, sol), () => 0, { comfort: 0.5 });
      expect(strike).not.toBeNull();
      expect(strike!.intensity).toBeCloseTo(Math.min(1, 0.35 + 0.04 * sol + 0.1), 6);
    }
  });
});

// ---- calmer pacing: the engine scheduler -------------------------------------------------

describe("engine scheduler pacing — SCHED_FIRST 180, gap 150 + rand·130", () => {
  it("emits no hazard_warn before t=180 with the Director off, and at least one by t=480", () => {
    expect(SCHED_FIRST).toBe(180);
    const c = new Colony(7);
    expect(stateOf(c).nextHazard).toBe(SCHED_FIRST);
    const early = run(c, 179);
    expect(early.some((e) => e.type === "hazard_warn")).toBe(false);
    const later = run(c, 480 - 179);
    expect(later.some((e) => e.type === "hazard_warn")).toBe(true);
  });

  it("difficulty multipliers still apply AFTER the draw — equal draw counts, scaled gap", () => {
    const sched = (difficulty: "hard" | "normal"): ColonyState =>
      ({
        difficulty, hazards: [], buildings: [],
        directorControlled: false, nextHazard: 0, weather: "clear",
      }) as unknown as ColonyState;
    const draws = { hard: 0, normal: 0 };
    const counting = (k: "hard" | "normal"): RNG =>
      ({ next: () => { draws[k] += 1; return 0.5; } }) as unknown as RNG;
    const hard = sched("hard");
    const normal = sched("normal");
    updateHazards(hard, 0.2, counting("hard"), noEmit);
    updateHazards(normal, 0.2, counting("normal"), noEmit);
    expect(draws.hard).toBe(draws.normal); // identical draw counts → identical stream
    expect(normal.nextHazard).toBeCloseTo(150 + 0.5 * 130, 6); // the calmer window
    expect(hard.nextHazard).toBeCloseTo((150 + 0.5 * 130) * DIFFICULTY.hard.hazardGapMult, 6);
  });
});
