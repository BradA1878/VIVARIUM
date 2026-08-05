/* ============================================================================
   Campaign tests — the launch-window arc resolves to victory or defeat (doc §2.5).
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony, DEFS, Tuning } from "./index";
import type { ColonyEvent, Difficulty } from "@shared/types";
import type { ColonyState } from "./state";

function runCollecting(c: Colony, seconds: number, step = 0.2): ColonyEvent[] {
  const evs: ColonyEvent[] = [];
  for (let i = 0; i < Math.round(seconds / step); i++) {
    c.tick(step);
    evs.push(...c.drainEvents());
  }
  return evs;
}

const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

/** Place an unpressurized building on the first legal surface cell. This is the
 *  same public command path a player uses; no state injection or free resources. */
function placeFirst(c: Colony, defId: string): boolean {
  const { N } = c.snapshot();
  for (let gy = 0; gy < N; gy++) for (let gx = 0; gx < N; gx++) {
    if (c.canPlace(defId, gx, gy) && c.place(defId, gx, gy)) return true;
  }
  return false;
}

function count(c: Colony, defId: string): number {
  return c.snapshot().buildings.filter((b) => b.defId === defId).length;
}

interface PolicyResult {
  snapshot: ReturnType<Colony["snapshot"]>;
  firstPop8: number;
  firstHazardEnd: number;
  ptpUnlockedAt: number;
}

/** A small deterministic legal player: establish the starter chains, add
 *  buffers/redundancy, repair the two critical corridor cells after quakes, and
 *  build a reactor once the latched gate opens. It never touches private state. */
function runLegalPolicy(difficulty: Difficulty): PolicyResult {
  const c = new Colony(2, difficulty);
  expect(c.place("greenhouse", 2, 4)).toBe(true); // directly pressure-connected
  expect(placeFirst(c, "extractor")).toBe(true);

  let firstPop8 = 0, firstHazardEnd = 0, ptpUnlockedAt = 0;
  const cap = c.snapshot().deadlineSol * Tuning.SOL_LENGTH;
  for (let elapsed = 0; elapsed < cap && c.snapshot().outcome === null; elapsed += 0.2) {
    const snap = c.snapshot();
    const mat = snap.materials.amount;
    const hasAt = (id: string, gx: number, gy: number): boolean =>
      snap.buildings.some((b) => b.defId === id && b.gx === gx && b.gy === gy);

    // Repair campaign-critical infrastructure before expanding.
    if (count(c, "hub") < 1) c.place("hub", 4, 4);
    else if (!hasAt("corridor", 4, 6) && mat >= 2) c.place("corridor", 4, 6);
    else if (!hasAt("corridor", 5, 6) && mat >= 2) c.place("corridor", 5, 6);
    else if (count(c, "electrolysis") < 1 && mat >= (DEFS.electrolysis.matCost ?? 0)) {
      c.place("electrolysis", 5, 7, 2);
    } else if (count(c, "greenhouse") < 1 && mat >= (DEFS.greenhouse.matCost ?? 0)) {
      c.place("greenhouse", 2, 4);
    } else if (count(c, "solar") < 4 && mat >= (DEFS.solar.matCost ?? 0)) {
      placeFirst(c, "solar");
    } else if (snap.housing < 12 && mat >= (DEFS.hab.matCost ?? 0)) {
      c.place("hab", 4, 3); // the hub's north-west edge, pressure-connected
    } else if (count(c, "extractor") < 3 && mat >= (DEFS.extractor.matCost ?? 0)) {
      placeFirst(c, "extractor");
    } else if (count(c, "battery") < 2 && mat >= (DEFS.battery.matCost ?? 0)) {
      placeFirst(c, "battery");
    } else if (count(c, "medbay") < 1 && mat >= (DEFS.medbay.matCost ?? 0)) {
      placeFirst(c, "medbay");
    } else if (snap.unlocks.reactor && count(c, "reactor") < 1 && mat >= (DEFS.reactor.matCost ?? 0)) {
      placeFirst(c, "reactor");
    }

    c.tick(0.2);
    for (const e of c.drainEvents()) {
      if (e.type === "hazard_end" && firstHazardEnd === 0) firstHazardEnd = e.t;
    }
    const after = c.snapshot();
    if (after.population >= 8 && firstPop8 === 0) {
      firstPop8 = after.t;
      expect(after.outcome).toBeNull(); // the old Sol-2 ending is gone
    }
    if (after.unlocks.ptp && ptpUnlockedAt === 0) ptpUnlockedAt = after.t;
  }
  return { snapshot: c.snapshot(), firstPop8, firstHazardEnd, ptpUnlockedAt };
}

describe("the campaign", () => {
  it("a fresh colony starts mid-campaign with no outcome", () => {
    const s = new Colony().snapshot();
    expect(s.outcome).toBeNull();
    expect(s.deadlineSol).toBe(Tuning.DEADLINE_SOL);
    expect(s.targetPop).toBe(Tuning.TARGET_POP);
    expect(s.settlementSustainableFor).toBe(0);
    expect(s.settlementEstablished).toBe(false);
    expect(s.hazardsSurvived).toBe(0);
  });

  it("the self-sufficiency clock only runs while the colony is balanced", () => {
    const c = new Colony(1);
    // the seed colony isn't self-sufficient (too few crew), so the clock must
    // stay pinned at zero — no accidental drift toward a false victory.
    for (let i = 0; i < 200 / 0.2; i++) { c.tick(0.2); c.drainEvents(); }
    const s = c.snapshot();
    expect(s.selfSufficientFor).toBe(0);
    expect(s.outcome).not.toBe("victory");
  });

  it("population-8 self-sufficiency is a visible one-shot milestone, not an ending", () => {
    const c = new Colony(2);
    expect(c.place("greenhouse", 2, 4)).toBe(true);
    expect(placeFirst(c, "extractor")).toBe(true);
    const s = stateOf(c);
    s.population = 8;
    s.housing = 8;
    s.nextArrival = 1e9;
    s.nextHazard = 1e9;
    s.nextTrade = 1e9;
    s.nextUfo = 1e9;
    s.settlementSustainableFor = Tuning.SETTLEMENT_SUSTAIN_GOAL - 0.2;
    s.tod = 0.4;
    s.pools.power.amount = s.pools.power.capacity;
    s.pools.water.amount = s.pools.water.capacity;
    s.pools.oxygen.amount = s.pools.oxygen.capacity;
    s.pools.food.amount = s.pools.food.capacity;

    c.tick(0.2);
    const first = c.drainEvents();
    expect(s.settlementEstablished).toBe(true);
    expect(c.snapshot().settlementEstablished).toBe(true);
    expect(c.snapshot().settlementSustainableFor).toBe(Tuning.SETTLEMENT_SUSTAIN_GOAL);
    expect(c.snapshot().outcome).toBeNull();
    expect(c.snapshot().paused).toBe(false);
    expect(first.filter((e) => e.type === "unlock" && e.defId === "settlement")).toHaveLength(1);

    const later = runCollecting(c, 5);
    expect(later.filter((e) => e.type === "unlock" && e.defId === "settlement")).toHaveLength(0);
    expect(c.snapshot().outcome).toBeNull();
  });

  it("an arrival needs a sustained post-arrival margin, not one lucky tick", () => {
    const c = new Colony(2);
    expect(c.place("greenhouse", 2, 4)).toBe(true);
    expect(placeFirst(c, "extractor")).toBe(true);
    const s = stateOf(c);
    s.nextArrival = 0;
    s.nextHazard = 1e9;
    s.nextTrade = 1e9;
    s.nextUfo = 1e9;
    s.tod = 0.4;
    for (const p of Object.values(s.pools)) p.amount = p.capacity;

    c.tick(0.2);
    c.drainEvents();
    expect(c.snapshot().population).toBe(4); // positive once is not admission evidence
    expect(s.arrivalReadyFor).toBeGreaterThan(0);

    // Keep the scheduled craft out of the way while the readiness proof accrues,
    // then make it due: the same healthy colony may now safely accept four.
    s.nextArrival = 1e9;
    runCollecting(c, Tuning.ARRIVAL_READY_GOAL);
    expect(s.arrivalReadyFor).toBeGreaterThanOrEqual(Tuning.ARRIVAL_READY_GOAL);
    s.nextArrival = 0;
    c.tick(0.2);
    expect(c.snapshot().population).toBe(8);
    expect(c.drainEvents().some((e) => e.type === "arrival")).toBe(true);
  });

  it("a legal deterministic policy reaches the hazard-proven full-sol victory on every difficulty", () => {
    const finish: Record<Difficulty, number> = { easy: 0, normal: 0, hard: 0 };
    for (const difficulty of ["easy", "normal", "hard"] as const) {
      const a = runLegalPolicy(difficulty);
      const b = runLegalPolicy(difficulty);
      expect(a).toEqual(b); // policy + engine remain exactly deterministic
      expect(a.snapshot.outcome).toBe("victory");
      expect(a.snapshot.paused).toBe(true);
      expect(a.snapshot.population).toBeGreaterThanOrEqual(Tuning.TARGET_POP);
      expect(a.snapshot.selfSufficientFor).toBe(Tuning.SELF_SUFFICIENCY_GOAL);
      expect(a.snapshot.hazardsSurvived).toBeGreaterThan(0);
      expect(a.firstPop8).toBeGreaterThan(0);
      expect(a.firstHazardEnd).toBeGreaterThan(a.firstPop8);
      expect(a.ptpUnlockedAt).toBeGreaterThan(0);
      expect(a.ptpUnlockedAt).toBeLessThan(a.snapshot.t); // expansion was a real branch before victory
      // Regression guard: no more automatic Sol-2 win before environment/advanced play.
      expect(a.snapshot.t).toBeGreaterThan(Tuning.SOL_LENGTH * 2);
      finish[difficulty] = a.snapshot.t;
    }

    // Difficulty must not invert because gentler modes see hazards less often.
    // The first campaign trial is shared; easier reserves/intensity should let
    // an identical legal policy prove itself no later than the harder profile.
    expect(finish.easy).toBeLessThanOrEqual(finish.normal);
    expect(finish.normal).toBeLessThanOrEqual(finish.hard);
  }, 15_000);

  it("losing the whole colony is a defeat", () => {
    const c = new Colony(9);
    c.removeAt(5, 7); // electrolysis — no oxygen production
    // run long enough for repeated suffocation to wipe the colony
    const evs = runCollecting(c, 600);
    const s = c.snapshot();
    if (s.population <= 0) {
      expect(s.outcome).toBe("defeat");
      expect(s.outcomeReason).toBe("colony");
      expect(evs.some((e) => e.type === "defeat")).toBe(true);
      expect(s.paused).toBe(true); // the engine halts on an outcome
    } else {
      // colony clung on — at least confirm no false victory was declared
      expect(s.outcome).not.toBe("victory");
    }
  });

  it("reaching the launch deadline without self-sufficiency is a defeat", () => {
    const c = new Colony(3);
    // tick straight past the deadline sol; the seed colony won't self-sustain
    const solSeconds = Tuning.SOL_LENGTH;
    const evs = runCollecting(c, solSeconds * (Tuning.DEADLINE_SOL + 1));
    const s = c.snapshot();
    expect(s.outcome).toBe("defeat");
    // either the window closed or the colony died first — both are defeats
    expect(["window", "colony"]).toContain(s.outcomeReason);
    expect(evs.some((e) => e.type === "defeat")).toBe(true);
  });
});
