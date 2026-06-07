/* ============================================================================
   Cross-run memory tests — the planet leans its opening toward how this player
   has died before.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { emptyModel, recordOutcome, openingBias } from "./memory";

describe("cross-run memory", () => {
  it("a fresh player gets a neutral opening", () => {
    const bias = openingBias(emptyModel());
    expect(Object.values(bias).every((v) => v === 1)).toBe(true);
  });

  it("after repeated power deaths the opening leans on power hazards", () => {
    const m = emptyModel();
    for (let i = 0; i < 4; i++) recordOutcome(m, { won: false, lethalAxis: "oxygen", recentHazard: "flare", sols: 3 });
    const bias = openingBias(m);
    // oxygen deaths → meteor/quake; the recent-hazard (flare) also lifts flare
    expect(bias.meteor).toBeGreaterThan(1);
    expect(bias.flare).toBeGreaterThan(1);
    expect(bias.meteor).toBeGreaterThan(bias.dust);
  });

  it("wins don't add a death bias", () => {
    const m = emptyModel();
    recordOutcome(m, { won: true, sols: 12 });
    expect(m.deaths).toBe(0);
    expect(Object.values(openingBias(m)).every((v) => v === 1)).toBe(true);
    expect(m.wins).toBe(1);
  });
});
