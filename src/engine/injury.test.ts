/* ============================================================================
   Injuries + the Med-Bay — strike wounds, the kill-on-second-hit rule, recovery
   rates (open ground vs the medbay door vs a medic-staffed medbay), triage
   movement, the labor pool, persistence, determinism. Rare events are tested by
   direct state injection (ufo.test.ts pattern), never by waiting.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { BuildingState, ColonyEvent, Side } from "@shared/types";
import { Colony, DEFS, ORDER } from "./index";
import { applyStrikeInjuries, updateInjuries, injuredCount } from "./injury";
import { stepColonists } from "./colonists";
import type { ColonistInstance, ColonyState } from "./state";
import { emptyColonist } from "./state";
import {
  INJURY_RADIUS, INJURY_RECOVERY, MEDBAY_HEAL_MULT, MEDIC_HEAL_BONUS,
  INJURED_SPEED, INJURED_PILOT_FACTOR, PILOT_SPEED,
  MORALE_START, MORALE_BUMP, ARRIVE_EPS,
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

/** collect the events the injury passes emit */
function collector() {
  const ev: Array<Omit<ColonyEvent, "t" | "sol" | "tod">> = [];
  return { ev, emit: (e: Omit<ColonyEvent, "t" | "sol" | "tod">) => { ev.push(e); } };
}

/** a minimal state carrying only what applyStrikeInjuries touches */
function strikeState(colonists: ColonistInstance[], possessed: number | null = null): ColonyState {
  return {
    colonists, population: colonists.length, dead: 0,
    pilots: possessed != null ? [{ id: possessed, dx: 0, dy: 0 }] : [],
    morale: MORALE_START,
  } as unknown as ColonyState;
}

/** a medbay building state with the bits the heal math reads (door 2, rot 0 →
 *  its access cell is the door exit at (gx, gy+1)) */
function medbay(online = true, integrity = 1, faulted = 0): BuildingState {
  return {
    uid: 1, defId: "medbay", gx: 5, gy: 5, rot: 0 as Side,
    online, connected: true, staffed: true, fed: true, util: 1,
    integrity, faulted,
  };
}
const MEDBAY_DOOR = { x: 5, y: 6 }; // exit cell of medbay() above

/** a minimal state carrying only what updateInjuries touches */
function healState(colonists: ColonistInstance[], buildings: BuildingState[]): ColonyState {
  const N = 15;
  return {
    N, grid: new Int32Array(N * N), buildings,
    colonists, population: colonists.length, dead: 0, pilots: [],
    morale: MORALE_START,
  } as unknown as ColonyState;
}

describe("the Med-Bay def", () => {
  it("is data the engine can run: 1×1, sealed, staffed, draws power, no recipe", () => {
    const d = DEFS.medbay;
    expect(d.foot).toEqual([1, 1]);
    expect(d.matCost).toBe(26);
    expect(d.staffing).toBe(1);
    expect(d.consumes.power).toBe(4);
    expect(d.produces).toEqual({});
    expect(d.requiresPressure).toBe(true);
    expect(d.door).toBeDefined();
  });

  it("outlives a moderate brownout but never outranks air", () => {
    expect(DEFS.medbay.priority).toBeGreaterThan(DEFS.extractor.priority);
    expect(DEFS.medbay.priority).toBeLessThan(DEFS.electrolysis.priority);
  });

  it("sits after the greenhouse in the palette order", () => {
    expect(ORDER[ORDER.indexOf("greenhouse") + 1]).toBe("medbay");
  });
});

describe("applyStrikeInjuries", () => {
  it("wounds a healthy colonist at the cell; one beyond the radius is untouched", () => {
    const near = emptyColonist(1, 5, 5);
    const diag = emptyColonist(2, 6, 6); // dist √2 < INJURY_RADIUS
    const far = emptyColonist(3, 5 + INJURY_RADIUS + 0.1, 5);
    const s = strikeState([near, diag, far]);
    const { ev, emit } = collector();
    applyStrikeInjuries(s, 5, 5, emit);

    expect(near.injury).toBe(INJURY_RECOVERY);
    expect(diag.injury).toBe(INJURY_RECOVERY);
    expect(far.injury).toBe(0);
    expect(ev.filter((e) => e.type === "colonist_injured").map((e) => e.id)).toEqual([1, 2]);
    expect(s.population).toBe(3); // wounded, not dead
    expect(s.morale).toBeCloseTo(MORALE_START - 2 * MORALE_BUMP.injured, 6);
    expect(injuredCount(s)).toBe(2);
  });

  it("a second strike on an already-injured colonist kills", () => {
    const hurt = emptyColonist(1, 5, 5);
    hurt.injury = 12;
    const bystander = emptyColonist(2, 12, 12);
    const s = strikeState([hurt, bystander]);
    const { ev, emit } = collector();
    applyStrikeInjuries(s, 5, 5, emit);

    expect(s.colonists.find((c) => c.id === 1)).toBeUndefined();
    expect(s.population).toBe(1);
    expect(s.dead).toBe(1);
    const cas = ev.find((e) => e.type === "casualty");
    expect(cas).toBeDefined();
    expect(cas!.detail).toBe("strike");
    expect(cas!.n).toBe(1);
    expect(cas!.res).toBeUndefined(); // not a life-support death
    expect(s.morale).toBeCloseTo(MORALE_START - MORALE_BUMP.casualty, 6);
  });

  it("a strike death clears possession when the victim was piloted", () => {
    const hurt = emptyColonist(1, 5, 5);
    hurt.injury = 12;
    const s = strikeState([hurt, emptyColonist(2, 12, 12)], 1);
    applyStrikeInjuries(s, 5, 5, collector().emit);

    expect(s.pilots).toEqual([]); // the piloted victim died → released
    expect(s.population).toBe(1);
  });
});

describe("updateInjuries — recovery rates", () => {
  it("open ground heals at the base rate; the medbay door at MEDBAY_HEAL_MULT", () => {
    const atDoor = emptyColonist(1, MEDBAY_DOOR.x, MEDBAY_DOOR.y);
    atDoor.injury = INJURY_RECOVERY;
    const ground = emptyColonist(2, 12, 12);
    ground.injury = INJURY_RECOVERY;
    const s = healState([atDoor, ground], [medbay()]);
    updateInjuries(s, 1, collector().emit);

    expect(ground.injury).toBeCloseTo(INJURY_RECOVERY - 1, 6);
    expect(atDoor.injury).toBeCloseTo(INJURY_RECOVERY - MEDBAY_HEAL_MULT, 6);
  });

  it("a medic on the medbay slot speeds it up by a further (1 + MEDIC_HEAL_BONUS)", () => {
    const hurt = emptyColonist(1, MEDBAY_DOOR.x, MEDBAY_DOOR.y);
    hurt.injury = INJURY_RECOVERY;
    const medic = emptyColonist(4, 4, 5); // id 4 → "medic"
    medic.workUid = 1;
    const s = healState([hurt, medic], [medbay()]);
    updateInjuries(s, 1, collector().emit);

    expect(hurt.injury)
      .toBeCloseTo(INJURY_RECOVERY - MEDBAY_HEAL_MULT * (1 + MEDIC_HEAL_BONUS), 6);
  });

  it("an injured medic grants no bonus (roleMatchCount excludes the wounded)", () => {
    const hurt = emptyColonist(1, MEDBAY_DOOR.x, MEDBAY_DOOR.y);
    hurt.injury = INJURY_RECOVERY;
    const medic = emptyColonist(4, 12, 12);
    medic.workUid = 1;
    medic.injury = 5;
    const s = healState([hurt, medic], [medbay()]);
    updateInjuries(s, 1, collector().emit);

    expect(hurt.injury).toBeCloseTo(INJURY_RECOVERY - MEDBAY_HEAL_MULT, 6);
  });

  it("an offline or wrecked medbay treats nobody — base rate at its door", () => {
    const hurt = emptyColonist(1, MEDBAY_DOOR.x, MEDBAY_DOOR.y);
    hurt.injury = INJURY_RECOVERY;
    const s = healState([hurt], [medbay(false)]);
    updateInjuries(s, 1, collector().emit);
    expect(hurt.injury).toBeCloseTo(INJURY_RECOVERY - 1, 6);

    const hurt2 = emptyColonist(1, MEDBAY_DOOR.x, MEDBAY_DOOR.y);
    hurt2.injury = INJURY_RECOVERY;
    const s2 = healState([hurt2], [medbay(true, 0.1)]);
    updateInjuries(s2, 1, collector().emit);
    expect(hurt2.injury).toBeCloseTo(INJURY_RECOVERY - 1, 6);
  });

  it("emits colonist_recovered (with the id) the moment injury reaches 0", () => {
    const hurt = emptyColonist(7, 12, 12);
    hurt.injury = 0.4;
    const s = healState([hurt], []);
    const { ev, emit } = collector();
    updateInjuries(s, 1, emit);

    expect(hurt.injury).toBe(0);
    expect(ev.filter((e) => e.type === "colonist_recovered").map((e) => e.id)).toEqual([7]);
    expect(injuredCount(s)).toBe(0);
  });
});

describe("work eligibility + the labor pool", () => {
  it("an injured colonist is pulled off work and re-claims a slot on recovery", () => {
    const c = new Colony(11);
    const s = stateOf(c);
    c.tick(0.2); // one assign pass — the miner takes the extractor
    const k = s.colonists.find((x) => x.workUid != null)!;
    k.injury = 0.5;
    c.tick(0.2);
    expect(k.workUid).toBeNull();

    const events = run(c, 1); // heals the rest of the way at base rate
    expect(events.some((e) => e.type === "colonist_recovered" && e.id === k.id)).toBe(true);
    expect(k.injury).toBe(0);
    expect(k.workUid).not.toBeNull();
  });

  it("labor = population − injured, through the real tick", () => {
    const c = new Colony(11);
    const s = stateOf(c);
    s.colonists[0].injury = INJURY_RECOVERY;
    s.colonists[1].injury = INJURY_RECOVERY;
    c.tick(0.2);
    const snap = c.snapshot();
    expect(snap.labor).toBe(snap.population - 2);
    expect(snap.colonists.filter((v) => v.injury > 0).length).toBe(2); // view carries it
  });
});

describe("triage movement", () => {
  /** a colony with a treatable medbay at (10,9) — access cell (10,10) — and the
   *  first colonist hurt and standing one cell south of its door */
  function hurtWalker() {
    const c = new Colony(123);
    const s = stateOf(c);
    expect(c.place("medbay", 10, 9)).toBe(true);
    const mb = s.buildings.find((b) => b.defId === "medbay")!;
    mb.online = true; // no tick has run — make it treatable by hand
    const k = s.colonists[0];
    k.injury = INJURY_RECOVERY;
    k.x = 10; k.y = 11.5;
    return { c, s, k };
  }

  it("walks to the medbay access cell at INJURED_SPEED, then recovers there", () => {
    const { s, k } = hurtWalker();
    const x0 = k.x, y0 = k.y;
    stepColonists(s, 0.2);
    expect(k.state).toBe("toMedbay");
    expect(Math.hypot(k.x - x0, k.y - y0)).toBeCloseTo(INJURED_SPEED * 0.2, 6);

    for (let i = 0; i < 60; i++) stepColonists(s, 0.2);
    expect(Math.hypot(k.x - 10, k.y - 10)).toBeLessThanOrEqual(ARRIVE_EPS);
    expect(k.state).toBe("recovering");
  });

  it("an active hazard overrides triage — the wounded shelter too", () => {
    const { s, k } = hurtWalker();
    s.hazards.push({ kind: "meteor", phase: "active", tLeft: 9, activeDur: 9, intensity: 1, cadence: 1 });
    stepColonists(s, 0.2);
    expect(k.state).toBe("sheltering");
  });

  it("with no treatable medbay the wounded head home instead, still as toMedbay", () => {
    const { s, k } = hurtWalker();
    s.buildings = s.buildings.filter((b) => b.defId !== "medbay");
    stepColonists(s, 0.2);
    expect(k.state).toBe("toMedbay"); // walking, at the injured pace, to a hab
    expect(Math.hypot(k.x - 10, k.y - 11.5)).toBeGreaterThan(0);
  });

  it("a possessed injured colonist pilots at PILOT_SPEED × INJURED_PILOT_FACTOR", () => {
    const c = new Colony(5);
    const s = stateOf(c);
    const k = s.colonists[0];
    k.x = 12; k.y = 12;
    c.possess(k.id);
    c.setMoveIntent(1, 0);
    k.injury = INJURY_RECOVERY;
    stepColonists(s, 0.2);
    expect(k.x - 12).toBeCloseTo(PILOT_SPEED * INJURED_PILOT_FACTOR * 0.2, 6);
    expect(k.state).toBe("piloted");
  });
});

describe("strikes wound through the real tick (director-driven meteor)", () => {
  it("a full-intensity meteor over a packed colony injures colonists", () => {
    const c = new Colony(20260610);
    const s = stateOf(c);
    c.setDirector(true); // the scheduler stands down; we are the director
    s.population = 49;   // enough bodies to blanket the 15×15 map
    c.triggerHazard("meteor", 1);

    const events: ColonyEvent[] = [];
    for (let i = 0; i < 150; i++) { // 30s: telegraph + the active window
      // pin colonists on a 2-cell lattice so every cell is within INJURY_RADIUS
      for (let k = 0; k < s.colonists.length; k++) {
        s.colonists[k].x = (k % 7) * 2 + 1;
        s.colonists[k].y = Math.floor(k / 7) * 2 + 1;
      }
      c.tick(0.2);
      events.push(...c.drainEvents());
    }

    expect(events.filter((e) => e.type === "strike").length).toBeGreaterThan(0);
    expect(events.some((e) => e.type === "colonist_injured" && e.id != null)).toBe(true);
    expect(c.snapshot().colonists.some((v) => v.injury > 0)).toBe(true);
  });
});

describe("persistence + determinism", () => {
  it("save → load resumes mid-injury bit-identically", () => {
    const c = new Colony(777);
    const s = stateOf(c);
    s.colonists[0].injury = 17.3;
    s.colonists[2].injury = 4.2;
    run(c, 2);

    const d = Colony.load(c.serialize()); // injury must round-trip
    run(c, 12);
    run(d, 12);
    expect(d.snapshot()).toEqual(c.snapshot());
    expect(stateOf(c).colonists[0].injury).toBeGreaterThan(0); // still mid-recovery
  });

  it("a save whose colonists predate injuries loads them healthy (still version 1)", () => {
    const c = new Colony(777);
    run(c, 5);
    const save = c.serialize();
    expect(save.version).toBe(1);
    for (const k of save.state.colonists) delete (k as Partial<ColonistInstance>).injury;
    const d = Colony.load(save);
    expect(stateOf(d).colonists.every((k) => k.injury === 0)).toBe(true);
  });

  it("two same-seed colonies with injuries stay byte-identical over 600s", () => {
    const mk = (): Colony => {
      const c = new Colony(20260610);
      const s = stateOf(c);
      s.colonists[0].injury = INJURY_RECOVERY;
      s.colonists[3].injury = 6;
      c.triggerHazard("meteor", 1);
      return c;
    };
    const a = mk();
    const b = mk();
    run(a, 600);
    run(b, 600);
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});
