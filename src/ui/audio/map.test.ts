/* ============================================================================
   Audio map tests — the PURE layer only (event→cue table, snapshot→ambient
   derivation, snapshot diff cues, throttle table). No AudioContext, no DOM:
   vitest runs in plain Node, and map.ts must never need a browser.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type {
  BuildingState, ColonistView, ColonyEvent, EventType, HazardKind, HazardPhase,
  HazardView, Pool, Snapshot, UfoPhase,
} from "@shared/types";
import {
  CUE_IDS, CUE_MIN_GAP_MS, EVENT_CUES, cellKey, deriveState, diffSnapshot, miniOf,
  type CueId,
} from "./map";

// ---- fixtures ----------------------------------------------------------------

function ev(type: EventType, extra: Partial<ColonyEvent> = {}): ColonyEvent {
  return { type, t: 100, sol: 3, tod: 0.5, ...extra };
}

function hz(kind: HazardKind, phase: HazardPhase, intensity = 1): HazardView {
  return { kind, phase, intensity, remaining: 10 };
}

function pool(amount = 50, capacity = 100): Pool {
  return { amount, capacity };
}

function bld(uid: number, gx = 1, gy = 1): BuildingState {
  return {
    uid, defId: "solar", gx, gy, rot: 0, online: true, connected: true,
    staffed: true, fed: true, util: 1, integrity: 1, faulted: 0,
  };
}

function colonist(id: number, x: number, y: number, carryAmt = 0, possessed = false): ColonistView {
  return {
    id, name: "Unit", role: "miner", x, y, facing: 0, state: "idle", injury: 0,
    carryKind: carryAmt > 0 ? "ore" : null, carryAmt, possessed,
  };
}

function makeSnap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    N: 15,
    buildings: [],
    pools: { power: pool(), water: pool(), oxygen: pool(), food: pool() },
    flow: { power: 0, water: 0, oxygen: 0, food: 0 },
    materials: pool(10, 60),
    colonists: [],
    deposits: [],
    vents: [],
    rovers: [],
    robots: [],
    depot: { gx: 8, gy: 6 },
    possessed: null,
    trade: null,
    ufo: null,
    acquiredTech: [],
    population: 4,
    housing: 6,
    labor: 4,
    laborUsed: 2,
    sol: 3,
    tod: 0.5,
    solLength: 120,
    weather: "clear",
    stormT: 0,
    solarMul: 1,
    windLevel: 0,
    unlocks: {},
    hazards: [],
    directorControlled: false,
    nextResupply: 100,
    resupplyT: 0,
    timers: { oxygen: null, water: null, food: null },
    grace: 25,
    dead: 0,
    morale: 0.9,
    difficulty: "normal",
    deadlineSol: 30,
    targetPop: 12,
    selfSufficientFor: 0,
    selfSufficiencyGoal: 240,
    outcome: null,
    outcomeReason: "",
    paused: false,
    speed: 1,
    t: 100,
    started: true,
    ...over,
  };
}

function ufoSnap(phase: UfoPhase): Snapshot {
  return makeSnap({ ufo: { id: 1, phase, targetId: 2, gx: 5, gy: 5 } });
}

// ---- EVENT_CUES ----------------------------------------------------------------

describe("EVENT_CUES", () => {
  const CASES: [EventType, CueId][] = [
    ["hazard_warn", "alertWarn"],
    ["hazard_start", "hazardStart"],
    ["hazard_end", "hazardEnd"],
    ["brownout", "brownout"],
    ["power_back", "powerBack"],
    ["crit_start", "critPulse"],
    ["casualty", "casualtyDrone"],
    ["abducted", "abductSting"],
    ["abduction_blocked", "deflectZap"],
    ["arrival", "chimeUp"],
    ["birth", "chimeUp"],
    ["hub_online", "chimeUp"],
    ["traders_inbound", "tradeMotif"],
    ["trade_done", "tradeDone"],
    ["ufo_inbound", "ufoSweep"],
    ["building_destroyed", "destroyed"],
    ["resupply", "resupplyHorn"],
    ["victory", "victoryTheme"],
    ["defeat", "defeatTheme"],
    ["morale_low", "moraleLow"],
    ["morale_recovered", "moraleUp"],
    ["colonist_injured", "injured"],
    ["colonist_recovered", "recovered"],
  ];

  it.each(CASES)("%s → %s", (type, cue) => {
    const fn = EVENT_CUES[type];
    expect(fn).toBeTypeOf("function");
    expect(fn!(ev(type))).toBe(cue);
  });

  it("leaves uncued engine events unmapped (no entry, not a null-returner)", () => {
    // the diff layer owns place/demolish; storms speak through hazard_* + the
    // wind bed; idle banter is council prose, never a sting.
    for (const t of ["build", "dawn", "dusk", "new_sol", "storm_in", "storm_clear",
      "strike", "building_damaged", "crit_clear", "trade_left",
      "ufo_left", "boot", "anomaly", "idle"] as EventType[]) {
      expect(EVENT_CUES[t]).toBeUndefined();
    }
  });
});

// ---- deriveState ----------------------------------------------------------------

describe("deriveState — wind/storm", () => {
  it("clear day idles at the 0.18 wind base", () => {
    const a = deriveState(makeSnap({ tod: 0.5 }));
    expect(a.wind).toBeCloseTo(0.18, 5);
    expect(a.stormy).toBe(false);
  });

  it("clear night blows a little harder than day", () => {
    const night = deriveState(makeSnap({ tod: 0.9 }));
    const preDawn = deriveState(makeSnap({ tod: 0.1 }));
    const day = deriveState(makeSnap({ tod: 0.5 }));
    expect(night.wind).toBeCloseTo(0.26, 5);
    expect(preDawn.wind).toBeCloseTo(0.26, 5);
    expect(night.wind).toBeGreaterThan(day.wind);
    expect(night.stormy).toBe(false);
  });

  it("a telegraphed dust storm raises the wind before the wall arrives", () => {
    const a = deriveState(makeSnap({ hazards: [hz("dust", "telegraph", 0.8)] }));
    expect(a.wind).toBeCloseTo(0.45, 5);
    expect(a.stormy).toBe(false);
  });

  it("dust weather scales 0.7 → 1.0 with active-storm intensity", () => {
    const mild = deriveState(makeSnap({ weather: "dust", hazards: [hz("dust", "active", 0)] }));
    const half = deriveState(makeSnap({ weather: "dust", hazards: [hz("dust", "active", 0.5)] }));
    const full = deriveState(makeSnap({ weather: "dust", hazards: [hz("dust", "active", 1)] }));
    expect(mild.wind).toBeCloseTo(0.7, 5);
    expect(half.wind).toBeCloseTo(0.85, 5);
    expect(full.wind).toBeCloseTo(1.0, 5);
    expect(full.stormy).toBe(true);
  });

  it("an active storm out-shouts the night bump", () => {
    const a = deriveState(makeSnap({ tod: 0.95, weather: "dust", hazards: [hz("dust", "active", 1)] }));
    expect(a.wind).toBeCloseTo(1.0, 5);
    expect(a.stormy).toBe(true);
  });
});

describe("deriveState — rumble/hum/dread", () => {
  it("meteor/quake telegraphs rumble at the 0.15 level, active at 0.5", () => {
    expect(deriveState(makeSnap()).rumble).toBe(0);
    expect(deriveState(makeSnap({ hazards: [hz("meteor", "telegraph")] })).rumble).toBeCloseTo(0.15, 5);
    expect(deriveState(makeSnap({ hazards: [hz("quake", "telegraph")] })).rumble).toBeCloseTo(0.15, 5);
    expect(deriveState(makeSnap({ hazards: [hz("meteor", "active")] })).rumble).toBeCloseTo(0.5, 5);
    expect(deriveState(makeSnap({ hazards: [hz("quake", "active")] })).rumble).toBeCloseTo(0.5, 5);
  });

  it("takes the loudest rumble when hazards stack, and non-seismic hazards stay silent", () => {
    const stacked = deriveState(makeSnap({ hazards: [hz("meteor", "telegraph"), hz("quake", "active")] }));
    expect(stacked.rumble).toBeCloseTo(0.5, 5);
    expect(deriveState(makeSnap({ hazards: [hz("flare", "active"), hz("coldsnap", "active")] })).rumble).toBe(0);
  });

  it("hums only while a colonist is possessed", () => {
    expect(deriveState(makeSnap()).hum).toBe(false);
    const s = makeSnap({ possessed: 7, colonists: [colonist(7, 3, 3, 0, true)] });
    expect(deriveState(s).hum).toBe(true);
  });

  it("dread follows the UFO phase: inbound 0.5, hovering 1, else 0", () => {
    expect(deriveState(makeSnap()).dread).toBe(0);
    expect(deriveState(ufoSnap("inbound")).dread).toBe(0.5);
    expect(deriveState(ufoSnap("hovering")).dread).toBe(1);
    expect(deriveState(ufoSnap("leaving")).dread).toBe(0);
  });
});

// ---- miniOf + diffSnapshot ------------------------------------------------------

describe("miniOf", () => {
  it("captures building cells by uid, the possessed load, and the depot", () => {
    const s = makeSnap({
      buildings: [bld(1, 2, 3), bld(4, 5, 6)],
      possessed: 7,
      colonists: [colonist(7, 3.5, 4.5, 2, true), colonist(8, 1, 1)],
    });
    const m = miniOf(s);
    expect(m.buildings.get(1)).toBe(cellKey(2, 3));
    expect(m.buildings.get(4)).toBe(cellKey(5, 6));
    expect(m.possessed).toEqual({ id: 7, carry: 2, x: 3.5, y: 4.5 });
    expect(m.depot).toEqual({ gx: 8, gy: 6 });
  });

  it("treats a possession id with no matching colonist (abducted mid-frame) as unpossessed", () => {
    const m = miniOf(makeSnap({ possessed: 99, colonists: [colonist(1, 0, 0)] }));
    expect(m.possessed).toBeNull();
  });
});

describe("diffSnapshot — place/demolish", () => {
  it("emits nothing on the first snapshot (prev null — boot/save-load)", () => {
    const next = miniOf(makeSnap({ buildings: [bld(1), bld(2)] }));
    expect(diffSnapshot(null, next)).toEqual([]);
  });

  it("emits one place per added building, up to the bulk guard", () => {
    const prev = miniOf(makeSnap({ buildings: [bld(1)] }));
    const one = miniOf(makeSnap({ buildings: [bld(1), bld(2)] }));
    expect(diffSnapshot(prev, one)).toEqual(["place"]);
    const three = miniOf(makeSnap({ buildings: [bld(1), bld(2), bld(3), bld(4)] }));
    expect(diffSnapshot(prev, three)).toEqual(["place", "place", "place"]);
  });

  it("skips placements when more than 3 appear at once (a load, not a click)", () => {
    const prev = miniOf(makeSnap({ buildings: [] }));
    const bulk = miniOf(makeSnap({ buildings: [bld(1), bld(2), bld(3), bld(4)] }));
    expect(diffSnapshot(prev, bulk)).toEqual([]);
  });

  it("emits demolish when a building disappears — the engine has no demolish event", () => {
    const prev = miniOf(makeSnap({ buildings: [bld(1, 2, 3), bld(2, 4, 4)] }));
    const next = miniOf(makeSnap({ buildings: [bld(2, 4, 4)] }));
    expect(diffSnapshot(prev, next)).toEqual(["demolish"]);
  });

  it("suppresses demolish for cells the caller marks recently destroyed (hazard kills)", () => {
    const prev = miniOf(makeSnap({ buildings: [bld(1, 2, 3), bld(2, 4, 4)] }));
    const next = miniOf(makeSnap({ buildings: [] }));
    const destroyed = new Set([cellKey(2, 3)]);
    expect(diffSnapshot(prev, next, destroyed)).toEqual(["demolish"]); // only uid 2 thunks
  });

  it("skips removals in bulk (a reset/load wipe is not a demolition spree)", () => {
    const prev = miniOf(makeSnap({ buildings: [bld(1), bld(2), bld(3), bld(4), bld(5)] }));
    const next = miniOf(makeSnap({ buildings: [] }));
    expect(diffSnapshot(prev, next)).toEqual([]);
  });
});

describe("diffSnapshot — pickup/drop", () => {
  function pilot(carry: number, x = 8, y = 6): Snapshot {
    return makeSnap({ possessed: 7, colonists: [colonist(7, x, y, carry, true)] });
  }

  it("emits pickup when the possessed load goes 0 → >0", () => {
    expect(diffSnapshot(miniOf(pilot(0, 3, 3)), miniOf(pilot(4, 3, 3)))).toEqual(["pickup"]);
  });

  it("does not re-emit pickup while already carrying", () => {
    expect(diffSnapshot(miniOf(pilot(3)), miniOf(pilot(5)))).toEqual([]);
  });

  it("emits drop when the load empties beside the depot", () => {
    // depot is (8,6); the pilot is standing on it
    expect(diffSnapshot(miniOf(pilot(4, 8, 6)), miniOf(pilot(0, 8.4, 6.4)))).toEqual(["drop"]);
  });

  it("stays silent when the load vanishes far from the depot (release/abduction)", () => {
    expect(diffSnapshot(miniOf(pilot(4, 1, 1)), miniOf(pilot(0, 1, 1)))).toEqual([]);
  });

  it("ignores carry transitions across different colonists or a released possession", () => {
    const a = makeSnap({ possessed: 7, colonists: [colonist(7, 8, 6, 0, true)] });
    const b = makeSnap({ possessed: 9, colonists: [colonist(9, 8, 6, 4, true)] });
    expect(diffSnapshot(miniOf(a), miniOf(b))).toEqual([]); // id changed — no pickup
    const released = makeSnap({ possessed: null, colonists: [colonist(7, 8, 6, 0)] });
    expect(diffSnapshot(miniOf(pilot(4, 8, 6)), miniOf(released))).toEqual([]); // no drop
  });
});

// ---- throttle table --------------------------------------------------------------

describe("CUE_MIN_GAP_MS", () => {
  it("covers every cue id with a positive gap", () => {
    expect(CUE_IDS.length).toBeGreaterThanOrEqual(20);
    for (const id of CUE_IDS) {
      expect(CUE_MIN_GAP_MS[id], id).toBeTypeOf("number");
      expect(CUE_MIN_GAP_MS[id], id).toBeGreaterThan(0);
    }
  });

  it("pins the spec'd gaps", () => {
    expect(CUE_MIN_GAP_MS.place).toBe(150);
    expect(CUE_MIN_GAP_MS.uiTick).toBe(60);
    expect(CUE_MIN_GAP_MS.alertWarn).toBe(2000);
    expect(CUE_MIN_GAP_MS.casualtyDrone).toBe(4000);
    expect(CUE_MIN_GAP_MS.moraleLow).toBe(4000);
    expect(CUE_MIN_GAP_MS.moraleUp).toBe(4000);
    expect(CUE_MIN_GAP_MS.injured).toBe(1500);
    expect(CUE_MIN_GAP_MS.recovered).toBe(2000);
  });
});
