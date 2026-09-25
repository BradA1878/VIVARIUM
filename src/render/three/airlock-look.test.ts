import { describe, expect, it } from "vitest";
import { AIRLOCK_COLLAR, AIRLOCK_SIGNAL, airlockSignalIntensity } from "../renderer";

describe("airlock signal", () => {
  it("stays a small signal: dim by day, below the bloom threshold at night", () => {
    expect(airlockSignalIntensity(0)).toBeCloseTo(0.35);
    expect(airlockSignalIntensity(1)).toBeCloseTo(0.95);
    expect(airlockSignalIntensity(2)).toBeCloseTo(0.95);
    expect(airlockSignalIntensity(-1)).toBeCloseTo(0.35);
  });

  it("rides the collar's outer rim, standing proud instead of being enclosed", () => {
    // farthest the ring's tube reaches from the collar tube's own centre circle
    const reach = Math.hypot(AIRLOCK_SIGNAL.radius - AIRLOCK_COLLAR.radius, AIRLOCK_SIGNAL.z) + AIRLOCK_SIGNAL.tube;
    expect(reach).toBeGreaterThanOrEqual(AIRLOCK_COLLAR.tube + 0.01);
  });
});
