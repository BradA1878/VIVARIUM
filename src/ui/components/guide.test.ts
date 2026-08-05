import { describe, expect, it } from "vitest";
import {
  GUIDE_KEY,
  guideObjective,
  guideStageComplete,
  loadGuideProgress,
  nextGuideStage,
  saveGuideProgress,
  type GuideSnapshot,
} from "./guide";
import { fieldGuideIntentFor } from "./help";

function snapshot(overrides: Partial<GuideSnapshot> = {}): GuideSnapshot {
  return {
    buildings: [],
    colonists: [{ carryAmt: 0, carryKind: null, possessed: false }],
    possessed: null,
    solarMul: 1,
    materialsAmount: 40,
    ...overrides,
  };
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

describe("field guide", () => {
  it("advances only after each contextual action is visible in the snapshot", () => {
    expect(guideStageComplete("food", snapshot({
      buildings: [{ defId: "greenhouse", connected: false, online: false, staffed: false }],
    }))).toBe(false);
    expect(guideStageComplete("food", snapshot({
      buildings: [{ defId: "greenhouse", connected: true, online: true, staffed: true }],
    }))).toBe(true);
    expect(guideStageComplete("power", snapshot({
      buildings: [
        { defId: "battery", connected: true, online: true, staffed: true },
        { defId: "battery", connected: true, online: true, staffed: true },
      ],
    }))).toBe(true);
    expect(nextGuideStage("mining")).toBe("complete");
  });

  it("does not complete mining until piloted ore is unloaded and credited", () => {
    const progress = { miningCargoSeen: true, miningBaseline: 40 };
    expect(guideStageComplete("mining", snapshot({
      colonists: [{ carryAmt: 8, carryKind: "ore", possessed: true }],
      materialsAmount: 40,
    }), progress)).toBe(false);
    expect(guideStageComplete("mining", snapshot({
      colonists: [{ carryAmt: 0, carryKind: null, possessed: true }],
      materialsAmount: 48,
    }), progress)).toBe(true);
  });

  it("adapts food, night, and mining copy to the current state", () => {
    expect(guideObjective("food", snapshot({
      buildings: [{ defId: "greenhouse", connected: false, online: false, staffed: false }],
    })).eyebrow).toContain("PRESSURE");
    expect(guideObjective("power", snapshot({ solarMul: 0.1 })).title).toContain("sun is down");
    expect(guideObjective("mining", snapshot({ possessed: 7 })).body).toContain("orange ore");
  });

  it("persists valid progress and rejects corrupt progress", () => {
    const storage = memoryStorage();
    saveGuideProgress({
      v: 2,
      stage: "power",
      skipped: false,
      miningCargoSeen: false,
      miningBaseline: null,
    }, storage);
    expect(loadGuideProgress(storage)).toEqual({
      v: 2,
      stage: "power",
      skipped: false,
      miningCargoSeen: false,
      miningBaseline: null,
    });
    storage.setItem(GUIDE_KEY, "not-json");
    expect(loadGuideProgress(storage)).toBeNull();
  });

  it("labels handbook handoffs as start, resume, or replay", () => {
    expect(fieldGuideIntentFor(null, false)).toBe("start");
    expect(fieldGuideIntentFor({ stage: "power" }, false)).toBe("resume");
    expect(fieldGuideIntentFor({ stage: "complete" }, false)).toBe("replay");
    expect(fieldGuideIntentFor(null, true)).toBe("replay");
  });
});
