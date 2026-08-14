import { describe, expect, it } from "vitest";
import type { DefeatCause } from "@shared/types";
import { endCopy, type EndReportState } from "./endReport";

function state(cause: DefeatCause | null, over: Partial<EndReportState> = {}): EndReportState {
  return {
    outcome: "defeat",
    outcomeReason: "colony",
    defeatCause: cause,
    pools: {
      power: { amount: 200, capacity: 200 },
      oxygen: { amount: 70, capacity: 70 },
      water: { amount: 60, capacity: 60 },
      food: { amount: 50, capacity: 60 },
    },
    timers: { oxygen: null, water: null, food: null },
    ...over,
  };
}

describe("endCopy", () => {
  it("names a quake strike and reports the exact reserve state", () => {
    const copy = endCopy(state({ type: "strike", hazard: "quake" }));
    expect(copy.subline).toBe("The final crew member was lost to a marsquake strike.");
    expect(copy.epitaph).toBe(
      "A marsquake strike claimed the final crew member. All resource reserves remained above zero.",
    );
  });

  it("does not claim stable life support during a simultaneous crisis", () => {
    const copy = endCopy(state(
      { type: "strike", hazard: "meteor" },
      { pools: {
        power: { amount: 20, capacity: 200 },
        oxygen: { amount: 0, capacity: 70 },
        water: { amount: 10, capacity: 60 },
        food: { amount: 5, capacity: 60 },
      }, timers: { oxygen: 4, water: null, food: null } },
    ));
    expect(copy.epitaph).toContain("meteor strike");
    expect(copy.epitaph).not.toContain("remained above zero");
  });

  it.each(["oxygen", "water", "food"] as const)("names a terminal %s shortage", (resource) => {
    const copy = endCopy(state({ type: "resource", resource }));
    expect(copy.subline.toLowerCase()).toContain(resource);
    expect(copy.epitaph).toContain("reached zero");
  });

  it("keeps an unknown legacy cause neutral", () => {
    const copy = endCopy(state(null));
    expect(copy.epitaph).toContain("could not establish");
    expect(`${copy.subline} ${copy.epitaph}`).not.toMatch(/everything failed|stopped breathing/i);
  });

  it("recognizes a legacy window defeat without a typed cause", () => {
    const copy = endCopy(state(null, { outcomeReason: "window" }));
    expect(copy.subline).toContain("launch window");
    expect(copy.epitaph).toContain("Time ran out");
  });
});
