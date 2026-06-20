/* ============================================================================
   The rover — rung 2 of the automation ladder. Fabrication at the Rover Bay,
   the unified possessable id space (rover ids draw from the colonist counter,
   so `possess {id}` needs no new command), piloting at ROVER_SPEED, multi-kind
   cargo bays, strike damage + self-repair, determinism, and save compatibility.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { ColonyEvent } from "@shared/types";
import { Colony, DEFS, ORDER, FUNC_THRESHOLD } from "./index";
import { applyStrikeMachines } from "./rover";
import { updateHazards } from "./hazards";
import { CARGO_KINDS } from "./gather";
import type { ColonyState } from "./state";
import type { RNG } from "./rng";
import {
  ROVER_BUILD_TIME, ROVER_CAP, ROVER_SPEED, ROVER_CARGO_CAP,
  ROVER_STRIKE_DMG, ROVER_HIT_RADIUS,
} from "./tuning";

/** reach the engine's private state — rare/positional setups are injected, not
 *  awaited (an unattended colony is designed to die) */
const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

/** an rng stub returning a fixed draw (aims strikeCell at a chosen cell) */
const rngOf = (v: number): RNG => ({ next: () => v }) as unknown as RNG;

/** advance a colony by `seconds` in fixed `step`s, collecting events */
function run(c: Colony, seconds: number, step = 0.2): ColonyEvent[] {
  const events: ColonyEvent[] = [];
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) { c.tick(step); events.push(...c.drainEvents()); }
  return events;
}

/** place a Rover Bay on the first placeable 2×2 in the colony's east yard
 *  (deterministic per seed) and clear the build chatter */
function placeBay(c: Colony): { gx: number; gy: number } {
  const s = stateOf(c); // the gate is unlocks.test.ts's subject — open it here
  if (!s.unlocked.includes("roverbay")) s.unlocked.push("roverbay");
  for (let gx = 9; gx <= 12; gx++) {
    for (let gy = 9; gy <= 12; gy++) {
      if (c.place("roverbay", gx, gy)) { c.drainEvents(); return { gx, gy }; }
    }
  }
  throw new Error("nowhere to park the Rover Bay");
}

// ---- the def + palette order ---------------------------------------------------

describe("the Rover Bay def", () => {
  it("appends roverbay right after printer, preserving medbay-after-greenhouse", () => {
    expect(ORDER[ORDER.indexOf("printer") + 1]).toBe("roverbay");
    expect(ORDER[ORDER.indexOf("greenhouse") + 1]).toBe("medbay");
  });

  it("is an unpressurized, unstaffed 2×2 garage with the agreed knobs and a door", () => {
    const d = DEFS.roverbay;
    expect(d.foot).toEqual([2, 2]);
    expect(d.matCost).toBe(60);
    expect(d.consumes.power).toBe(2.5);
    expect(d.staffing).toBe(0);
    expect(d.priority).toBe(25);
    expect(d.requiresPressure).toBe(false);
    expect(d.door).toBeDefined();
  });
});

// ---- fabrication ----------------------------------------------------------------

describe("fabrication at the Rover Bay", () => {
  it("emits rover_ready at exactly ROVER_BUILD_TIME and spawns on a free cell by the bay", () => {
    const c = new Colony(7);
    const bay = placeBay(c);

    const before = run(c, ROVER_BUILD_TIME - 0.4);
    expect(before.some((e) => e.type === "rover_ready")).toBe(false);
    expect(c.snapshot().rovers.length).toBe(0);

    const at = run(c, 0.6);
    const ready = at.find((e) => e.type === "rover_ready");
    expect(ready).toBeDefined();
    expect(ready!.t).toBeCloseTo(ROVER_BUILD_TIME, 4);

    const snap = c.snapshot();
    expect(snap.rovers.length).toBe(1);
    const r = snap.rovers[0];
    expect(r.integrity).toBe(1);
    expect(r.cargo).toEqual({});
    expect(r.cargoTotal).toBe(0);
    expect(r.possessed).toBe(false);
    // rolled out onto a FREE cell within a short walk of the bay
    expect(c.buildingAt(Math.round(r.x), Math.round(r.y))).toBeNull();
    expect(Math.hypot(r.x - (bay.gx + 0.5), r.y - (bay.gy + 0.5))).toBeLessThanOrEqual(3.5);
    expect(ready!.gx).toBe(Math.round(r.x));
    expect(ready!.gy).toBe(Math.round(r.y));
  });

  it("holds the fleet at ROVER_CAP — no second rover, no second event", () => {
    const c = new Colony(7);
    placeBay(c);
    run(c, ROVER_BUILD_TIME + 1);
    expect(c.snapshot().rovers.length).toBe(ROVER_CAP);

    const more = run(c, ROVER_BUILD_TIME + 10);
    expect(more.some((e) => e.type === "rover_ready")).toBe(false);
    expect(c.snapshot().rovers.length).toBe(ROVER_CAP);
  });

  it("pauses — never resets — the countdown while the bay is offline", () => {
    const c = new Colony(7);
    placeBay(c);
    run(c, 20);
    const fabLeft = stateOf(c).roverFab;
    expect(fabLeft).toBeCloseTo(ROVER_BUILD_TIME - 20, 4);

    // knock the line out (the flare electronics-fault pattern)
    const bay = (): { faulted: number } =>
      stateOf(c).buildings.find((b) => b.defId === "roverbay")!;
    bay().faulted = 1e9;
    const held = run(c, 12);
    expect(held.some((e) => e.type === "rover_ready")).toBe(false);
    expect(stateOf(c).roverFab).toBeCloseTo(fabLeft, 4); // paused where it stopped

    bay().faulted = 0; // line back up → the countdown resumes, not restarts
    const evs = run(c, (ROVER_BUILD_TIME - 20) + 1);
    expect(evs.some((e) => e.type === "rover_ready")).toBe(true);
  });
});

// ---- the unified possessable id space --------------------------------------------

describe("possession — one id space for colonists and rovers", () => {
  it("draws the rover id from the colonist counter: disjoint now and after growth", () => {
    const c = new Colony(7);
    placeBay(c);
    run(c, ROVER_BUILD_TIME + 1);
    const rid = c.snapshot().rovers[0].id;
    expect(c.snapshot().colonists.some((k) => k.id === rid)).toBe(false);

    run(c, 120); // arrivals/births keep drawing ids past the rover's
    const later = c.snapshot();
    expect(later.colonists.some((k) => k.id === later.rovers[0].id)).toBe(false);
  });

  it("possess(roverId) works and round-trips through serialize/load bit-identically", () => {
    const c = new Colony(7);
    placeBay(c);
    run(c, ROVER_BUILD_TIME + 1);
    const rid = c.snapshot().rovers[0].id;

    c.possess(rid);
    expect(c.snapshot().possessed).toBe(rid);
    expect(c.snapshot().rovers[0].possessed).toBe(true);

    const d = Colony.load(c.serialize());
    expect(d.snapshot().possessed).toBe(rid);
    expect(d.snapshot().rovers[0].possessed).toBe(true);
    run(c, 30);
    run(d, 30);
    expect(d.snapshot()).toEqual(c.snapshot());
  });
});

// ---- piloting --------------------------------------------------------------------

describe("piloting", () => {
  it("integrates moveIntent at ROVER_SPEED — and pilots no colonist", () => {
    const a = new Colony(7);
    placeBay(a);
    const b = new Colony(7);
    placeBay(b);
    run(a, ROVER_BUILD_TIME + 1);
    run(b, ROVER_BUILD_TIME + 1);

    a.possess(a.snapshot().rovers[0].id);
    a.setMoveIntent(-1, 0); // drive west across open ground
    run(a, 1, 0.1);
    run(b, 1, 0.1);

    const ra = a.snapshot().rovers[0];
    const rb = b.snapshot().rovers[0]; // the twin's rover never moved
    expect(ra.x).toBeCloseTo(rb.x - ROVER_SPEED, 4);
    expect(ra.y).toBeCloseTo(rb.y, 6);
    // the intent drove the rover only: the un-possessed twin's colonists walked identically
    expect(a.snapshot().colonists).toEqual(b.snapshot().colonists);
    expect(a.snapshot().colonists.every((k) => k.state !== "piloted")).toBe(true);
  });
});

// ---- multi-kind cargo --------------------------------------------------------------

describe("multi-kind cargo", () => {
  it("P at two different-kind deposits stacks a two-kind load clamped to the 80-unit bed", () => {
    const c = new Colony(7);
    placeBay(c);
    run(c, ROVER_BUILD_TIME + 1);
    const s = stateOf(c);
    const r = s.rovers[0];
    c.possess(r.id);

    s.deposits.length = 0; // a clean bench: exactly the nodes we stage
    const gx = Math.round(r.x), gy = Math.round(r.y);
    s.deposits.push({ id: 9001, gx, gy, kind: "ice", amount: 50, max: 140 });
    c.interact();
    expect(c.snapshot().rovers[0].cargo.ice).toBeCloseTo(50, 6);
    expect(c.snapshot().rovers[0].cargoTotal).toBeCloseTo(50, 6);

    s.deposits.push({ id: 9002, gx, gy, kind: "ore", amount: 60, max: 140 });
    c.interact(); // a suit would refuse a second kind — the rover has separate bays
    const rv = c.snapshot().rovers[0];
    expect(rv.cargo.ice).toBeCloseTo(50, 6);
    expect(rv.cargo.ore).toBeCloseTo(ROVER_CARGO_CAP - 50, 6); // clamped to the bed
    expect(rv.cargoTotal).toBeCloseTo(ROVER_CARGO_CAP, 6);
    expect(rv.cargoTotal).toBeLessThanOrEqual(ROVER_CARGO_CAP);
    // the staged node kept what the full bed couldn't take
    expect(s.deposits.find((d) => d.id === 9002)!.amount).toBeCloseTo(60 - 30, 6);
  });

  it("one P at the depot credits BOTH pools in the fixed kind order and empties the bed", () => {
    expect(CARGO_KINDS).toEqual(["ice", "ore", "cache"]); // the fixed bank order

    const c = new Colony(7);
    placeBay(c);
    run(c, ROVER_BUILD_TIME + 1);
    const s = stateOf(c);
    const r = s.rovers[0];
    c.possess(r.id);

    r.cargo = { ice: 30, ore: 20 }; // stage a mixed load and park at the depot
    r.x = s.depot.gx;
    r.y = s.depot.gy;
    s.pools.water.amount = 5; // room to see the credit land

    const before = c.snapshot();
    c.interact(); // ONE press banks every bay
    const after = c.snapshot();

    expect(after.rovers[0].cargoTotal).toBe(0);
    expect(after.rovers[0].cargo).toEqual({});
    expect(after.pools.water.amount).toBeCloseTo(
      Math.min(before.pools.water.capacity, before.pools.water.amount + 30), 4);
    expect(after.materials.amount).toBeCloseTo(
      Math.min(before.materials.capacity, before.materials.amount + 20), 4);
  });
});

// ---- strikes, the functional threshold, self-repair --------------------------------

describe("strike damage + self-repair", () => {
  it("dents within ROVER_HIT_RADIUS, freezes under FUNC_THRESHOLD, repairs back to rolling, never dies", () => {
    const c = new Colony(7);
    placeBay(c);
    run(c, ROVER_BUILD_TIME + 1);
    const s = stateOf(c);
    const r = s.rovers[0];
    const noEmit = (): void => {};

    // out of radius: untouched
    applyStrikeMachines(s, Math.round(r.x) + ROVER_HIT_RADIUS + 2, Math.round(r.y), noEmit);
    expect(r.integrity).toBe(1);

    applyStrikeMachines(s, Math.round(r.x), Math.round(r.y), noEmit);
    expect(r.integrity).toBeCloseTo(1 - ROVER_STRIKE_DMG, 6);
    applyStrikeMachines(s, Math.round(r.x), Math.round(r.y), noEmit);
    expect(r.integrity).toBeCloseTo(1 - 2 * ROVER_STRIKE_DMG, 6);
    expect(r.integrity).toBeLessThan(FUNC_THRESHOLD);

    // immobile under the threshold — the intent integrates nothing
    c.possess(r.id);
    c.setMoveIntent(-1, 0);
    const x0 = c.snapshot().rovers[0].x;
    run(c, 1, 0.1);
    expect(c.snapshot().rovers[0].x).toBeCloseTo(x0, 6);

    // self-repair crosses the threshold (~0.02/s) and it rolls again
    run(c, 10, 0.1);
    const r2 = c.snapshot().rovers[0];
    expect(r2.integrity).toBeGreaterThanOrEqual(FUNC_THRESHOLD);
    expect(r2.x).toBeLessThan(x0 - 1);

    // pounded to zero it clamps — dented to the axles, never destroyed
    applyStrikeMachines(s, Math.round(r.x), Math.round(r.y), noEmit);
    applyStrikeMachines(s, Math.round(r.x), Math.round(r.y), noEmit);
    expect(r.integrity).toBe(0);
    expect(s.rovers.length).toBe(1);
  });

  it("is hooked into the meteor strike path beside applyStrikeInjuries", () => {
    const rover = { id: 9, x: 10, y: 10, facing: 0, cargo: {}, integrity: 1 };
    const s = {
      N: 15, grid: new Int32Array(15 * 15), buildings: [], colonists: [],
      rovers: [rover],
      hazards: [{ kind: "meteor", phase: "active", tLeft: 5, activeDur: 5, intensity: 1, cadence: 0 }],
      directorControlled: true, pilots: [],
    } as unknown as ColonyState;
    const noEmit = (): void => {};
    // strikeCell draws x then y from the rng → both land on cell 10
    updateHazards(s, 0.2, rngOf(10.2 / 15), noEmit);
    expect(rover.integrity).toBeCloseTo(1 - ROVER_STRIKE_DMG, 6);
  });
});

// ---- determinism + persistence -------------------------------------------------------

describe("determinism + persistence", () => {
  it("two same-seed colonies with identical bay + drive inputs stay byte-identical", () => {
    const script = (seed: number): ReturnType<Colony["snapshot"]> => {
      const c = new Colony(seed);
      placeBay(c);
      run(c, ROVER_BUILD_TIME + 5);
      c.possess(c.snapshot().rovers[0].id);
      c.setMoveIntent(1, 1);
      run(c, 5);
      c.setMoveIntent(0, 0);
      c.interact(); // a P press lands in the input stream too (no-op or not — same on both)
      run(c, 300);
      return c.snapshot();
    };
    expect(script(31337)).toEqual(script(31337));
  });

  it("a pre-rover v1 save (no rovers/roverFab) loads with defaults and runs deterministically", () => {
    const c = new Colony(777);
    run(c, 30);
    const save = c.serialize();
    expect(save.version).toBe(1); // no version bump for the new fields
    delete (save.state as Partial<ColonyState>).rovers;
    delete (save.state as Partial<ColonyState>).roverFab;

    const d = Colony.load(save);
    const e = Colony.load(save);
    expect(d.snapshot().rovers).toEqual([]);
    expect(stateOf(d).roverFab).toBe(ROVER_BUILD_TIME);
    run(d, 60);
    run(e, 60);
    expect(e.snapshot()).toEqual(d.snapshot());
  });
});
