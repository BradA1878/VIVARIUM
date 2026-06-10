/* ============================================================================
   Colony morale — continuous drivers, the floor/ceiling clamps, the latched
   low/recovered pair, the production multiplier, and the casualty step bump.
   Morale is a pure function of state: zero RNG draws, so determinism holds.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { ColonyEvent } from "@shared/types";
import { Colony, DEFS } from "./index";
import { bumpMorale, moraleFloor, moraleMult, updateMorale } from "./morale";
import type { ColonyState } from "./state";
import {
  MORALE_START, MORALE_FLOOR, MORALE_EFF, MORALE_LOW_T, MORALE_OK_T,
  MORALE_CRISIS_RATE, MORALE_BROWNOUT_RATE, MORALE_CALM_RATE, MORALE_PROGRESS_RATE,
  MORALE_BUMP, ROLE_BONUS,
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

/** collect the events updateMorale emits */
function collector() {
  const ev: Array<Omit<ColonyEvent, "t" | "sol" | "tod">> = [];
  return { ev, emit: (e: Omit<ColonyEvent, "t" | "sol" | "tod">) => { ev.push(e); } };
}

/** a minimal state carrying only what the morale math touches */
function moraleState(o: Partial<{
  morale: number; moraleLatch: boolean;
  timers: ColonyState["timers"];
  brownLatch: boolean; population: number; selfSufficientFor: number;
}> = {}): ColonyState {
  return {
    morale: o.morale ?? MORALE_START,
    moraleLatch: o.moraleLatch ?? false,
    timers: o.timers ?? { oxygen: null, water: null, food: null },
    brownLatch: o.brownLatch ?? false,
    population: o.population ?? 4,
    selfSufficientFor: o.selfSufficientFor ?? 0,
  } as unknown as ColonyState;
}

describe("continuous drivers (updateMorale)", () => {
  it("an active shortfall timer decays morale at MORALE_CRISIS_RATE, per crisis", () => {
    const one = moraleState({ timers: { oxygen: 10, water: null, food: null } });
    const two = moraleState({ timers: { oxygen: 10, water: 10, food: null } });
    updateMorale(one, 1, collector().emit);
    updateMorale(two, 1, collector().emit);
    expect(one.morale).toBeCloseTo(MORALE_START - MORALE_CRISIS_RATE, 6);
    expect(two.morale).toBeCloseTo(MORALE_START - 2 * MORALE_CRISIS_RATE, 6);
  });

  it("the brownout latch drains morale at MORALE_BROWNOUT_RATE", () => {
    const s = moraleState({ brownLatch: true });
    updateMorale(s, 1, collector().emit);
    expect(s.morale).toBeCloseTo(MORALE_START - MORALE_BROWNOUT_RATE, 6);
  });

  it("calm (no timers, no brownout, people alive) recovers at MORALE_CALM_RATE", () => {
    const s = moraleState({ morale: 0.5 });
    updateMorale(s, 1, collector().emit);
    expect(s.morale).toBeCloseTo(0.5 + MORALE_CALM_RATE, 6);
  });

  it("a dead colony does not calm-recover", () => {
    const s = moraleState({ morale: 0.5, population: 0 });
    updateMorale(s, 1, collector().emit);
    expect(s.morale).toBeCloseTo(0.5, 6);
  });

  it("campaign progress adds MORALE_PROGRESS_RATE on top of calm", () => {
    const s = moraleState({ morale: 0.5, selfSufficientFor: 5 });
    updateMorale(s, 1, collector().emit);
    expect(s.morale).toBeCloseTo(0.5 + MORALE_CALM_RATE + MORALE_PROGRESS_RATE, 6);
  });
});

describe("clamps", () => {
  it("crisis drain never sinks below the floor", () => {
    const s = moraleState({ morale: MORALE_FLOOR + 0.01, timers: { oxygen: 1, water: 1, food: 1 } });
    updateMorale(s, 120, collector().emit);
    expect(s.morale).toBe(MORALE_FLOOR);
  });

  it("calm recovery never rises above 1", () => {
    const s = moraleState({ morale: 0.99, selfSufficientFor: 5 });
    updateMorale(s, 120, collector().emit);
    expect(s.morale).toBe(1);
  });

  it("bumpMorale clamps into [floor, 1]", () => {
    const s = moraleState();
    bumpMorale(s, -10);
    expect(s.morale).toBe(moraleFloor(s));
    bumpMorale(s, +10);
    expect(s.morale).toBe(1);
  });
});

describe("the latched low/recovered pair (mirrors the brownout latch)", () => {
  it("emits morale_low exactly once, then morale_recovered after climbing past MORALE_OK_T", () => {
    const s = moraleState({ morale: MORALE_LOW_T + 0.005, timers: { oxygen: 1, water: 1, food: 1 } });
    const { ev, emit } = collector();
    for (let i = 0; i < 10; i++) updateMorale(s, 1, emit); // falls well below, stays latched
    expect(ev.filter((e) => e.type === "morale_low").length).toBe(1);
    expect(ev.some((e) => e.type === "morale_recovered")).toBe(false);

    // inside the hysteresis band nothing fires...
    s.timers = { oxygen: null, water: null, food: null };
    s.morale = (MORALE_LOW_T + MORALE_OK_T) / 2;
    updateMorale(s, 1, emit);
    expect(ev.some((e) => e.type === "morale_recovered")).toBe(false);

    // ...until calm carries morale past MORALE_OK_T — recovered fires once
    for (let i = 0; i < 60; i++) updateMorale(s, 1, emit);
    expect(ev.filter((e) => e.type === "morale_recovered").length).toBe(1);
    expect(ev.filter((e) => e.type === "morale_low").length).toBe(1); // still just the one
  });
});

describe("moraleMult — the production multiplier", () => {
  it("is exactly 1 at MORALE_START (a fresh colony changes nothing)", () => {
    expect(moraleMult(moraleState())).toBe(1);
    expect(moraleMult(stateOf(new Colony()))).toBe(1);
  });

  it("swings by MORALE_EFF around the start point", () => {
    expect(moraleMult(moraleState({ morale: 1 })))
      .toBeCloseTo(1 + MORALE_EFF * (1 - MORALE_START), 6);
    expect(moraleMult(moraleState({ morale: MORALE_FLOOR })))
      .toBeCloseTo(1 + MORALE_EFF * (MORALE_FLOOR - MORALE_START), 6);
  });
});

describe("morale is wired through the real tick", () => {
  it("an oxygen crisis drags morale down until morale_low fires", () => {
    const c = new Colony(9);
    c.removeAt(5, 7); // electrolysis — oxygen only drains (engine.test.ts pattern)
    const events = run(c, 200);
    expect(events.some((e) => e.type === "crit_start" && e.res === "oxygen")).toBe(true);
    expect(events.some((e) => e.type === "morale_low")).toBe(true);
    expect(c.snapshot().morale).toBeLessThan(MORALE_START);
  });

  it("a casualty steps morale down by MORALE_BUMP.casualty", () => {
    const c = new Colony(9);
    c.removeAt(5, 7); // no oxygen production
    const s = stateOf(c);
    s.pools.oxygen.amount = 0;
    s.timers.oxygen = 0.05; // the grace timer expires on the next tick
    const events = run(c, 0.2);
    expect(events.some((e) => e.type === "casualty")).toBe(true);
    // pass 6 steps −BUMP, then pass 6b's crisis driver drains one tick more
    expect(c.snapshot().morale)
      .toBeCloseTo(MORALE_START - MORALE_BUMP.casualty - MORALE_CRISIS_RATE * 0.2, 6);
  });

  /** one tick of flow with morale injected — workers pinned to their matched
   *  buildings (roster.test.ts arrangement) so roleMult is identical in both
   *  runs and moraleMult is the only factor that varies */
  function flowAtMorale(morale: number): Record<string, number> {
    const c = new Colony(31337);
    const s = stateOf(c);
    const ext = s.buildings.find((b) => b.defId === "extractor")!;
    const elec = s.buildings.find((b) => b.defId === "electrolysis")!;
    for (const k of s.colonists) k.workUid = null;
    s.colonists.find((k) => k.id === 1)!.workUid = ext.uid; // miner
    s.colonists.find((k) => k.id === 2)!.workUid = elec.uid; // engineer
    s.morale = morale;
    c.tick(0.2);
    return c.snapshot().flow;
  }

  it("non-start morale scales production by exactly moraleMult — produces only", () => {
    const base = flowAtMorale(MORALE_START); // moraleMult === 1, the control
    const low = flowAtMorale(0.4);
    const dMult = MORALE_EFF * (0.4 - MORALE_START); // moraleMult(0.4) − 1
    const roleMult = 1 + ROLE_BONUS; // matched slots, identical in both runs
    expect(low.water - base.water)
      .toBeCloseTo(DEFS.extractor.produces.water! * roleMult * dMult, 5);
    expect(low.oxygen - base.oxygen)
      .toBeCloseTo(DEFS.electrolysis.produces.oxygen! * roleMult * dMult, 5);
    // electrolysis's water consume cancels in the delta above, and power is
    // only ever drawn in this base — an eff leak into consumes splits these
    expect(low.power).toBe(base.power);
  });
});

describe("determinism + persistence", () => {
  it("two same-seed colonies have equal morale + snapshots after 600s", () => {
    const a = new Colony(20260610);
    const b = new Colony(20260610);
    run(a, 600);
    run(b, 600);
    expect(a.snapshot().morale).toBe(b.snapshot().morale);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it("save → load round-trips morale and the latch", () => {
    const c = new Colony(777);
    run(c, 60);
    stateOf(c).morale = 0.42; // a distinctive value to round-trip
    stateOf(c).moraleLatch = true;
    const d = Colony.load(c.serialize());
    expect(d.snapshot().morale).toBe(0.42);
    expect(stateOf(d).moraleLatch).toBe(true);
  });

  it("a save without the morale fields loads with defaults (still version 1)", () => {
    const c = new Colony(777);
    run(c, 30);
    const save = c.serialize();
    expect(save.version).toBe(1);
    delete (save.state as Partial<ColonyState>).morale;
    delete (save.state as Partial<ColonyState>).moraleLatch;
    const d = Colony.load(save);
    expect(d.snapshot().morale).toBe(MORALE_START);
    expect(stateOf(d).moraleLatch).toBe(false);
  });
});
