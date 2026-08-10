import { describe, expect, it } from "vitest";
import { resupplyAlertCopy } from "./alerts";

describe("resupplyAlertCopy", () => {
  it("explains the automatic delivery and departure countdown", () => {
    expect(resupplyAlertCopy(17.6)).toEqual({
      txt: "EARTH RESUPPLY — AUTOMATIC",
      sub: "no action required · adding power, water, oxygen, and food · departs in 18s",
    });
  });
});
