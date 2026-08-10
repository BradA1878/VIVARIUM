import { describe, expect, it } from "vitest";
import type { ColonyState } from "./state";
import {
  techCapBonus,
  techDeflectorBoost,
  techDemandMult,
  techHealRateMult,
  isKnownTech,
  techMoraleFloor,
  techPassivePower,
} from "./techs";

const stateWith = (...acquiredTech: string[]): ColonyState => ({ acquiredTech } as ColonyState);

describe("permanent alien-tech effects", () => {
  it("accepts only owned tech definitions, never Object prototype names", () => {
    expect(isKnownTech("capacitor")).toBe(true);
    expect(isKnownTech("constructor")).toBe(false);
    expect(isKnownTech("__proto__")).toBe(false);
  });

  it("applies all storage upgrades at their advertised values", () => {
    const caps = techCapBonus(stateWith("capacitor", "cryocell", "o2reservoir"));
    expect(caps).toMatchObject({ power: 140, water: 140, oxygen: 110 });
  });

  it("applies continuous generation and lower oxygen demand", () => {
    const s = stateWith("fusioncell", "bioscrubber");
    expect(techPassivePower(s)).toBe(3.5);
    expect(techDemandMult(s, "oxygen")).toBeCloseTo(0.82);
    expect(techDemandMult(s, "water")).toBe(1);
  });

  it("applies the defensive, healing, and morale upgrades", () => {
    const s = stateWith("aegis", "medigel", "harmonizer");
    expect(techDeflectorBoost(s)).toBeCloseTo(0.3);
    expect(techHealRateMult(s)).toBe(2);
    expect(techMoraleFloor(s)).toBeCloseTo(0.45);
  });
});
