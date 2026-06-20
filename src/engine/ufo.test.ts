/* ============================================================================
   The evil UFO — abduction, the Deflector shield, safety floors, determinism.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { BuildingState, ColonyEvent, Side } from "@shared/types";
import { Colony } from "./index";
import { abductionBlockChance, updateUfo } from "./ufo";
import type { ColonistInstance, ColonyState, UfoInstance } from "./state";
import { emptyColonist } from "./state";
import { RNG } from "./rng";
import {
  DEFLECTOR_BLOCK, UFO_FIRST, UFO_MIN_POP, UFO_MIN_SOL,
  UFO_INBOUND, UFO_HOVER, UFO_LEAVE,
} from "./tuning";
import { TECH_DEFS } from "./techs";

const AEGIS = TECH_DEFS.aegis.deflectorBoost!;

/** an env-rng stub returning a fixed draw, to force the abduction roll either way */
const rngOf = (v: number): RNG => ({ next: () => v }) as unknown as RNG;

/** collect the events updateUfo emits (it's passed the colony's stamping emit) */
function collector() {
  const ev: Array<Omit<ColonyEvent, "t" | "sol" | "tod">> = [];
  return { ev, emit: (e: Omit<ColonyEvent, "t" | "sol" | "tod">) => { ev.push(e); } };
}

/** a minimal state carrying only what updateUfo touches */
function ufoState(o: Partial<{
  ufo: UfoInstance | null; nextUfo: number; ufoCounter: number;
  sol: number; population: number; colonists: ColonistInstance[];
  possessed: number | null; buildings: BuildingState[]; acquiredTech: string[];
}>): ColonyState {
  const colonists = o.colonists ?? [];
  return {
    ufo: o.ufo ?? null,
    nextUfo: o.nextUfo ?? UFO_FIRST,
    ufoCounter: o.ufoCounter ?? 1,
    sol: o.sol ?? 5,
    population: o.population ?? colonists.length,
    colonists,
    pilots: o.possessed != null ? [{ id: o.possessed, dx: 0, dy: 0 }] : [],
    buildings: o.buildings ?? [],
    acquiredTech: o.acquiredTech ?? [],
  } as unknown as ColonyState;
}

const people = (n: number): ColonistInstance[] =>
  Array.from({ length: n }, (_, i) => emptyColonist(i + 1, 5, 5));

/** a deflector building state with the bits the shield math reads */
function deflector(online: boolean, integrity = 1, faulted = 0): BuildingState {
  return {
    uid: 1, defId: "deflector", gx: 0, gy: 0, rot: 0 as Side,
    online, connected: true, staffed: true, fed: true, util: 1,
    integrity, faulted,
  };
}

/** a minimal state carrying only what abductionBlockChance touches */
function shieldState(buildings: BuildingState[], acquiredTech: string[] = []): ColonyState {
  return { buildings, acquiredTech } as unknown as ColonyState;
}

/** advance a colony, collecting events */
function run(c: Colony, seconds: number, step = 0.2): ColonyEvent[] {
  const events: ColonyEvent[] = [];
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) { c.tick(step); events.push(...c.drainEvents()); }
  return events;
}

describe("the Deflector shield (abductionBlockChance)", () => {
  it("is zero with no deflector", () => {
    expect(abductionBlockChance(shieldState([]))).toBe(0);
  });

  it("equals the base block for one online, functional deflector", () => {
    expect(abductionBlockChance(shieldState([deflector(true)]))).toBeCloseTo(DEFLECTOR_BLOCK, 6);
  });

  it("is raised by the Aegis tech", () => {
    const got = abductionBlockChance(shieldState([deflector(true)], ["aegis"]));
    expect(got).toBeCloseTo(DEFLECTOR_BLOCK + AEGIS, 6);
  });

  it("is zero when the only deflector is offline (e.g. browned out)", () => {
    expect(abductionBlockChance(shieldState([deflector(false)]))).toBe(0);
  });

  it("is zero when the deflector is too damaged to function", () => {
    expect(abductionBlockChance(shieldState([deflector(true, 0.1)]))).toBe(0);
  });

  it("stacks two deflectors with diminishing returns", () => {
    const got = abductionBlockChance(shieldState([deflector(true), deflector(true)]));
    expect(got).toBeCloseTo(1 - (1 - DEFLECTOR_BLOCK) ** 2, 6);
  });
});

describe("the abduction beat (hovering → leaving)", () => {
  it("takes the locked colonist when undefended — population drops, event fires", () => {
    const colonists = people(4);
    const s = ufoState({
      population: 4, colonists,
      ufo: { id: 1, phase: "hovering", tLeft: 0.1, targetId: 3, gx: 5, gy: 5 },
    });
    const { ev, emit } = collector();
    updateUfo(s, 0.2, rngOf(0.9), emit); // no shield → block chance 0 → grab succeeds

    expect(s.population).toBe(3);
    expect(s.colonists.find((c) => c.id === 3)).toBeUndefined();
    expect(ev.some((e) => e.type === "abducted")).toBe(true);
    expect(s.ufo?.phase).toBe("leaving");
  });

  it("is foiled when the deflector shield wins the roll", () => {
    const s = ufoState({
      population: 5, colonists: people(5), buildings: [deflector(true)],
      ufo: { id: 1, phase: "hovering", tLeft: 0.1, targetId: 3, gx: 5, gy: 5 },
    });
    const { ev, emit } = collector();
    updateUfo(s, 0.2, rngOf(0.1), emit); // roll 0.1 < block 0.5 → blocked

    expect(s.population).toBe(5);
    expect(s.colonists.find((c) => c.id === 3)).toBeDefined();
    expect(ev.some((e) => e.type === "abduction_blocked")).toBe(true);
    expect(ev.some((e) => e.type === "abducted")).toBe(false);
    expect(s.ufo?.phase).toBe("leaving");
  });

  it("still abducts when the shield loses the roll", () => {
    const s = ufoState({
      population: 5, colonists: people(5), buildings: [deflector(true)],
      ufo: { id: 1, phase: "hovering", tLeft: 0.1, targetId: 3, gx: 5, gy: 5 },
    });
    const { ev, emit } = collector();
    updateUfo(s, 0.2, rngOf(0.9), emit); // roll 0.9 ≥ block 0.5 → grab succeeds

    expect(s.population).toBe(4);
    expect(ev.some((e) => e.type === "abducted")).toBe(true);
  });

  it("never abducts below the population floor (rare event can't end the game)", () => {
    const s = ufoState({
      population: UFO_MIN_POP, colonists: people(UFO_MIN_POP),
      ufo: { id: 1, phase: "hovering", tLeft: 0.1, targetId: 1, gx: 5, gy: 5 },
    });
    const { ev, emit } = collector();
    updateUfo(s, 0.2, rngOf(0.9), emit);

    expect(s.population).toBe(UFO_MIN_POP);
    expect(ev.some((e) => e.type === "abducted")).toBe(false);
    expect(s.ufo?.phase).toBe("leaving");
  });

  it("leaves empty-handed if its target vanished mid-hover", () => {
    const s = ufoState({
      population: 5, colonists: people(5),
      ufo: { id: 1, phase: "hovering", tLeft: 0.1, targetId: 99, gx: 5, gy: 5 },
    });
    const { ev, emit } = collector();
    updateUfo(s, 0.2, rngOf(0.9), emit);

    expect(s.population).toBe(5);
    expect(ev.some((e) => e.type === "abducted")).toBe(false);
    expect(s.ufo?.phase).toBe("leaving");
  });
});

describe("the UFO scheduler + lifecycle", () => {
  it("does not appear before the minimum sol", () => {
    const s = ufoState({ nextUfo: 0, sol: UFO_MIN_SOL - 1, colonists: people(6) });
    const { ev, emit } = collector();
    updateUfo(s, 0.2, new RNG(1), emit);

    expect(s.ufo).toBeNull();
    expect(ev.some((e) => e.type === "ufo_inbound")).toBe(false);
    expect(s.nextUfo).toBeGreaterThan(0); // rescheduled a retry
  });

  it("does not appear at/below the population floor", () => {
    const s = ufoState({ nextUfo: 0, sol: 5, colonists: people(UFO_MIN_POP) });
    const { ev, emit } = collector();
    updateUfo(s, 0.2, new RNG(1), emit);

    expect(s.ufo).toBeNull();
    expect(ev.some((e) => e.type === "ufo_inbound")).toBe(false);
  });

  it("appears when eligible, locking onto a non-possessed colonist", () => {
    const s = ufoState({ nextUfo: 0, sol: 5, colonists: people(6), possessed: 1 });
    const { ev, emit } = collector();
    updateUfo(s, 0.2, new RNG(7), emit);

    expect(s.ufo).not.toBeNull();
    expect(s.ufo?.phase).toBe("inbound");
    expect(s.ufo?.targetId).not.toBe(1); // never the colonist you're piloting
    expect(s.ufo?.targetId).not.toBeNull();
    expect(ev.some((e) => e.type === "ufo_inbound")).toBe(true);
  });

  it("walks inbound → hovering → leaving → gone", () => {
    const s = ufoState({
      population: 5, colonists: people(5),
      ufo: { id: 1, phase: "inbound", tLeft: UFO_INBOUND, targetId: 2, gx: 5, gy: 5 },
    });
    const { ev, emit } = collector();
    const rng = rngOf(0.9);

    updateUfo(s, UFO_INBOUND, rng, emit);
    expect(s.ufo?.phase).toBe("hovering");
    updateUfo(s, UFO_HOVER, rng, emit);
    expect(s.ufo?.phase).toBe("leaving");
    updateUfo(s, UFO_LEAVE, rng, emit);
    expect(s.ufo).toBeNull();
    expect(ev.some((e) => e.type === "ufo_left")).toBe(true);
  });
});

/** reach the engine's private state to make a (rare, scheduled) UFO due now — an
 *  unattended colony is designed to die, so we can't wait for one to occur naturally */
function due(c: Colony): ColonyState {
  const s = (c as unknown as { s: ColonyState }).s;
  s.sol = UFO_MIN_SOL;  // past the early-game floor
  s.nextUfo = 0;        // a UFO is due on the next tick
  return s;
}

describe("the UFO is wired through the real tick + snapshot, deterministically", () => {
  it("appears in the snapshot and abducts an undefended colonist via tick()", () => {
    const c = new Colony(20260609);
    due(c);
    const pop0 = c.snapshot().population;

    const inbound = run(c, 0.4);
    expect(c.snapshot().ufo).not.toBeNull();          // ufoView wired into snapshot
    expect(c.snapshot().ufo?.phase).toBe("inbound");
    expect(inbound.some((e) => e.type === "ufo_inbound")).toBe(true);

    const rest = run(c, UFO_INBOUND + UFO_HOVER + UFO_LEAVE + 1);
    expect(rest.some((e) => e.type === "abducted")).toBe(true); // undefended → taken
    expect(c.snapshot().population).toBe(pop0 - 1);
    expect(c.snapshot().ufo).toBeNull();              // departed
  });

  it("two same-seed colonies run the UFO identically", () => {
    const a = new Colony(4242); due(a);
    const b = new Colony(4242); due(b);
    const evA = run(a, 30).filter((e) => e.type.startsWith("ufo") || e.type === "abducted");
    const evB = run(b, 30).filter((e) => e.type.startsWith("ufo") || e.type === "abducted");

    expect(evA.length).toBeGreaterThan(0);
    expect(evB).toEqual(evA);
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it("serialize → load resumes bit-identically mid-abduction", () => {
    const c = new Colony(777); due(c);
    run(c, 0.4 + UFO_INBOUND);                         // advance into the hover
    expect(c.snapshot().ufo?.phase).toBe("hovering");

    const d = Colony.load(c.serialize());              // ufo must round-trip
    run(c, UFO_HOVER + UFO_LEAVE + 1);
    run(d, UFO_HOVER + UFO_LEAVE + 1);
    expect(d.snapshot()).toEqual(c.snapshot());
  });
});

export { run };
