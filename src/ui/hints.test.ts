/* ============================================================================
   Hint tests — the PURE half of the contextual tips: event→hint and snapshot→
   hint derivations, the corridor debounce, the one-shot mining trigger, and the
   Hints queue (one toast at a time, seen-set persistence, suppression while the
   FirstHint welcome card is still unseen). Storage is injected — plain Node.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { BuildingState, ColonyEvent, EventType, Snapshot } from "@shared/types";
import {
  FIRST_HINT_KEY, HINTS, HINTS_SEEN_KEY, Hints, freshScratch, hintForEvent, hintForSnapshot,
} from "./hints";

// ---- fixtures ----------------------------------------------------------------

type Store = Pick<Storage, "getItem" | "setItem">;

function memStorage(seed?: Record<string, string>): Store & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
  };
}

const throwing: Store = {
  getItem(): string | null { throw new Error("storage unavailable"); },
  setItem(): void { throw new Error("storage unavailable"); },
};

function ev(type: EventType, extra: Partial<ColonyEvent> = {}): ColonyEvent {
  return { type, t: 100, sol: 3, tod: 0.5, ...extra };
}

function bld(uid: number, defId: string, connected: boolean): BuildingState {
  return {
    uid, defId, gx: 1, gy: 1, rot: 0, online: true, connected,
    staffed: true, fed: true, util: 1, integrity: 1, faulted: 0,
  };
}

function makeSnap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    N: 15,
    buildings: [],
    pools: {
      power: { amount: 50, capacity: 100 }, water: { amount: 50, capacity: 100 },
      oxygen: { amount: 50, capacity: 100 }, food: { amount: 50, capacity: 100 },
    },
    flow: { power: 0, water: 0, oxygen: 0, food: 0 },
    materials: { amount: 10, capacity: 60 },
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
    solLength: 150,
    weather: "clear",
    stormT: 0,
    solarMul: 1,
    windLevel: 0,
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

/** a storage where the FirstHint welcome card has already been dismissed */
function unlockedStorage(seed?: Record<string, string>) {
  return memStorage({ [FIRST_HINT_KEY]: "1", ...seed });
}

// ---- pure derivations -----------------------------------------------------------

describe("hintForEvent", () => {
  it("maps the teaching moments and nothing else", () => {
    expect(hintForEvent(ev("brownout"))).toBe("brownout");
    expect(hintForEvent(ev("traders_inbound"))).toBe("trade");
    expect(hintForEvent(ev("ufo_inbound"))).toBe("deflector");
    expect(hintForEvent(ev("casualty"))).toBeNull();
    expect(hintForEvent(ev("hazard_start", { kind: "meteor" }))).toBeNull();
  });
});

describe("hintForSnapshot — corridor debounce", () => {
  it("needs a pressure building unconnected for 5 CONTINUOUS sim-seconds; flapping resets", () => {
    const sc = freshScratch();
    const stranded = (t: number) => makeSnap({ t, buildings: [bld(1, "hab", false)] });
    const linked = (t: number) => makeSnap({ t, buildings: [bld(1, "hab", true)] });

    expect(hintForSnapshot(stranded(10), sc)).toBeNull(); // starts the clock
    expect(hintForSnapshot(stranded(13), sc)).toBeNull(); // 3 s — not yet
    expect(hintForSnapshot(linked(14), sc)).toBeNull(); // connectivity flaps back — reset
    expect(hintForSnapshot(stranded(15), sc)).toBeNull(); // the clock starts over
    expect(hintForSnapshot(stranded(19.9), sc)).toBeNull(); // 4.9 s since the flap
    expect(hintForSnapshot(stranded(20), sc)).toBe("corridor"); // 5 continuous seconds
  });

  it("ignores unconnected buildings that never needed pressure", () => {
    const sc = freshScratch();
    const s = (t: number) => makeSnap({ t, buildings: [bld(1, "solar", false)] });
    expect(hintForSnapshot(s(10), sc)).toBeNull();
    expect(hintForSnapshot(s(40), sc)).toBeNull();
    expect(sc.unconnectedSince).toBeNull(); // the clock never even started
  });
});

describe("hintForSnapshot — mining", () => {
  it("proposes while possessed until the queue consumes the trigger at show time", () => {
    const sc = freshScratch();
    expect(hintForSnapshot(makeSnap({ t: 5, possessed: 7 }), sc)).toBe("mining");
    expect(sc.possessedOnce).toBe(false); // proposing does NOT burn the trigger
    expect(hintForSnapshot(makeSnap({ t: 6, possessed: 7 }), sc)).toBe("mining"); // still on offer
    sc.possessedOnce = true; // the queue showed it
    expect(hintForSnapshot(makeSnap({ t: 8, possessed: null }), sc)).toBeNull();
    expect(hintForSnapshot(makeSnap({ t: 9, possessed: 7 }), sc)).toBeNull(); // re-possession is not the first time
  });
});

// ---- the queue -------------------------------------------------------------------

describe("Hints queue", () => {
  it("shows an event hint once, marks it seen at show time, and persists that", () => {
    const st = unlockedStorage();
    const hints = new Hints(st);

    const shown = hints.onEvent(ev("brownout"));
    expect(shown?.id).toBe("brownout");
    expect(shown?.title).toBe(HINTS.brownout.title);
    expect(st.map.get(HINTS_SEEN_KEY)).toContain("brownout"); // persisted at show time

    hints.dismiss();
    expect(hints.onEvent(ev("brownout"))).toBeNull(); // one-shot

    const fresh = new Hints(st); // a new session over the same storage still remembers
    expect(fresh.onEvent(ev("brownout"))).toBeNull();
    expect(fresh.onEvent(ev("traders_inbound"))?.id).toBe("trade"); // others unaffected
  });

  it("shows one toast at a time — a blocked hint is NOT burned and can show later", () => {
    const hints = new Hints(unlockedStorage());
    expect(hints.onEvent(ev("brownout"))?.id).toBe("brownout");
    expect(hints.onEvent(ev("ufo_inbound"))).toBeNull(); // the brownout card is still up
    hints.dismiss();
    expect(hints.onEvent(ev("ufo_inbound"))?.id).toBe("deflector"); // unburned
  });

  it("drives the snapshot hints through the same gate", () => {
    const hints = new Hints(unlockedStorage());
    expect(hints.onSnapshot(makeSnap({ t: 5, possessed: 2 }))?.id).toBe("mining");
    hints.dismiss();
    expect(hints.onSnapshot(makeSnap({ t: 6, possessed: 2 }))).toBeNull();
  });

  it("does not burn the mining trigger when another toast blocks the offer", () => {
    const hints = new Hints(unlockedStorage());
    expect(hints.onEvent(ev("brownout"))?.id).toBe("brownout"); // a card is up
    // first possession lands while the brownout card is still showing
    expect(hints.onSnapshot(makeSnap({ t: 5, possessed: 2 }))).toBeNull();
    expect(hints.scratch.possessedOnce).toBe(false); // blocked ≠ burned
    hints.dismiss();
    // the next opportunity this run still gets the mining hint
    expect(hints.onSnapshot(makeSnap({ t: 6, possessed: 2 }))?.id).toBe("mining");
    expect(hints.scratch.possessedOnce).toBe(true); // consumed at show time
  });

  it("consumes the trigger when mining was seen in a past run, so corridor is not shadowed", () => {
    const st = unlockedStorage({ [HINTS_SEEN_KEY]: JSON.stringify(["mining"]) });
    const hints = new Hints(st);
    expect(hints.onSnapshot(makeSnap({ t: 5, possessed: 2 }))).toBeNull(); // seen forever
    expect(hints.scratch.possessedOnce).toBe(true); // burned for good — stop proposing
    // ...which lets the corridor debounce win while still possessed
    const stranded = (t: number) => makeSnap({ t, possessed: 2, buildings: [bld(1, "hab", false)] });
    expect(hints.onSnapshot(stranded(10))).toBeNull(); // the clock starts
    expect(hints.onSnapshot(stranded(15))?.id).toBe("corridor");
  });

  it("suppresses everything while the FirstHint card is unseen — without burning hints", () => {
    const st = memStorage(); // no FIRST_HINT_KEY yet
    const hints = new Hints(st);
    expect(hints.onEvent(ev("brownout"))).toBeNull();
    expect(hints.onSnapshot(makeSnap({ t: 5, possessed: 2 }))).toBeNull();

    st.map.set(FIRST_HINT_KEY, "1"); // the player dismisses the welcome card mid-session
    expect(hints.onEvent(ev("brownout"))?.id).toBe("brownout"); // suppression lifted, hint intact
  });

  it("never throws when storage itself throws (and stays safely suppressed)", () => {
    const hints = new Hints(throwing);
    expect(() => hints.onEvent(ev("brownout"))).not.toThrow();
    expect(hints.onEvent(ev("brownout"))).toBeNull(); // FirstHint reads as unseen — the safe default
    expect(() => hints.onSnapshot(makeSnap({ t: 3, possessed: 1 }))).not.toThrow();
    expect(() => hints.dismiss()).not.toThrow();
  });
});
