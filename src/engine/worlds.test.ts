/* ============================================================================
   World profiles (PTP slice 6) — Ceres / Io / Titan reshape the environment on
   the unchanged engine. mars is the anchor (today's constants → byte-identical,
   enforced by the rest of the suite). Here we lock that each world actually pulls
   its levers, and that a non-mars world is still internally deterministic.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "./index";
import { WORLDS, worldProfile, VENT_COUNT, START_AMOUNT } from "./tuning";

const ventsOf = (w: "mars" | "ceres" | "io" | "titan") =>
  new Colony(123, "normal", w).serialize().state.vents.length;

describe("world profiles", () => {
  it("mars is the identity anchor (today's constants)", () => {
    expect(WORLDS.mars).toMatchObject({ solar: 1, wind: 1, vents: VENT_COUNT, oreCut: 0.4, iceCut: 0.72 });
    expect(WORLDS.mars.startPools).toEqual(START_AMOUNT);
    expect(WORLDS.mars.hazardWeights).toEqual({});
  });

  it("each world seeds its own geothermal vent count", () => {
    expect(ventsOf("mars")).toBe(VENT_COUNT); // 3
    expect(ventsOf("io")).toBeGreaterThan(ventsOf("ceres")); // io geothermal-rich, ceres sparse
    expect(ventsOf("io")).toBeGreaterThan(ventsOf("mars"));
  });

  it("each world starts with its own pool stock", () => {
    expect(new Colony(1, "normal", "mars").snapshot().pools.power.amount).toBe(START_AMOUNT.power);
    expect(new Colony(1, "normal", "ceres").snapshot().pools.power.amount).toBe(45); // weak sun → lean power
    expect(new Colony(1, "normal", "ceres").snapshot().pools.water.amount).toBe(60); // ice-rich → water-flush
    expect(new Colony(1, "normal", "titan").snapshot().pools.power.amount).toBe(80); // full base reserve to bootstrap, no sun
  });

  it("ceres drops dust from its hazard mix; titan leans into it", () => {
    expect(worldProfile("ceres").hazardWeights.dust).toBe(0);
    expect(worldProfile("titan").hazardWeights.dust ?? 0).toBeGreaterThan(4); // > mars default weight
  });

  it("a non-mars world is still internally deterministic (same seed → same future)", () => {
    const a = new Colony(77, "normal", "io");
    const b = new Colony(77, "normal", "io");
    for (let i = 0; i < 200; i++) { a.tick(0.2); a.drainEvents(); b.tick(0.2); b.drainEvents(); }
    expect(b.snapshot()).toEqual(a.snapshot());
  });
});
