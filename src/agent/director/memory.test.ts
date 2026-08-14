/* ============================================================================
   Cross-run memory tests — the planet leans its opening toward how this player
   has died before.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import {
  LEGACY_PLAYER_MODEL_KEY, PLAYER_MODEL_KEY, emptyModel, loadModel,
  recordOutcome, openingBias, saveModel, type PlayerModelStorage,
} from "./memory";

function storage(seed: Record<string, string> = {}): PlayerModelStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  };
}

describe("cross-run memory", () => {
  it("a fresh player gets a neutral opening", () => {
    const bias = openingBias(emptyModel());
    expect(Object.values(bias).every((v) => v === 1)).toBe(true);
  });

  it("after repeated oxygen deaths the opening leans on oxygen-threatening hazards", () => {
    const m = emptyModel();
    for (let i = 0; i < 4; i++) {
      recordOutcome(m, { won: false, cause: { type: "resource", resource: "oxygen" }, sols: 3 });
    }
    const bias = openingBias(m);
    // oxygen deaths → meteor/quake; an unrelated recent flare is no longer
    // mis-recorded as the cause.
    expect(bias.meteor).toBeGreaterThan(1);
    expect(bias.flare).toBe(1);
    expect(bias.meteor).toBeGreaterThan(bias.dust);
  });

  it("records the actual strike kind rather than whichever hazard was merely recent", () => {
    const m = emptyModel();
    recordOutcome(m, { won: false, cause: { type: "strike", hazard: "quake" }, sols: 6 });
    expect(m.byHazard.quake).toBe(1);
    expect(m.byHazard.meteor).toBe(0);
    expect(openingBias(m).quake).toBeGreaterThan(1);
  });

  it("wins don't add a death bias", () => {
    const m = emptyModel();
    recordOutcome(m, { won: true, sols: 12 });
    expect(m.deaths).toBe(0);
    expect(Object.values(openingBias(m)).every((v) => v === 1)).toBe(true);
    expect(m.wins).toBe(1);
  });

  it("migrates v1 totals but drops its inferred cause breakdowns", () => {
    const legacy = {
      runs: 5, wins: 2, deaths: 3, solsSum: 31,
      byAxis: { power: 1, oxygen: 2, water: 0, food: 0 },
      byHazard: { dust: 0, meteor: 0, flare: 3, coldsnap: 0, quake: 0 },
    };
    const target = storage({ [LEGACY_PLAYER_MODEL_KEY]: JSON.stringify(legacy) });

    const migrated = loadModel(target);

    expect(migrated).toMatchObject({ runs: 5, wins: 2, deaths: 3, solsSum: 31 });
    expect(Object.values(migrated.byAxis).every((n) => n === 0)).toBe(true);
    expect(Object.values(migrated.byHazard).every((n) => n === 0)).toBe(true);
    expect(target.data.has(PLAYER_MODEL_KEY)).toBe(true);
  });

  it("round-trips only normalized v2 data", () => {
    const target = storage();
    const model = emptyModel();
    recordOutcome(model, { won: false, cause: { type: "strike", hazard: "quake" }, sols: 4 });
    saveModel(model, target);
    expect(loadModel(target)).toEqual(model);
    expect(target.data.has(LEGACY_PLAYER_MODEL_KEY)).toBe(false);
  });

  it("keeps migrated totals in memory when storage is read-only", () => {
    const legacy = JSON.stringify({ runs: 2, wins: 1, deaths: 1, solsSum: 9 });
    const target: PlayerModelStorage = {
      getItem: (key) => key === LEGACY_PLAYER_MODEL_KEY ? legacy : null,
      setItem: () => { throw new Error("read-only"); },
    };
    expect(loadModel(target)).toMatchObject({ runs: 2, wins: 1, deaths: 1, solsSum: 9 });
  });
});
