/* ============================================================================
   The Fabricator — rung 4 of the automation ladder: a building that builds a
   copy of a target building, and its own def targets ITSELF. Mirrors the
   Rover/Robotics Bay countdown idioms exactly — pause-never-reset, the fee
   drawn at COMPLETION, hold-at-zero — except the countdown lives PER INSTANCE
   (BuildingState.replicateT), which is what turns one linear line into an
   exponential lineage: every copy immediately runs its own clock. The fee is
   the TARGET def's own matCost (one number, so canPlace's affordability check
   agrees by construction). Growth self-limits on things that already exist:
   the finite grid, brownout shedding (priority 10 — shed FIRST), and the
   FAB_MAX_LINEAGE hard cap. Zero RNG anywhere: placement is a fixed N/E/S/W
   first-fit off the parent's footprint.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { BuildingState, ColonyEvent } from "@shared/types";
import { Colony, DEFS, ORDER } from "./index";
import { emptyBuilding } from "./state";
import type { ColonyState } from "./state";
import { idx } from "./grid";
import { FAB_BUILD_S, FAB_MAT_COST, FAB_MAX_LINEAGE } from "./tuning";

/** reach the engine's private state — rare/positional setups are injected, not
 *  awaited (an unattended colony is designed to die) */
const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

/** advance a colony by `seconds` in fixed steps, collecting events */
function run(c: Colony, seconds: number, step = 0.2): ColonyEvent[] {
  const events: ColonyEvent[] = [];
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) { c.tick(step); events.push(...c.drainEvents()); }
  return events;
}

/** advance with life support pinned — countdown runs longer than the founding
 *  battery, and an unattended colony is designed to die (the robots cap-test
 *  idiom). Materials are deliberately NOT pinned: they're the subject. */
function runPinned(c: Colony, seconds: number, step = 0.2): ColonyEvent[] {
  const s = stateOf(c);
  const events: ColonyEvent[] = [];
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    s.pools.power.amount = 100;
    s.pools.oxygen.amount = 30;
    s.pools.water.amount = 40;
    s.pools.food.amount = 40;
    c.tick(step);
    events.push(...c.drainEvents());
  }
  return events;
}

/** a colony with a controlled surface: the seeded scatter cleared (tests inject
 *  their own nodes) and every scheduled visitor pushed past the horizon so the
 *  materials ledger has exactly one writer — the lineage under test */
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

/** place a Fabricator on the first cell whose four neighbors are ALSO clear
 *  (so the N/E/S/W first-fit is predictable) and clear the build chatter.
 *  The gate is unlocks.test.ts's subject — open it here. */
function placeFab(c: Colony): { gx: number; gy: number } {
  const s = stateOf(c);
  if (!s.unlocked.includes("fabricator")) s.unlocked.push("fabricator");
  for (let gy = 4; gy <= 20; gy++) {
    for (let gx = 4; gx <= 20; gx++) {
      const yard: [number, number][] = [[gx, gy], [gx, gy - 1], [gx + 1, gy], [gx, gy + 1], [gx - 1, gy]];
      if (!yard.every(([x, y]) => s.grid[idx(s.N, x, y)] === 0)) continue;
      if (c.place("fabricator", gx, gy)) { c.drainEvents(); return { gx, gy }; }
    }
  }
  throw new Error("nowhere to seat the Fabricator");
}

/** push a fabricator straight onto the state (the rare-state injection idiom) */
function injectFab(s: ColonyState, gx: number, gy: number): BuildingState {
  const b = emptyBuilding(s.uidCounter++, "fabricator", gx, gy);
  s.buildings.push(b);
  s.grid[idx(s.N, gx, gy)] = b.uid;
  return b;
}

/** grow the lineage to `total` by injecting into free cells, scan order */
function injectLineage(s: ColonyState, total: number): void {
  let n = s.buildings.filter((b) => b.defId === "fabricator").length;
  for (let gy = 0; gy < s.N && n < total; gy++) {
    for (let gx = 0; gx < s.N && n < total; gx++) {
      if (s.grid[idx(s.N, gx, gy)] === 0) { injectFab(s, gx, gy); n++; }
    }
  }
}

const fabsOf = (s: ColonyState): BuildingState[] =>
  s.buildings.filter((b) => b.defId === "fabricator");

// ---- the def + palette order --------------------------------------------------

describe("the Fabricator def", () => {
  it("slots between roboticsbay and ptp, preserving the earlier ORDER pins", () => {
    expect(ORDER[ORDER.indexOf("roboticsbay") + 1]).toBe("fabricator");
    expect(ORDER[ORDER.indexOf("roverbay") + 1]).toBe("roboticsbay");
    expect(ORDER[ORDER.length - 1]).toBe("ptp"); // the endgame tile stays last
  });

  it("is an unstaffed, unpressurized 1×1 self-replicator with the agreed knobs", () => {
    const d = DEFS.fabricator;
    expect(d.foot).toEqual([1, 1]);
    expect(d.matCost).toBe(FAB_MAT_COST);
    expect(d.consumes.power).toBe(1.5);
    expect(d.staffing).toBe(0);
    expect(d.requiresPressure).toBe(false); // load-bearing: a sealed child would spawn unconnected and never tick
    expect(d.priority).toBeLessThan(DEFS.printer.priority); // shed FIRST in a brownout
    expect(d.replicates).toEqual({ targetDefId: "fabricator", buildS: FAB_BUILD_S });
  });
});

// ---- the countdown: gates, holds, independence ----------------------------------

describe("the countdown — online + functional, pause never resets", () => {
  it("holds while faulted or unpowered, resumes from where it stopped", () => {
    const { c, s } = controlled(7);
    placeFab(c);
    const fab = fabsOf(s)[0];

    run(c, 10);
    expect(fab.replicateT).toBeCloseTo(FAB_BUILD_S - 10, 4);

    // a flare-style electronics fault → not functional → holds where it stopped
    fab.faulted = 1e9;
    run(c, 8);
    expect(fab.replicateT).toBeCloseTo(FAB_BUILD_S - 10, 4);
    fab.faulted = 0;

    // power starvation at night → offline → holds
    s.tod = 0.9;
    s.pools.power.amount = 0;
    run(c, 8);
    expect(fab.replicateT).toBeCloseTo(FAB_BUILD_S - 10, 4);

    // the line comes back → the countdown RESUMES, never resets
    s.tod = 0.4;
    s.pools.power.amount = 100;
    run(c, 2);
    expect(fab.replicateT).toBeCloseTo(FAB_BUILD_S - 12, 4);
  });

  it("each instance runs its OWN clock — a later sibling lags by its head start", () => {
    const { c, s } = controlled(7);
    placeFab(c);
    runPinned(c, 20);
    s.materials.amount = 100;
    placeFab(c); // a second, 20 s behind
    runPinned(c, 10);
    const [a, b] = fabsOf(s);
    expect(a.replicateT).toBeCloseTo(FAB_BUILD_S - 30, 4);
    expect(b.replicateT).toBeCloseTo(FAB_BUILD_S - 10, 4);
  });

  it("a brownout sheds the fabricator before the printer", () => {
    const { c, s } = controlled(89);
    s.unlocked.push("printer");
    expect(c.place("printer", 0, 0)).toBe(true);
    placeFab(c);
    s.tod = 0.9; // night — no generation refills the pool
    // cover every draw this tick EXCEPT the fabricator's
    const othersPerSec = s.buildings
      .filter((b) => b.defId !== "fabricator")
      .reduce((n, b) => n + (DEFS[b.defId].consumes.power ?? 0), 0);
    s.pools.power.amount = othersPerSec * 0.2 + 0.01;
    c.tick(0.2); c.drainEvents();
    const fab = fabsOf(s)[0];
    const printer = s.buildings.find((b) => b.defId === "printer")!;
    expect(fab.online).toBe(false); // shed first
    expect(printer.online).toBe(true); // the old floor now holds power
    expect(fab.replicateT).toBeUndefined(); // never even armed this tick
  });
});

// ---- completion: the fee, the spawn, the event ------------------------------------

describe("completion — a copy on adjacent ground, the fee drawn at the finish", () => {
  it("spawns N-first into the yard at exactly FAB_BUILD_S, debiting the target's matCost", () => {
    const { c, s } = controlled(7);
    const at = placeFab(c);
    s.materials.amount = 100;

    const before = runPinned(c, FAB_BUILD_S - 0.4);
    expect(before.some((e) => e.type === "fabricator_ready")).toBe(false);
    expect(fabsOf(s).length).toBe(1);
    expect(s.materials.amount).toBe(100); // nothing drawn at start or mid-cycle

    const evs = runPinned(c, 0.4);
    const ready = evs.find((e) => e.type === "fabricator_ready");
    expect(ready).toBeDefined();
    expect(ready!.t).toBeCloseTo(FAB_BUILD_S, 4);
    expect(ready!.defId).toBe("fabricator");
    expect(ready!.gx).toBe(at.gx); // N of the parent, first-fit
    expect(ready!.gy).toBe(at.gy - 1);
    expect(ready!.n).toBe(2); // the lineage after the spawn
    expect(s.materials.amount).toBeCloseTo(100 - FAB_MAT_COST, 6); // exactly the fee

    const lineage = fabsOf(s);
    expect(lineage.length).toBe(2);
    const child = lineage[1];
    expect(child.gx).toBe(at.gx);
    expect(child.gy).toBe(at.gy - 1);
    expect(s.grid[idx(s.N, child.gx, child.gy)]).toBe(child.uid); // grid stamped
    expect(lineage[0].replicateT).toBe(FAB_BUILD_S); // the parent re-arms
  });

  it("the child starts its own countdown — 1 → 2 → 4 within three cycles", () => {
    const { c, s } = controlled(7);
    placeFab(c);
    s.materials.amount = 400;
    runPinned(c, FAB_BUILD_S * 2 + 1);
    // parent spawned at 70 and 140; the first child spawned at ~140 too
    expect(fabsOf(s).length).toBe(4);
  });
});

// ---- the stall: hold at zero, ONE event per episode ---------------------------------

describe("stalls — hold at zero, narrated once per episode", () => {
  it("an unaffordable cycle holds, emits ONE 'materials short', then ships when funded", () => {
    const { c, s } = controlled(7);
    const at = placeFab(c);
    s.materials.amount = 0;

    const starved = runPinned(c, FAB_BUILD_S + 6);
    const stalls = starved.filter((e) => e.type === "fabricator_stalled");
    expect(stalls.length).toBe(1); // the crossing tick only, not every held tick
    expect(stalls[0].detail).toBe("materials short");
    expect(stalls[0].gx).toBe(at.gx);
    expect(stalls[0].gy).toBe(at.gy);
    expect(fabsOf(s)[0].replicateT).toBe(0); // a finished copy, waiting on the fee
    expect(fabsOf(s).length).toBe(1);

    // another minute of famine — still just the one line
    const more = runPinned(c, 60);
    expect(more.some((e) => e.type === "fabricator_stalled")).toBe(false);

    s.materials.amount = 30;
    const now = runPinned(c, 0.2); // one tick — the stock covers the fee
    expect(now.some((e) => e.type === "fabricator_ready")).toBe(true);
    expect(fabsOf(s).length).toBe(2);
    expect(s.materials.amount).toBeCloseTo(30 - FAB_MAT_COST, 6);
    expect(fabsOf(s)[0].replicateT).toBe(FAB_BUILD_S); // re-armed
  });

  it("boxed in → ONE 'no clear ground'; a demolition frees it; the next box narrates again", () => {
    const { c, s } = controlled(7);
    const at = placeFab(c);
    // wall the yard with batteries (founding tier, 1×1)
    s.materials.amount = 200;
    expect(c.place("battery", at.gx, at.gy - 1)).toBe(true);
    expect(c.place("battery", at.gx + 1, at.gy)).toBe(true);
    expect(c.place("battery", at.gx, at.gy + 1)).toBe(true);
    expect(c.place("battery", at.gx - 1, at.gy)).toBe(true);
    c.drainEvents();
    s.materials.amount = 100; // affordable — the ground is the problem

    const boxed = runPinned(c, FAB_BUILD_S + 6);
    const stalls = boxed.filter((e) => e.type === "fabricator_stalled");
    expect(stalls.length).toBe(1);
    expect(stalls[0].detail).toBe("no clear ground");

    // demolish the north wall → the held copy lands there on the next tick
    c.removeAt(at.gx, at.gy - 1);
    const freed = runPinned(c, 0.4);
    expect(freed.some((e) => e.type === "fabricator_ready")).toBe(true);
    const child = fabsOf(s)[1];
    expect(child.gx).toBe(at.gx);
    expect(child.gy).toBe(at.gy - 1);

    // the parent is boxed again (child N, batteries E/S/W) — the NEXT completed
    // cycle narrates a fresh episode: the successful spawn re-armed the edge
    const reboxed = runPinned(c, FAB_BUILD_S + 2);
    const again = reboxed.filter(
      (e) => e.type === "fabricator_stalled" && e.gx === at.gx && e.gy === at.gy,
    );
    expect(again.length).toBe(1);
    expect(again[0].detail).toBe("no clear ground");
  });

  it("unaffordable AND boxed reads as 'materials short' — the fee is checked first", () => {
    const { c, s } = controlled(7);
    const at = placeFab(c);
    s.materials.amount = 200;
    for (const [x, y] of [[at.gx, at.gy - 1], [at.gx + 1, at.gy], [at.gx, at.gy + 1], [at.gx - 1, at.gy]]) {
      expect(c.place("battery", x, y)).toBe(true);
    }
    c.drainEvents();
    s.materials.amount = 0;
    const evs = runPinned(c, FAB_BUILD_S + 2);
    const stall = evs.find((e) => e.type === "fabricator_stalled");
    expect(stall).toBeDefined();
    expect(stall!.detail).toBe("materials short");
  });
});

// ---- the cap: a hard colony-wide valve ------------------------------------------------

describe("FAB_MAX_LINEAGE — the safety valve", () => {
  it("countdowns freeze at the cap and thaw after a demolition", () => {
    const { c, s } = controlled(7);
    placeFab(c);
    injectLineage(s, FAB_MAX_LINEAGE);
    expect(fabsOf(s).length).toBe(FAB_MAX_LINEAGE);
    const first = fabsOf(s)[0];
    first.replicateT = 5;
    s.materials.amount = 400;

    const evs = runPinned(c, 3);
    expect(first.replicateT).toBe(5); // frozen pre-decrement, the robot idiom
    expect(evs.some((e) => e.type === "fabricator_ready")).toBe(false);
    expect(evs.some((e) => e.type === "fabricator_stalled")).toBe(false); // silent — the HUD carries it

    const victim = fabsOf(s).at(-1)!;
    c.removeAt(victim.gx, victim.gy);
    runPinned(c, 2);
    expect(first.replicateT).toBeCloseTo(3, 4); // thawed: 5 − 2
  });

  it("two same-tick completions at cap−1 spawn exactly one — never past the cap", () => {
    const { c, s } = controlled(7);
    placeFab(c);
    injectLineage(s, FAB_MAX_LINEAGE - 1);
    s.materials.amount = 400;
    const fabs = fabsOf(s);
    const racers = fabs.slice(-2); // injected into dense rows — each still has a free side
    racers[0].replicateT = 0.2;
    racers[1].replicateT = 0.2;

    const evs = runPinned(c, 0.2); // both cross zero on the SAME tick
    expect(fabsOf(s).length).toBe(FAB_MAX_LINEAGE); // exactly one spawned
    expect(evs.filter((e) => e.type === "fabricator_ready").length).toBe(1);
    expect(evs.some((e) => e.type === "fabricator_stalled")).toBe(false); // the loser holds silently
    expect(racers.some((r) => r.replicateT === 0)).toBe(true); // …at zero, ready for head-room
  });
});

// ---- determinism + persistence ----------------------------------------------------------

describe("determinism + persistence", () => {
  it("two same-seed colonies grow byte-identical lineages", () => {
    const script = (seed: number): Colony => {
      const c = new Colony(seed);
      placeFab(c);
      stateOf(c).materials.amount = 300; // bankroll the lineage identically on both
      return c;
    };
    const a = script(31337);
    const b = script(31337);
    const evA = run(a, 400);
    const evB = run(b, 400);
    expect(evB).toEqual(evA);
    expect(b.snapshot()).toEqual(a.snapshot());
    expect(fabsOf(stateOf(a)).length).toBeGreaterThan(1); // the lineage actually grew
  });

  it("save → load mid-countdown resumes bit-identically", () => {
    const { c } = controlled(41);
    placeFab(c);
    stateOf(c).materials.amount = 200;
    runPinned(c, 35); // mid-cycle — the most fragile moment to resume

    const d = Colony.load(c.serialize());
    runPinned(c, 60);
    runPinned(d, 60);
    expect(d.snapshot()).toEqual(c.snapshot());
    expect(fabsOf(stateOf(d))).toEqual(fabsOf(stateOf(c)));
  });

  it("a save mid-STALL reloads without re-narrating the episode", () => {
    const { c, s } = controlled(41);
    placeFab(c);
    s.materials.amount = 0;
    const first = runPinned(c, FAB_BUILD_S + 4);
    expect(first.filter((e) => e.type === "fabricator_stalled").length).toBe(1);

    const d = Colony.load(c.serialize());
    const after = runPinned(d, 10);
    expect(after.some((e) => e.type === "fabricator_stalled")).toBe(false); // already narrated
    expect(fabsOf(stateOf(d))[0].replicateT).toBe(0); // still holding for the fee
  });

  it("a legacy save (no replicateT) loads with the countdown unarmed, then runs deterministically", () => {
    const { c } = controlled(777);
    placeFab(c);
    runPinned(c, 30);
    const save = c.serialize();
    expect(save.version).toBe(1); // no version bump for the new field
    const savedFab = save.state.buildings.find((b) => b.defId === "fabricator")!;
    delete (savedFab as Partial<BuildingState> & { replicateT?: number }).replicateT;

    const d = Colony.load(save);
    const e = Colony.load(save);
    expect(fabsOf(stateOf(d))[0].replicateT).toBeUndefined(); // the graceful default
    runPinned(d, 60);
    runPinned(e, 60);
    expect(e.snapshot()).toEqual(d.snapshot());
    // it re-armed at buildS on its first ticking tick and has run 60 s since
    expect(fabsOf(stateOf(d))[0].replicateT).toBeCloseTo(FAB_BUILD_S - 60, 4);
  });
});
