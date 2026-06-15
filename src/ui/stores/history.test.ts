/* ============================================================================
   Run-history tests — the PURE telemetry recorder behind the end-of-run report.
   Sampling cadence, cap-and-decimate (the full 22-sol ≈ 3300 s run must always
   fit), the event whitelist, and the injectable-storage persistence. No DOM, no
   localStorage: vitest runs in plain Node and storage is always injected.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { ColonyEvent, EventType, Pool, Snapshot } from "@shared/types";
import {
  HISTORY_KEY, SAMPLE_CAP, emptyHistory, loadHistory, recordEvent, recordSnapshot,
  resetHistory, saveHistory,
} from "./history";

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

function pool(amount = 50, capacity = 100): Pool {
  return { amount, capacity };
}

function makeSnap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    N: 15,
    buildings: [],
    pools: { power: pool(80), water: pool(60), oxygen: pool(40), food: pool(20) },
    flow: { power: 0, water: 0, oxygen: 0, food: 0 },
    materials: pool(10, 60),
    colonists: [],
    deposits: [],
    vents: [],
    aquifers: [],
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
    world: "mars",
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

// ---- sampling -----------------------------------------------------------------

describe("history sampling", () => {
  it("samples on the starting 2-second cadence and captures the pool levels", () => {
    const h = emptyHistory();
    expect(h.interval).toBe(2);

    recordSnapshot(h, makeSnap({ t: 0.5 })); // under the first interval — nothing yet
    expect(h.samples).toHaveLength(0);

    recordSnapshot(h, makeSnap({ t: 2.1, sol: 1 }));
    expect(h.samples).toHaveLength(1);
    expect(h.samples[0]).toEqual({ t: 2.1, sol: 1, power: 80, water: 60, oxygen: 40, food: 20, pop: 4 });

    recordSnapshot(h, makeSnap({ t: 3.0 })); // only 0.9 s since the last — skipped
    expect(h.samples).toHaveLength(1);

    recordSnapshot(h, makeSnap({ t: 4.2 }));
    expect(h.samples).toHaveLength(2);
    expect(h.lastT).toBe(4.2);
  });

  it("at the cap it drops the odd-index samples and doubles the interval", () => {
    const h = emptyHistory();
    for (let t = 2; t <= SAMPLE_CAP * 2; t += 2) recordSnapshot(h, makeSnap({ t }));
    // the 600th sample triggered the decimation: 600 → 300, 2 s → 4 s
    expect(h.samples).toHaveLength(SAMPLE_CAP / 2);
    expect(h.interval).toBe(4);
    // even indices survive: t = 2, 6, 10, …
    expect(h.samples[0].t).toBe(2);
    expect(h.samples[1].t).toBe(6);
    expect(h.samples[2].t).toBe(10);
  });

  it("holds the bound across a full 22-sol (≈3300 s) run and still spans it end-to-end", () => {
    const h = emptyHistory();
    for (let t = 0; t <= 3300; t += 0.5) recordSnapshot(h, makeSnap({ t }));
    expect(h.samples.length).toBeLessThanOrEqual(SAMPLE_CAP);
    expect(h.interval).toBe(8); // 2 → 4 → 8 — two decimations cover the whole campaign
    expect(h.samples[0].t).toBe(2); // index 0 survives every decimation
    expect(h.samples[h.samples.length - 1].t).toBeGreaterThanOrEqual(3300 - 8);
  });
});

// ---- event tallies ---------------------------------------------------------------

describe("history event tallies", () => {
  it("counts only the whitelisted events, plus hazards by kind on hazard_start", () => {
    const h = emptyHistory();
    recordEvent(h, ev("brownout"));
    recordEvent(h, ev("brownout"));
    recordEvent(h, ev("casualty"));
    recordEvent(h, ev("abducted"));
    recordEvent(h, ev("birth"));
    recordEvent(h, ev("building_destroyed"));
    recordEvent(h, ev("trade_done"));
    recordEvent(h, ev("resupply"));
    recordEvent(h, ev("arrival"));
    recordEvent(h, ev("hazard_start", { kind: "meteor" }));
    recordEvent(h, ev("hazard_start", { kind: "meteor" }));
    recordEvent(h, ev("hazard_start", { kind: "flare" }));
    // off the whitelist — ignored
    recordEvent(h, ev("dawn"));
    recordEvent(h, ev("crit_start"));
    recordEvent(h, ev("build"));
    recordEvent(h, ev("victory"));

    expect(h.events.brownout).toBe(2);
    expect(h.events.casualty).toBe(1);
    expect(h.events.abducted).toBe(1);
    expect(h.events.birth).toBe(1);
    expect(h.events.building_destroyed).toBe(1);
    expect(h.events.trade_done).toBe(1);
    expect(h.events.resupply).toBe(1);
    expect(h.events.arrival).toBe(1);
    expect(h.events.hazard_start).toBe(3);
    expect(h.hazards.meteor).toBe(2);
    expect(h.hazards.flare).toBe(1);
    expect(h.hazards.dust).toBeUndefined();
    expect(h.events.dawn).toBeUndefined();
    expect(h.events.crit_start).toBeUndefined();
    expect(h.events.build).toBeUndefined();
    expect(h.events.victory).toBeUndefined();
  });
});

// ---- persistence ---------------------------------------------------------------

describe("history persistence", () => {
  it("round-trips through an injected storage", () => {
    const st = memStorage();
    const h = emptyHistory();
    for (let t = 2; t <= 20; t += 2) recordSnapshot(h, makeSnap({ t }));
    recordEvent(h, ev("birth"));
    recordEvent(h, ev("hazard_start", { kind: "dust" }));
    h.directorStrikes = 3;

    saveHistory(h, st);
    expect(st.map.has(HISTORY_KEY)).toBe(true);
    expect(loadHistory(st)).toEqual(h);
  });

  it("resetHistory returns a fresh record and persists the wipe", () => {
    const st = memStorage();
    const h = emptyHistory();
    recordSnapshot(h, makeSnap({ t: 5 }));
    recordEvent(h, ev("brownout"));
    saveHistory(h, st);

    const fresh = resetHistory(st);
    expect(fresh.samples).toHaveLength(0);
    expect(fresh.events).toEqual({});
    expect(fresh.hazards).toEqual({});
    expect(fresh.directorStrikes).toBe(0);
    expect(fresh.interval).toBe(2);
    expect(loadHistory(st)).toEqual(emptyHistory());
  });

  it("falls back to an empty history on corrupt JSON, no storage, or a throwing storage", () => {
    const bad = memStorage({ [HISTORY_KEY]: "{{{ not json" });
    expect(loadHistory(bad)).toEqual(emptyHistory());
    expect(loadHistory()).toEqual(emptyHistory()); // plain Node — no localStorage at all
    expect(loadHistory(throwing)).toEqual(emptyHistory());
    expect(() => saveHistory(emptyHistory(), throwing)).not.toThrow();
    expect(() => resetHistory(throwing)).not.toThrow();
  });
});
