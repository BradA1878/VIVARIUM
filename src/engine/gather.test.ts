/* ============================================================================
   Auto-gather tests — idle colonists work the deposit field. The gather brain
   (engine/gather.ts) walks a free colonist to a claimed deposit, dwells, picks
   a load, hauls it to the depot, and banks it — all deterministic, zero RNG
   draws, so the same-seed/save-load guarantees hold. Staffed workers, the
   possessed colonist, and hazard/injury overrides are untouched by design.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "./index";
import type { ColonyEvent } from "@shared/types";
import type { ColonistInstance, ColonyState } from "./state";
import { AUTO_CARRY, DAY_START, DAY_END } from "./tuning";

/** reach the engine's private state (the suite's seam for injecting/inspecting) */
const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

/** advance a colony, collecting events */
function run(c: Colony, seconds: number, step = 0.2): ColonyEvent[] {
  const events: ColonyEvent[] = [];
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) { c.tick(step); events.push(...c.drainEvents()); }
  return events;
}

const GATHER_STATES = ["gathering", "mining", "hauling"] as const;

/** a colony with a controlled surface: the seeded scatter cleared (tests inject
 *  their own nodes) and every scheduled visitor pushed past the horizon so the
 *  materials ledger has exactly one writer — the gatherers under test */
function controlled(seed: number): { c: Colony; s: ColonyState } {
  const c = new Colony(seed);
  const s = stateOf(c);
  s.deposits = [];          // a clean field; tests place their own nodes
  s.depositRespawn = 1e9;   // no fresh nodes surfacing mid-test
  s.nextTrade = 1e9;        // traders barter materials — keep the ledger clean
  s.nextUfo = 1e9;
  s.nextHazard = 1e9;       // the hazard override has its own test
  s.nextArrival = 1e9;      // keep the roster fixed
  s.nextBirth = 1e9;
  return { c, s };
}

/** the colonists with no job slot this tick (the gather pool) */
function freeColonists(s: ColonyState): ColonistInstance[] {
  return s.colonists.filter((k) => k.workUid == null && k.id !== s.possessed && k.injury <= 0);
}

describe("idle colonists work the deposit field", () => {
  it("an unstaffed colonist completes deterministic trips crediting the exact pool", () => {
    const { c, s } = controlled(11);
    // an ore node near the depot (6,5): two trips at AUTO_CARRY=12 → 12 + 6
    s.deposits = [{ id: 501, gx: 9, gy: 5, kind: "ore", amount: 18, max: 140 }];
    const before = c.snapshot().materials.amount;

    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) { // up to 120 s — trips finish well within the day
      c.tick(0.2); c.drainEvents();
      for (const k of freeColonists(s)) seen.add(k.state);
      if (s.deposits.length === 0 && s.colonists.every((k) => k.carryAmt === 0)) break;
    }

    // the node is mined out and every unit of it landed in materials (ore yield)
    expect(s.deposits.length).toBe(0);
    expect(s.colonists.every((k) => k.carryAmt === 0)).toBe(true);
    expect(c.snapshot().materials.amount).toBeCloseTo(before + 18, 5);
    // the free colonists actually walked the loop: gathering → mining → hauling
    for (const st of GATHER_STATES) expect(seen.has(st)).toBe(true);
  });

  it("a staffed colonist never enters gather states during work hours", () => {
    const { c, s } = controlled(7);
    s.deposits = [{ id: 501, gx: 9, gy: 5, kind: "ore", amount: 140, max: 140 }];

    let staffedTicks = 0;
    for (let i = 0; i < 250; i++) { // 50 s, entirely inside the day window
      c.tick(0.2); c.drainEvents();
      if (!(s.tod > DAY_START && s.tod < DAY_END)) continue;
      for (const k of s.colonists) {
        if (k.workUid == null || k.id === s.possessed) continue;
        staffedTicks++;
        expect(GATHER_STATES).not.toContain(k.state);
      }
    }
    expect(staffedTicks).toBeGreaterThan(0); // the assertion actually ran
  });

  it("night sends empty-handed gatherers home, but a dusk carrier banks its load first", () => {
    const { c, s } = controlled(13);
    // a far node so nobody completes a fresh pickup in the last sliver of daylight
    s.deposits = [{ id: 501, gx: 13, gy: 13, kind: "ore", amount: 140, max: 140 }];
    s.tod = 0.795; // ~0.75 s of day left
    c.tick(0.2); c.drainEvents(); // settle assignments

    const free = freeColonists(s);
    expect(free.length).toBeGreaterThanOrEqual(2);
    const carrier = free[0], walker = free[1];
    carrier.carryKind = "ore";
    carrier.carryAmt = AUTO_CARRY; // a full load, caught out in the field at dusk
    carrier.x = 11; carrier.y = 11;
    const before = c.snapshot().materials.amount;

    const walkerStates = new Set<string>();
    for (let i = 0; i < 200; i++) { // 40 s, all of it night
      c.tick(0.2); c.drainEvents();
      if (s.tod > DAY_END || s.tod < DAY_START) walkerStates.add(walker.state);
    }

    // the carrier finished its depot run: the load landed in materials, then home
    expect(c.snapshot().materials.amount).toBeCloseTo(before + AUTO_CARRY, 5);
    expect(carrier.carryAmt).toBe(0);
    expect(["toHome", "idle"]).toContain(carrier.state);
    // the empty-handed gatherer never gathered at night — it went home
    for (const st of GATHER_STATES) expect(walkerStates.has(st)).toBe(false);
    expect(walkerStates.has("toHome") || walkerStates.has("idle")).toBe(true);
  });

  it("an active hazard overrides gathering to sheltering mid-trip", () => {
    const { c, s } = controlled(17);
    s.deposits = [{ id: 501, gx: 12, gy: 12, kind: "ice", amount: 140, max: 140 }];

    // let a free colonist get well into a trip
    let mover: ColonistInstance | null = null;
    for (let i = 0; i < 150 && !mover; i++) {
      c.tick(0.2); c.drainEvents();
      mover = s.colonists.find((k) => (GATHER_STATES as readonly string[]).includes(k.state)) ?? null;
    }
    expect(mover).not.toBeNull();
    expect(mover!.gatherDepositId).not.toBeNull(); // it holds a claim mid-trip

    s.hazards.push({ kind: "dust", phase: "active", tLeft: 30, activeDur: 30, intensity: 0.6, cadence: 0 });
    c.tick(0.2); c.drainEvents();
    expect(mover!.state).toBe("sheltering");
    expect(mover!.gatherDepositId).toBeNull(); // the claim is released while sheltering
  });

  it("two idle colonists claim distinct deposits and stick to them (no thrash)", () => {
    const { c, s } = controlled(23);
    s.deposits = [
      { id: 501, gx: 11, gy: 4, kind: "ore", amount: 140, max: 140 },
      { id: 502, gx: 11, gy: 7, kind: "ore", amount: 140, max: 140 },
    ];
    c.tick(0.2); c.drainEvents(); // settle assignments
    const free = freeColonists(s);
    expect(free.length).toBeGreaterThanOrEqual(2);
    const [a, b] = free;

    run(c, 2); // a couple of seconds — both should have claims by now
    expect(a.gatherDepositId).not.toBeNull();
    expect(b.gatherDepositId).not.toBeNull();
    expect(a.gatherDepositId).not.toBe(b.gatherDepositId);

    // sticky: the pairing never flips while both nodes live
    const claimA = a.gatherDepositId, claimB = b.gatherDepositId;
    for (let i = 0; i < 50; i++) { // 10 s of trips
      c.tick(0.2); c.drainEvents();
      expect(s.deposits.length).toBe(2); // 140-unit nodes survive a few trips
      expect(a.gatherDepositId).toBe(claimA);
      expect(b.gatherDepositId).toBe(claimB);
    }
  });
});

describe("auto-gather preserves the engine guarantees", () => {
  it("two same-seed colonies stay in lockstep for 300 s", () => {
    const a = new Colony(31415);
    const b = new Colony(31415);
    const evA = run(a, 300);
    const evB = run(b, 300);
    expect(evB).toEqual(evA);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(stateOf(b).colonists).toEqual(stateOf(a).colonists);
  });

  it("save → load mid-trip resumes bit-identically", () => {
    const { c, s } = controlled(41);
    s.deposits = [{ id: 501, gx: 10, gy: 9, kind: "cache", amount: 140, max: 140 }];

    // run until someone is mid-dwell at the node — the most fragile moment to resume
    let midDwell = false;
    for (let i = 0; i < 300 && !midDwell; i++) {
      c.tick(0.2); c.drainEvents();
      midDwell = s.colonists.some((k) => k.state === "mining" && k.gatherT > 0);
    }
    expect(midDwell).toBe(true);

    const d = Colony.load(c.serialize());
    run(c, 60);
    run(d, 60);
    expect(d.snapshot()).toEqual(c.snapshot());
    expect(stateOf(d).colonists).toEqual(stateOf(c).colonists); // incl. gather fields
  });

  it("a legacy save without the gather fields loads with defaults and runs deterministically", () => {
    const c = new Colony(53);
    run(c, 30);
    const save = c.serialize();
    expect(save.version).toBe(1); // no version bump for the new fields
    for (const k of save.state.colonists) {
      delete (k as Partial<ColonistInstance>).gatherDepositId;
      delete (k as Partial<ColonistInstance>).gatherT;
    }

    const d = Colony.load(save);
    for (const k of stateOf(d).colonists) {
      expect(k.gatherDepositId).toBeNull();
      expect(k.gatherT).toBe(0);
    }
    const e = Colony.load(save);
    run(d, 60);
    run(e, 60);
    expect(e.snapshot()).toEqual(d.snapshot());
    expect(stateOf(e).colonists).toEqual(stateOf(d).colonists);
  });
});
