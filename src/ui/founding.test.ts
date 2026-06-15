import { describe, it, expect } from "vitest";
import { nextSeedFrom, slotId, destinationsFrom, WORLD_META } from "./founding";

describe("founding helpers", () => {
  it("nextSeedFrom is deterministic and differs from the input seed", () => {
    expect(nextSeedFrom(0x5eed1234)).toBe(nextSeedFrom(0x5eed1234)); // reproducible
    expect(nextSeedFrom(0x5eed1234)).not.toBe(0x5eed1234);
    expect(nextSeedFrom(1)).not.toBe(nextSeedFrom(2)); // distinct inputs → distinct seeds
  });

  it("nextSeedFrom returns a uint32", () => {
    const s = nextSeedFrom(0xffffffff);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xffffffff);
  });

  it("slotId is world:seed", () => {
    expect(slotId("ceres", 42)).toBe("ceres:42");
  });

  it("destinationsFrom excludes the current world and covers the rest", () => {
    expect(destinationsFrom("mars")).toEqual(["ceres", "io", "titan"]);
    expect(destinationsFrom("io")).toEqual(["mars", "ceres", "titan"]);
  });

  it("every world has picker metadata", () => {
    for (const w of ["mars", "ceres", "io", "titan"] as const) {
      expect(WORLD_META[w].label).toBeTruthy();
      expect(WORLD_META[w].blurb).toBeTruthy();
    }
  });
});
