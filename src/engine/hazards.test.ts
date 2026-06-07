/* ============================================================================
   Hazard system tests — lifecycle, the modifier math, damage/functionality, and
   that an attached Director suppresses the engine's own scheduler.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "./index";
import { hazardMods, buildingFunctional } from "./hazards";
import type { ColonyState } from "./state";
import type { ColonyEvent } from "@shared/types";

function step(c: Colony, seconds: number, dt = 0.2): ColonyEvent[] {
  const evs: ColonyEvent[] = [];
  for (let i = 0; i < Math.round(seconds / dt); i++) { c.tick(dt); evs.push(...c.drainEvents()); }
  return evs;
}

describe("hazard lifecycle", () => {
  it("telegraphs, goes active (weather=dust), then ends", () => {
    const c = new Colony(1);
    c.setDirector(true); // stop the auto-scheduler so we only see our hazard
    c.triggerHazard("dust", 1);
    const warn = c.drainEvents();
    expect(warn.some((e) => e.type === "hazard_warn" && e.kind === "dust")).toBe(true);

    const evs = step(c, 8); // past the ~6s telegraph
    expect(evs.some((e) => e.type === "hazard_start" && e.kind === "dust")).toBe(true);
    expect(c.snapshot().weather).toBe("dust");

    const more = step(c, 45); // past the active window
    expect(more.some((e) => e.type === "hazard_end" && e.kind === "dust")).toBe(true);
    expect(c.snapshot().weather).toBe("clear");
  });
});

describe("hazard modifiers", () => {
  const active = (kind: string, intensity = 1) =>
    ({ hazards: [{ kind, phase: "active", intensity, tLeft: 5, activeDur: 5, cadence: 0 }] }) as unknown as ColonyState;

  it("dust guts solar, cold-snap raises pressurized draw, flare siphons power", () => {
    expect(hazardMods(active("dust", 1)).solarFactor).toBeLessThan(0.2);
    expect(hazardMods(active("coldsnap", 1)).pressurePowerMult).toBeGreaterThan(1);
    expect(hazardMods(active("flare", 1)).powerDrain).toBeGreaterThan(0);
  });
});

describe("damage & functionality", () => {
  it("a building below the integrity threshold or faulted can't operate", () => {
    const base = { integrity: 1, faulted: 0 } as Parameters<typeof buildingFunctional>[0];
    expect(buildingFunctional({ ...base })).toBe(true);
    expect(buildingFunctional({ ...base, integrity: 0.3 })).toBe(false);
    expect(buildingFunctional({ ...base, faulted: 2 })).toBe(false);
  });

  it("a meteor strike damages a densely-packed colony", () => {
    const c = new Colony(4);
    c.setDirector(true);
    // pack a block with tanks so strikes land
    for (let x = 0; x < 7; x++) for (let y = 0; y < 7; y++) c.place("o2tank", x, y);
    c.triggerHazard("meteor", 1);
    const evs = step(c, 30);
    expect(evs.some((e) => e.type === "building_damaged" && e.detail === "meteor")).toBe(true);
  });

  it("a quake damages infrastructure (corridors / sealed units)", () => {
    const c = new Colony(2);
    c.setDirector(true);
    c.triggerHazard("quake", 1);
    const evs = step(c, 16);
    expect(evs.some((e) => e.type === "building_damaged" && e.detail === "quake")).toBe(true);
  });
});

describe("the Director suppresses the engine scheduler", () => {
  it("no hazard auto-spawns while director-controlled", () => {
    const c = new Colony(7);
    c.setDirector(true);
    const evs = step(c, 300); // well past the first scheduled hazard (~95s)
    expect(evs.some((e) => e.type === "hazard_warn")).toBe(false);
  });

  it("hazards do auto-spawn when the engine runs itself", () => {
    const c = new Colony(7);
    const evs = step(c, 300);
    expect(evs.some((e) => e.type === "hazard_warn")).toBe(true);
  });
});
