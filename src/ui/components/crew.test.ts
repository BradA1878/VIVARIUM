import { describe, expect, it } from "vitest";
import { crewInjurySummary } from "./crew";

describe("crewInjurySummary", () => {
  it("stays out of the HUD when everyone is healthy", () => {
    expect(crewInjurySummary([{ injury: 0 }, { injury: 0 }])).toBeNull();
  });

  it("counts only wounded crew and describes their risk in text", () => {
    expect(crewInjurySummary([{ injury: 11 }, { injury: 0 }, { injury: 2 }])).toEqual({
      count: 2,
      label: "2 WOUNDED",
      status: "OFF SHIFT · MED-BAY SPEEDS RECOVERY",
    });
  });
});
