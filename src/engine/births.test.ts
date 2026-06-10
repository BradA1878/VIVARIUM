/* ============================================================================
   In-colony births — the settlement grows from within when it's thriving.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { ColonyEvent, Resource } from "@shared/types";
import { maybeBirth } from "./tick";
import type { ColonyState } from "./state";
import { RNG } from "./rng";
import { BIRTH_MIN_POP, BIRTH_RETRY } from "./tuning";

const SURPLUS: Record<Resource, number> = { power: 2, oxygen: 1, water: 1, food: 1 };
const O2_DEFICIT: Record<Resource, number> = { power: 2, oxygen: -1, water: 1, food: 1 };

function collector() {
  const ev: Array<Omit<ColonyEvent, "t" | "sol" | "tod">> = [];
  return { ev, emit: (e: Omit<ColonyEvent, "t" | "sol" | "tod">) => { ev.push(e); } };
}

/** a minimal state carrying only what maybeBirth touches */
function birthState(o: Partial<{
  nextBirth: number; population: number; housing: number;
  timers: ColonyState["timers"];
}>): ColonyState {
  return {
    nextBirth: o.nextBirth ?? 0,
    population: o.population ?? 6,
    housing: o.housing ?? 12,
    timers: o.timers ?? { oxygen: null, water: null, food: null },
  } as unknown as ColonyState;
}

describe("maybeBirth — the colony grows from within", () => {
  it("adds a colonist when thriving, roomy, settled, and calm", () => {
    const s = birthState({ population: 6 });
    const { ev, emit } = collector();
    maybeBirth(s, SURPLUS, 0.2, new RNG(1), emit);

    expect(s.population).toBe(7);
    expect(ev.some((e) => e.type === "birth")).toBe(true);
    expect(s.nextBirth).toBeGreaterThan(BIRTH_RETRY); // a long gap until the next
  });

  it("does nothing until the birth timer is due", () => {
    const s = birthState({ population: 6, nextBirth: 50 });
    const { ev, emit } = collector();
    maybeBirth(s, SURPLUS, 0.2, new RNG(1), emit);

    expect(s.population).toBe(6);
    expect(ev.length).toBe(0);
    expect(s.nextBirth).toBeCloseTo(49.8, 6);
  });

  it("does not birth without a surplus on every life-support resource", () => {
    const s = birthState({ population: 6 });
    const { ev, emit } = collector();
    maybeBirth(s, O2_DEFICIT, 0.2, new RNG(1), emit);

    expect(s.population).toBe(6);
    expect(ev.length).toBe(0);
    expect(s.nextBirth).toBe(BIRTH_RETRY); // re-checks soon
  });

  it("does not birth with no spare housing", () => {
    const s = birthState({ population: 8, housing: 8 });
    const { ev, emit } = collector();
    maybeBirth(s, SURPLUS, 0.2, new RNG(1), emit);

    expect(s.population).toBe(8);
    expect(ev.length).toBe(0);
  });

  it("does not birth below the settlement population floor", () => {
    const s = birthState({ population: BIRTH_MIN_POP - 1, housing: 12 });
    const { ev, emit } = collector();
    maybeBirth(s, SURPLUS, 0.2, new RNG(1), emit);

    expect(s.population).toBe(BIRTH_MIN_POP - 1);
    expect(ev.length).toBe(0);
  });

  it("does not birth during a life-support crisis", () => {
    const s = birthState({ population: 6, timers: { oxygen: 12, water: null, food: null } });
    const { ev, emit } = collector();
    maybeBirth(s, SURPLUS, 0.2, new RNG(1), emit);

    expect(s.population).toBe(6);
    expect(ev.length).toBe(0);
  });

  it("is deterministic — same seed schedules the next birth identically", () => {
    const a = birthState({ population: 6 });
    const b = birthState({ population: 6 });
    maybeBirth(a, SURPLUS, 0.2, new RNG(99), collector().emit);
    maybeBirth(b, SURPLUS, 0.2, new RNG(99), collector().emit);
    expect(a.nextBirth).toBe(b.nextBirth);
  });
});
