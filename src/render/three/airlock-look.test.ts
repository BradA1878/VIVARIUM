import { describe, expect, it } from "vitest";
import { airlockSignalIntensity } from "../renderer";

describe("airlock signal", () => {
  it("stays a small signal: dim by day, below the bloom threshold at night", () => {
    expect(airlockSignalIntensity(0)).toBeCloseTo(0.35);
    expect(airlockSignalIntensity(1)).toBeCloseTo(0.95);
    expect(airlockSignalIntensity(2)).toBeCloseTo(0.95);
    expect(airlockSignalIntensity(-1)).toBeCloseTo(0.35);
  });
});
