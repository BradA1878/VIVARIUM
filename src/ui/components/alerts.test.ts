import { describe, expect, it } from "vitest";
import { quakeAlertSub, resupplyAlertCopy } from "./alerts";

describe("quakeAlertSub", () => {
  it("explains automatic evacuation, the pilot action, injury, and seal risk", () => {
    expect(quakeAlertSub(3.6, true)).toBe(
      "crew evacuating · release any pilot to shelter · exposed crew can be injured · seals at risk · impact in 4s",
    );
    expect(quakeAlertSub(7.2, false)).toBe(
      "crew evacuating · release any pilot to shelter · exposed crew can be injured · seals at risk · 7s remaining",
    );
  });
});

describe("resupplyAlertCopy", () => {
  it("explains the automatic delivery and departure countdown", () => {
    expect(resupplyAlertCopy(17.6)).toEqual({
      txt: "EARTH RESUPPLY — AUTOMATIC",
      sub: "no action required · adding power, water, oxygen, and food · departs in 18s",
    });
  });
});
