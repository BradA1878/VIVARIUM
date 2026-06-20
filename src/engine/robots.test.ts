/* ============================================================================
   Mining robots — rung 3 of the automation ladder. The Robotics Bay fabricates
   autonomous gatherers that run the SHARED gather brain (engine/gather.ts) sol
   and night, never shelter, draw no life support, and are NOT possessable.
   Fabrication gates on an online + functional + STAFFED bay; the 40-material
   fee is drawn at COMPLETION (an unaffordable chassis holds at zero). The
   counterplay is deterministic — a flare's activation stuns the whole fleet,
   a meteor/quake strike inside ROBOT_HIT_RADIUS scraps a robot outright — so
   the main hazard/arrival rng stream stays byte-identical.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { ColonyEvent } from "@shared/types";
import { Colony, DEFS, ORDER } from "./index";
import { applyStrikeMachines } from "./rover";
import { updateHazards } from "./hazards";
import { BUILDING_ROLE } from "./roster";
import type { ColonyState, RobotInstance } from "./state";
import type { RNG } from "./rng";
import {
  ROBOT_BUILD_TIME, ROBOT_CAP, ROBOT_MAT_COST, ROBOT_FLARE_FAULT,
  ROBOT_HIT_RADIUS,
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

/** a colony with a controlled surface: the seeded scatter cleared (tests inject
 *  their own nodes) and every scheduled visitor pushed past the horizon so the
 *  materials ledger has exactly one writer — the machines under test */
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
  return { c, s };
}

/** place a Robotics Bay on the first placeable 2×2 in the colony's east yard
 *  (deterministic per seed) and clear the build chatter */
function placeBay(c: Colony): { gx: number; gy: number } {
  const s = stateOf(c); // the gate is unlocks.test.ts's subject — open it here
  if (!s.unlocked.includes("roboticsbay")) s.unlocked.push("roboticsbay");
  for (let gx = 9; gx <= 12; gx++) {
    for (let gy = 9; gy <= 12; gy++) {
      if (c.place("roboticsbay", gx, gy)) { c.drainEvents(); return { gx, gy }; }
    }
  }
  throw new Error("nowhere to raise the Robotics Bay");
}

/** push a robot straight onto the state (the rare-event injection idiom),
 *  drawing its id from the shared actor counter like the fab line does */
function injectRobot(s: ColonyState, x: number, y: number): RobotInstance {
  const r: RobotInstance = {
    id: s.colonistCounter++, x, y, facing: 0, state: "idle",
    carryKind: null, carryAmt: 0, faulted: 0, gatherDepositId: null, gatherT: 0,
  };
  s.robots.push(r);
  return r;
}

const GATHER_STATES = ["gathering", "mining", "hauling"] as const;

// ---- the def + palette order ----------------------------------------------------

describe("the Robotics Bay def", () => {
  it("appends roboticsbay after roverbay, preserving the earlier ORDER pins", () => {
    expect(ORDER[ORDER.indexOf("roverbay") + 1]).toBe("roboticsbay");
    expect(ORDER[ORDER.indexOf("greenhouse") + 1]).toBe("medbay");
  });

  it("is a staffed, unpressurized 2×2 fab shop with the agreed knobs, wanting an engineer", () => {
    const d = DEFS.roboticsbay;
    expect(d.foot).toEqual([2, 2]);
    expect(d.matCost).toBe(90);
    expect(d.consumes.power).toBe(4);
    expect(d.staffing).toBe(1);
    expect(d.priority).toBe(20);
    expect(d.requiresPressure).toBe(false);
    expect(BUILDING_ROLE.roboticsbay).toBe("engineer");
  });
});

// ---- fabrication gates ------------------------------------------------------------

describe("fabrication gates — online + functional + STAFFED", () => {
  it("holds whenever the bay is missing, faulted, unstaffed, or unpowered — and resumes, never resets", () => {
    const { c, s } = controlled(7);

    // no bay at all → the countdown never starts
    run(c, 5);
    expect(s.robotFab).toBe(ROBOT_BUILD_TIME);

    placeBay(c);
    run(c, 10);
    expect(s.robotFab).toBeCloseTo(ROBOT_BUILD_TIME - 10, 4);

    // a flare-style electronics fault → not functional → holds where it stopped
    const bay = s.buildings.find((b) => b.defId === "roboticsbay")!;
    bay.faulted = 1e9;
    run(c, 8);
    expect(s.robotFab).toBeCloseTo(ROBOT_BUILD_TIME - 10, 4);
    bay.faulted = 0;

    // labor starvation → unstaffed → holds (electrolysis + extractor claim both slots)
    s.population = 2;
    run(c, 8);
    expect(s.robotFab).toBeCloseTo(ROBOT_BUILD_TIME - 10, 4);
    s.population = 4;

    // power starvation at night → offline → holds
    s.tod = 0.9;
    s.pools.power.amount = 0;
    run(c, 8);
    expect(s.robotFab).toBeCloseTo(ROBOT_BUILD_TIME - 10, 4);

    // the line comes back → the countdown RESUMES from where it held
    s.tod = 0.4;
    s.pools.power.amount = 100;
    run(c, 2);
    expect(s.robotFab).toBeCloseTo(ROBOT_BUILD_TIME - 12, 4);
  });
});

// ---- completion: the fee, the spawn, the cap ----------------------------------------

describe("completion — the 40-material fee is drawn when the chassis finishes", () => {
  it("emits robot_ready at exactly ROBOT_BUILD_TIME when the fee is banked, spawning by the bay", () => {
    const { c, s } = controlled(7);
    const bay = placeBay(c);
    s.materials.amount = 100;

    const before = run(c, ROBOT_BUILD_TIME - 0.4);
    expect(before.some((e) => e.type === "robot_ready")).toBe(false);
    expect(c.snapshot().robots.length).toBe(0);

    const at = run(c, 0.6);
    const ready = at.find((e) => e.type === "robot_ready");
    expect(ready).toBeDefined();
    expect(ready!.t).toBeCloseTo(ROBOT_BUILD_TIME, 4);
    expect(s.materials.amount).toBeCloseTo(100 - ROBOT_MAT_COST, 6); // exactly 40 drawn

    const snap = c.snapshot();
    expect(snap.robots.length).toBe(1);
    const r = snap.robots[0];
    expect(r.faulted).toBe(0);
    expect(r.carryKind).toBeNull();
    expect(r.carryAmt).toBe(0);
    // rolled out onto a FREE cell within a short walk of the bay
    expect(c.buildingAt(Math.round(r.x), Math.round(r.y))).toBeNull();
    expect(Math.hypot(r.x - (bay.gx + 0.5), r.y - (bay.gy + 0.5))).toBeLessThanOrEqual(3.5);
    expect(ready!.gx).toBe(Math.round(r.x));
    expect(ready!.gy).toBe(Math.round(r.y));
  });

  it("an unaffordable completion holds at 0, then completes the moment the stock covers it", () => {
    const { c, s } = controlled(7);
    placeBay(c); // exactly the 90 starting materials → the stock is now zero
    expect(s.materials.amount).toBe(0);

    const starved = run(c, ROBOT_BUILD_TIME + 6);
    expect(starved.some((e) => e.type === "robot_ready")).toBe(false);
    expect(s.robots.length).toBe(0);
    expect(s.robotFab).toBe(0); // a finished chassis, waiting on the fee

    s.materials.amount = 55;
    const now = run(c, 0.2); // one tick — the stock covers the fee, the chassis ships
    expect(now.some((e) => e.type === "robot_ready")).toBe(true);
    expect(s.robots.length).toBe(1);
    expect(s.materials.amount).toBeCloseTo(55 - ROBOT_MAT_COST, 6); // exactly 40, no more
    expect(s.robotFab).toBe(ROBOT_BUILD_TIME); // the line re-arms for the next chassis
  });

  it("builds to ROBOT_CAP and stops — ids stay unique across the shared actor counter", () => {
    const { c, s } = controlled(7);
    placeBay(c);
    s.materials.amount = 400;

    const events: ColonyEvent[] = [];
    for (let i = 0; i < 1400; i++) { // 280 s, life support pinned so the line never starves
      s.pools.power.amount = 100;
      s.pools.oxygen.amount = 30;
      s.pools.water.amount = 40;
      s.pools.food.amount = 40;
      c.tick(0.2);
      events.push(...c.drainEvents());
    }

    expect(s.robots.length).toBe(ROBOT_CAP);
    expect(events.filter((e) => e.type === "robot_ready").length).toBe(ROBOT_CAP);
    expect(s.materials.amount).toBeCloseTo(400 - ROBOT_CAP * ROBOT_MAT_COST, 4);
    expect(s.robotFab).toBe(ROBOT_BUILD_TIME); // re-armed, idle at cap
    const ids = [...s.colonists.map((k) => k.id), ...s.robots.map((r) => r.id)];
    expect(new Set(ids).size).toBe(ids.length); // one id space, no collisions
  });
});

// ---- autonomy: night, storms, the shared claim set -----------------------------------

describe("autonomy — the field never sleeps", () => {
  it("hauls at night while the colonists sleep: the ore lands in materials, exactly", () => {
    const { c, s } = controlled(11);
    const robot = injectRobot(s, 10, 5);
    s.deposits = [{ id: 501, gx: 8, gy: 5, kind: "ore", amount: 45, max: 140 }];
    s.tod = 0.85; // deep night
    const before = s.materials.amount;

    const robotStates = new Set<string>();
    for (let i = 0; i < 150; i++) { // 30 s, all of it night
      c.tick(0.2); c.drainEvents();
      robotStates.add(c.snapshot().robots[0].state);
      for (const k of s.colonists) {
        expect(GATHER_STATES).not.toContain(k.state); // the crew is off shift
      }
    }

    expect(s.deposits.length).toBe(0); // the node is mined out…
    expect(robot.carryAmt).toBe(0);
    expect(s.materials.amount).toBeCloseTo(before + 45, 5); // …and every unit banked
    for (const st of GATHER_STATES) expect(robotStates.has(st)).toBe(true);
  });

  it("keeps hauling through an active dust storm while the colonists shelter — it never shelters", () => {
    const { c, s } = controlled(13);
    injectRobot(s, 10, 5);
    s.deposits = [{ id: 501, gx: 8, gy: 5, kind: "ore", amount: 45, max: 140 }];
    s.hazards.push({ kind: "dust", phase: "active", tLeft: 40, activeDur: 40, intensity: 0.8, cadence: 0 });
    const before = s.materials.amount;

    const robotStates = new Set<string>();
    let allSheltering = false;
    for (let i = 0; i < 150; i++) { // 30 s under the storm
      c.tick(0.2); c.drainEvents();
      const rv = c.snapshot().robots[0];
      robotStates.add(rv.state);
      expect(rv.state).not.toBe("sheltering");
      if (s.colonists.every((k) => k.state === "sheltering")) allSheltering = true;
    }

    expect(allSheltering).toBe(true); // the crew hid…
    expect(s.deposits.length).toBe(0); // …while the robot worked the node dry
    expect(s.materials.amount).toBeCloseTo(before + 45, 5);
    for (const st of GATHER_STATES) expect(robotStates.has(st)).toBe(true);
  });

  it("shares ONE claim set with the colonists — it skips their nodes instead of thrashing", () => {
    const { c, s } = controlled(23);
    // keep the pools comfortable so staffed workers stay at their stations — only
    // the two free colonists + the robot should compete for these nodes
    s.pools.water.amount = s.pools.water.capacity;
    s.pools.food.amount = s.pools.food.capacity;
    s.materials.amount = s.materials.capacity;
    // three nodes, three gatherers: two free colonists claim the near pair first;
    // the robot stands a single cell from both, yet must take the far third
    s.deposits = [
      { id: 501, gx: 11, gy: 5, kind: "ore", amount: 140, max: 140 },
      { id: 502, gx: 11, gy: 7, kind: "ore", amount: 140, max: 140 },
      { id: 503, gx: 13, gy: 9, kind: "ore", amount: 140, max: 140 },
    ];
    const robot = injectRobot(s, 11, 6);

    c.tick(0.2); c.drainEvents();
    const colonistClaims = s.colonists
      .map((k) => k.gatherDepositId)
      .filter((id): id is number => id != null);
    expect(colonistClaims.sort()).toEqual([501, 502]); // the crew claimed the near pair
    expect(robot.gatherDepositId).toBe(503); // the robot deferred to their claims

    for (let i = 0; i < 50; i++) { // 10 s of trips — the pairing never flips
      c.tick(0.2); c.drainEvents();
      expect(robot.gatherDepositId).toBe(503);
    }
  });
});

// ---- counterplay: flares stun, strikes scrap -------------------------------------------

describe("counterplay — the planet pushes back", () => {
  it("a flare's activation faults ALL robots for ROBOT_FLARE_FAULT seconds, halting them in place", () => {
    const { c, s } = controlled(7);
    const a = injectRobot(s, 12, 4);
    const b = injectRobot(s, 12, 8);
    s.deposits = [{ id: 501, gx: 11, gy: 6, kind: "ore", amount: 600, max: 600 }];
    run(c, 3); // both at work before the sky turns
    expect(GATHER_STATES).toContain(a.state);
    expect(GATHER_STATES).toContain(b.state);

    c.triggerHazard("flare", 1);
    c.drainEvents();
    // the telegraph does NOT halt them — only the activation front does
    let started = false;
    for (let i = 0; i < 60 && !started; i++) {
      expect(a.faulted).toBe(0);
      c.tick(0.2);
      started = c.drainEvents().some((e) => e.type === "hazard_start");
    }
    expect(started).toBe(true);
    // the wavefront caught the WHOLE fleet (one stepRobots decrement has run)
    expect(a.faulted).toBeCloseTo(ROBOT_FLARE_FAULT - 0.2, 6);
    expect(b.faulted).toBeCloseTo(ROBOT_FLARE_FAULT - 0.2, 6);
    expect(c.snapshot().robots.every((r) => r.state === "faulted")).toBe(true);

    // stunned robots stand exactly where the front caught them
    const frozen = { ax: a.x, ay: a.y, bx: b.x, by: b.y };
    run(c, 5);
    expect(a.faulted).toBeGreaterThan(0);
    expect({ ax: a.x, ay: a.y, bx: b.x, by: b.y }).toEqual(frozen);
    expect(c.snapshot().robots.every((r) => r.state === "faulted")).toBe(true);

    // the fault expires on schedule and the fleet goes back to work
    run(c, 8);
    expect(a.faulted).toBe(0);
    expect(b.faulted).toBe(0);
    const moved = (a.x !== frozen.ax || a.y !== frozen.ay);
    expect(moved).toBe(true);
    expect(c.snapshot().robots.some((r) => GATHER_STATES.includes(r.state as never))).toBe(true);
  });

  it("a meteor strike inside ROBOT_HIT_RADIUS scraps the robot and emits robot_destroyed {gx,gy}", () => {
    const near: RobotInstance = {
      id: 9, x: 10, y: 10, facing: 0, state: "hauling",
      carryKind: "ore", carryAmt: 12, faulted: 0, gatherDepositId: null, gatherT: 0,
    };
    const far: RobotInstance = { ...near, id: 10, x: 1, y: 1 };
    const s = {
      N: 15, grid: new Int32Array(15 * 15), buildings: [], colonists: [],
      rovers: [], robots: [near, far],
      hazards: [{ kind: "meteor", phase: "active", tLeft: 5, activeDur: 5, intensity: 1, cadence: 0 }],
      directorControlled: true, pilots: [],
    } as unknown as ColonyState;
    const evs: ColonyEvent[] = [];
    // strikeCell draws x then y from the rng → both land on cell 10
    updateHazards(s, 0.2, rngOf(10.2 / 15), (e) => evs.push(e as ColonyEvent));

    expect(s.robots).toEqual([far]); // the direct hit is gone; the distant one stands
    const dead = evs.find((e) => e.type === "robot_destroyed");
    expect(dead).toBeDefined();
    expect(dead!.gx).toBe(10);
    expect(dead!.gy).toBe(10);
  });

  it("applyStrikeMachines spares a robot beyond ROBOT_HIT_RADIUS and scraps one inside it", () => {
    const bot: RobotInstance = {
      id: 9, x: 10, y: 10, facing: 0, state: "idle",
      carryKind: null, carryAmt: 0, faulted: 0, gatherDepositId: null, gatherT: 0,
    };
    const s = { rovers: [], robots: [bot] } as unknown as ColonyState;
    const evs: ColonyEvent[] = [];
    const emit = (e: unknown): void => { evs.push(e as ColonyEvent); };

    applyStrikeMachines(s, 10 + ROBOT_HIT_RADIUS + 0.5, 10, emit); // out of reach
    expect(s.robots.length).toBe(1);
    expect(evs.length).toBe(0);

    applyStrikeMachines(s, 11, 10, emit); // inside the radius
    expect(s.robots.length).toBe(0);
    expect(evs.some((e) => e.type === "robot_destroyed")).toBe(true);
  });
});

// ---- possession: robots are tools, not bodies ------------------------------------------

describe("possession", () => {
  it("possess(robotId) leaves possession null — robots are not crewable", () => {
    const { c, s } = controlled(7);
    const robot = injectRobot(s, 10, 5);

    c.possess(robot.id);
    expect(c.snapshot().possessed).toBeNull();

    // the crew is unaffected: a real colonist still possesses fine
    const cid = s.colonists[0].id;
    c.possess(cid);
    expect(c.snapshot().possessed).toBe(cid);
    c.possess(null);
    expect(c.snapshot().possessed).toBeNull();
  });
});

// ---- determinism + persistence ----------------------------------------------------------

describe("determinism + persistence", () => {
  it("two same-seed colonies with identical bay + bankroll inputs stay byte-identical", () => {
    const script = (seed: number): Colony => {
      const c = new Colony(seed);
      placeBay(c);
      stateOf(c).materials.amount = 300; // bankroll the line identically on both
      return c;
    };
    const a = script(31337);
    const b = script(31337);
    const evA = run(a, 400);
    const evB = run(b, 400);
    expect(evB).toEqual(evA);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(stateOf(b).robots).toEqual(stateOf(a).robots);
  });

  it("save → load mid-trip resumes bit-identically, gather fields and all", () => {
    const { c, s } = controlled(41);
    injectRobot(s, 12, 12);
    s.deposits = [{ id: 501, gx: 10, gy: 9, kind: "cache", amount: 140, max: 140 }];

    // run until the robot is mid-dwell at the node — the most fragile moment to resume
    let midDwell = false;
    for (let i = 0; i < 300 && !midDwell; i++) {
      c.tick(0.2); c.drainEvents();
      midDwell = s.robots.some((r) => r.state === "mining" && r.gatherT > 0);
    }
    expect(midDwell).toBe(true);

    const d = Colony.load(c.serialize());
    run(c, 60);
    run(d, 60);
    expect(d.snapshot()).toEqual(c.snapshot());
    expect(stateOf(d).robots).toEqual(stateOf(c).robots);
  });

  it("a pre-robot v1 save (no robots/robotFab) loads with defaults and runs deterministically", () => {
    const c = new Colony(777);
    run(c, 30);
    const save = c.serialize();
    expect(save.version).toBe(1); // no version bump for the new fields
    delete (save.state as Partial<ColonyState>).robots;
    delete (save.state as Partial<ColonyState>).robotFab;

    const d = Colony.load(save);
    const e = Colony.load(save);
    expect(stateOf(d).robots).toEqual([]);
    expect(stateOf(d).robotFab).toBe(ROBOT_BUILD_TIME);
    expect(d.snapshot().robots).toEqual([]);
    run(d, 60);
    run(e, 60);
    expect(e.snapshot()).toEqual(d.snapshot());
    expect(stateOf(e).robots).toEqual(stateOf(d).robots);
  });
});
