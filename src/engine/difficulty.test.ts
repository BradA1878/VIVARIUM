/* ============================================================================
   Difficulty modes — profile application, normal-equivalence (Colony(seed) ===
   Colony(seed, "normal") byte-for-byte), the multipliers-after-the-draw rule
   (rng draw counts identical across difficulties), reset/persistence, and the
   two rider techs (Medi-Gel, Harmonizer). Rare events are tested by direct
   state injection (ufo.test.ts pattern); rng stubs return fixed values.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { BuildingState, ColonyEvent, Difficulty, Side } from "@shared/types";
import { Colony } from "./index";
import { HAZARD_META, spawnHazard, updateHazards } from "./hazards";
import { updateUfo } from "./ufo";
import { updateInjuries } from "./injury";
import { bumpMorale, moraleFloor } from "./morale";
import { TECH_DEFS, TECH_IDS, techHealRateMult, techMoraleFloor } from "./techs";
import type { ColonistInstance, ColonyState } from "./state";
import { emptyColonist } from "./state";
import type { RNG } from "./rng";
import {
  DIFFICULTY, MORALE_START, MORALE_FLOOR, INJURY_RECOVERY, MEDBAY_HEAL_MULT,
  UFO_FIRST, UFO_GAP_MIN, UFO_GAP_SPAN, UFO_MIN_SOL,
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

/** an rng stub returning a fixed draw */
const rngOf = (v: number): RNG => ({ next: () => v }) as unknown as RNG;

const noEmit = (): void => {};

describe("profile application", () => {
  it("easy applies grace/deadline/startMaterials and surfaces on the snapshot", () => {
    const c = new Colony(7, "easy");
    const s = c.snapshot();
    expect(s.difficulty).toBe("easy");
    expect(s.grace).toBe(75);
    expect(s.deadlineSol).toBe(28);
    expect(s.materials.amount).toBe(130);
  });

  it("hard applies its profile", () => {
    const c = new Colony(7, "hard");
    const s = c.snapshot();
    expect(s.difficulty).toBe("hard");
    expect(s.grace).toBe(40);
    expect(s.deadlineSol).toBe(18);
    expect(s.materials.amount).toBe(60);
  });

  it("the default colony is normal — exactly today's tuning", () => {
    const s = new Colony(7).snapshot();
    expect(s.difficulty).toBe("normal");
    expect(s.grace).toBe(DIFFICULTY.normal.grace);
    expect(s.deadlineSol).toBe(DIFFICULTY.normal.deadlineSol);
    expect(s.materials.amount).toBe(DIFFICULTY.normal.startMaterials);
  });

  it("the first UFO timer scales by ufoGapMult", () => {
    expect(stateOf(new Colony(7, "easy")).nextUfo).toBeCloseTo(UFO_FIRST * DIFFICULTY.easy.ufoGapMult, 6);
    expect(stateOf(new Colony(7, "hard")).nextUfo).toBeCloseTo(UFO_FIRST * DIFFICULTY.hard.ufoGapMult, 6);
    expect(stateOf(new Colony(7)).nextUfo).toBe(UFO_FIRST);
  });
});

describe("NORMAL EQUIVALENCE — difficulty 'normal' changes nothing", () => {
  it("Colony(seed) and Colony(seed, 'normal') are byte-identical after 600s", () => {
    const a = new Colony(20260610);
    const b = new Colony(20260610, "normal");
    const evA = run(a, 600);
    const evB = run(b, 600);
    expect(evB).toEqual(evA);
    expect(b.snapshot()).toEqual(a.snapshot());
  });
});

describe("multipliers apply AFTER the draws (the rng stream never forks)", () => {
  /** a minimal state carrying only what the hazard scheduler touches */
  function hazardSchedState(difficulty: Difficulty): ColonyState {
    return {
      difficulty, hazards: [], buildings: [],
      directorControlled: false, nextHazard: 0, weather: "clear",
    } as unknown as ColonyState;
  }

  it("hard hazard gaps are gapMult× normal's off the SAME draw, equal draw counts", () => {
    const draws = { hard: 0, normal: 0 };
    const counting = (k: "hard" | "normal"): RNG =>
      ({ next: () => { draws[k] += 1; return 0.5; } }) as unknown as RNG;
    const hard = hazardSchedState("hard");
    const normal = hazardSchedState("normal");
    updateHazards(hard, 0.2, counting("hard"), noEmit);
    updateHazards(normal, 0.2, counting("normal"), noEmit);
    expect(draws.hard).toBe(draws.normal); // identical draw counts → identical stream
    expect(hard.nextHazard).toBeCloseTo(normal.nextHazard * DIFFICULTY.hard.hazardGapMult, 6);
    expect(hard.nextHazard).toBeLessThan(normal.nextHazard);
  });

  it("drawn intensity scales by hazardIntensityMult and clamps to 1", () => {
    // dust draw at rng=1 → intMin+intSpan = 1.0 → ×1.25 on hard → clamped to 1
    expect(spawnHazard(hazardSchedState("hard"), "dust", rngOf(1))).toBe(1);
    // dust draw at rng=0 → intMin 0.7 → ×0.8 on easy
    expect(spawnHazard(hazardSchedState("easy"), "dust", rngOf(0)))
      .toBeCloseTo(HAZARD_META.dust.intMin * DIFFICULTY.easy.hazardIntensityMult, 6);
  });

  it("Director-passed intensity scales coherently too (and normal passes through)", () => {
    expect(spawnHazard(hazardSchedState("easy"), "meteor", rngOf(0.5), 1))
      .toBeCloseTo(DIFFICULTY.easy.hazardIntensityMult, 6);
    expect(spawnHazard(hazardSchedState("hard"), "meteor", rngOf(0.5), 1)).toBe(1); // 1.25 → clamp
    expect(spawnHazard(hazardSchedState("normal"), "meteor", rngOf(0.5), 0.6)).toBe(0.6);
  });

  it("the UFO reschedule gap scales by ufoGapMult after the draw", () => {
    const colonists = Array.from({ length: 6 }, (_, i) => emptyColonist(i + 1, 5, 5));
    const s = {
      difficulty: "hard", ufo: null, nextUfo: 0, ufoCounter: 1, sol: UFO_MIN_SOL,
      population: 6, colonists, possessed: null, buildings: [], acquiredTech: [],
    } as unknown as ColonyState;
    updateUfo(s, 0.2, rngOf(0.5), noEmit);
    expect(s.ufo).not.toBeNull(); // a visit spawned, then the gap was rescheduled
    expect(s.nextUfo)
      .toBeCloseTo((UFO_GAP_MIN + 0.5 * UFO_GAP_SPAN) * DIFFICULTY.hard.ufoGapMult, 6);
  });
});

describe("reset", () => {
  it("reset() keeps the current difficulty; reset('hard') switches", () => {
    const c = new Colony(7, "easy");
    run(c, 5);
    c.reset();
    expect(c.snapshot().difficulty).toBe("easy");
    expect(c.snapshot().grace).toBe(DIFFICULTY.easy.grace);
    c.reset("hard");
    expect(c.snapshot().difficulty).toBe("hard");
    expect(c.snapshot().grace).toBe(DIFFICULTY.hard.grace);
    expect(c.snapshot().materials.amount).toBe(DIFFICULTY.hard.startMaterials);
  });
});

describe("persistence", () => {
  it("save → load round-trips difficulty and resumes bit-identically", () => {
    const c = new Colony(7, "hard");
    run(c, 30);
    const d = Colony.load(c.serialize());
    expect(d.snapshot().difficulty).toBe("hard");
    run(c, 30);
    run(d, 30);
    expect(d.snapshot()).toEqual(c.snapshot());
  });

  it("a pre-release v1 save (no difficulty/morale/injury fields) loads with defaults", () => {
    const c = new Colony(777);
    run(c, 30);
    const save = c.serialize();
    expect(save.version).toBe(1); // no version bump for the new fields
    delete (save.state as Partial<ColonyState>).difficulty;
    delete (save.state as Partial<ColonyState>).morale;
    delete (save.state as Partial<ColonyState>).moraleLatch;
    for (const k of save.state.colonists) delete (k as Partial<ColonistInstance>).injury;

    const d = Colony.load(save);
    const e = Colony.load(save);
    expect(d.snapshot().difficulty).toBe("normal");
    expect(d.snapshot().morale).toBe(MORALE_START);
    run(d, 60);
    run(e, 60);
    expect(e.snapshot()).toEqual(d.snapshot()); // defaults run deterministically
  });
});

describe("Medi-Gel + Harmonizer — the rider techs", () => {
  it("exist with their effects, and TECH_IDS auto-grows so traders offer them", () => {
    expect(TECH_DEFS.medigel.name).toBe("Medi-Gel");
    expect(TECH_DEFS.medigel.healRateMult).toBe(2);
    expect(TECH_DEFS.harmonizer.name).toBe("Harmonizer");
    expect(TECH_DEFS.harmonizer.moraleFloor).toBe(0.45);
    expect(TECH_IDS).toContain("medigel");
    expect(TECH_IDS).toContain("harmonizer");
  });

  it("medigel doubles the open-ground injury recovery rate", () => {
    const hurt = emptyColonist(1, 12, 12);
    hurt.injury = INJURY_RECOVERY;
    const s = {
      colonists: [hurt], buildings: [], population: 1, possessed: null,
      acquiredTech: ["medigel"],
    } as unknown as ColonyState;
    expect(techHealRateMult(s)).toBe(2);
    updateInjuries(s, 1, noEmit);
    expect(hurt.injury).toBeCloseTo(INJURY_RECOVERY - 2, 6); // base 1 × medigel 2
  });

  it("medigel stacks multiplicatively with the medbay rate", () => {
    // injury.test.ts arrangement: medbay at (5,5), door 2 rot 0 → access (5,6)
    const mb: BuildingState = {
      uid: 1, defId: "medbay", gx: 5, gy: 5, rot: 0 as Side,
      online: true, connected: true, staffed: true, fed: true, util: 1,
      integrity: 1, faulted: 0,
    };
    const hurt = emptyColonist(1, 5, 6);
    hurt.injury = INJURY_RECOVERY;
    const N = 15;
    const s = {
      N, grid: new Int32Array(N * N), buildings: [mb],
      colonists: [hurt], population: 1, possessed: null,
      acquiredTech: ["medigel"],
    } as unknown as ColonyState;
    updateInjuries(s, 1, noEmit);
    expect(hurt.injury).toBeCloseTo(INJURY_RECOVERY - MEDBAY_HEAL_MULT * 2, 6);
  });

  it("harmonizer raises the morale floor to 0.45 — bumpMorale clamps there", () => {
    const s = {
      morale: MORALE_START, moraleLatch: false, acquiredTech: ["harmonizer"],
    } as unknown as ColonyState;
    expect(techMoraleFloor(s)).toBe(0.45);
    expect(moraleFloor(s)).toBe(0.45);
    bumpMorale(s, -10);
    expect(s.morale).toBe(0.45);

    const bare = { morale: MORALE_START, acquiredTech: [] } as unknown as ColonyState;
    expect(moraleFloor(bare)).toBe(MORALE_FLOOR); // unchanged without the tech
  });
});
