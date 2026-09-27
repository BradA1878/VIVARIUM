import { describe, expect, it } from "vitest";
import { Colony } from "./colony";
import { DEFS } from "./defs";
import { GATES, GATE_HINTS } from "./unlocks";
import { lowestPrintTarget } from "./printers";
import { moraleMult } from "./morale";
import type { ColonyState } from "./state";

const stateOf = (c: Colony) => (c as unknown as { s: ColonyState }).s;
const fill = (s: ColonyState, o: number, w: number, f: number, m: number) => {
  s.pools.oxygen.amount = s.pools.oxygen.capacity * o;
  s.pools.water.amount = s.pools.water.capacity * w;
  s.pools.food.amount = s.pools.food.capacity * f;
  s.materials.amount = s.materials.capacity * m;
};

describe("lowestPrintTarget", () => {
  it("picks the pool lowest as a share of its capacity", () => {
    const s = stateOf(new Colony(7));
    fill(s, 0.9, 0.2, 0.5, 0.7);
    expect(lowestPrintTarget(s)).toBe("water");
    fill(s, 0.9, 0.9, 0.9, 0.1);
    expect(lowestPrintTarget(s)).toBe("materials");
  });

  it("breaks ties oxygen, water, food, materials", () => {
    const s = stateOf(new Colony(7));
    fill(s, 0.5, 0.5, 0.5, 0.5);
    expect(lowestPrintTarget(s)).toBe("oxygen");
    fill(s, 0.9, 0.5, 0.5, 0.5);
    expect(lowestPrintTarget(s)).toBe("water");
  });

  it("counts a pool with no capacity as full", () => {
    const s = stateOf(new Colony(7));
    fill(s, 0.5, 0.5, 0.5, 0.5);
    s.pools.oxygen.capacity = 0;
    expect(lowestPrintTarget(s)).toBe("water");
  });
});

describe("the printers in the tick", () => {
  /** a colony at noon with a full battery and a printer of `defId` placed and unlocked */
  function withPrinter(defId: string) {
    const c = new Colony(7);
    const s = stateOf(c);
    s.unlocked.push(defId);
    s.materials.amount = 300;
    s.tod = 0.5;
    s.pools.power.amount = s.pools.power.capacity;
    const hub = s.buildings.find((b) => b.defId === "hub")!;
    expect(c.place(defId, hub.gx - 6, hub.gy - 6)).toBe(true);
    return { c, s, printer: s.buildings.at(-1)! };
  }

  it("the Bio Printer turns water into food with no crew", () => {
    const { c, s, printer } = withPrinter("bioprinter");
    s.population = 0; // nobody to staff anything
    s.pools.water.amount = s.pools.water.capacity;
    s.pools.food.amount = 0;
    c.tick(0.2);
    expect(printer.util).toBe(1);
    expect(s.pools.food.amount).toBeGreaterThan(0);
    expect(DEFS.bioprinter).toMatchObject({ staffing: 0, consumes: { power: 8, water: 2 }, produces: { food: 3 } });
  });

  it("the Atomic Printer makes the lowest resource, scaled by morale", () => {
    // the same colony with and without it: the difference in water flow is its output
    const flowWater = (withAtomic: boolean) => {
      const { c, s, printer } = withPrinter("atomic");
      if (!withAtomic) c.removeAt(printer.gx, printer.gy);
      fill(s, 0.9, 0.1, 0.9, 0.9); // water is lowest
      s.pools.power.amount = s.pools.power.capacity;
      const eff = moraleMult(s);
      c.tick(0.2);
      return { water: s.flow.water, eff };
    };
    const a = flowWater(false);
    const b = flowWater(true);
    expect(b.water - a.water).toBeCloseTo(DEFS.atomic.printsLowest!.water * b.eff, 6);
  });

  it("all full: it picks oxygen and the pool stays at capacity", () => {
    const { c, s } = withPrinter("atomic");
    fill(s, 1, 1, 1, 1);
    c.tick(0.2);
    expect(s.pools.oxygen.amount).toBeLessThanOrEqual(s.pools.oxygen.capacity);
  });

  it("carries the spec's numbers", () => {
    expect(DEFS.printer).toMatchObject({ name: "3D Printer", glyph: "3DP", matCost: 40, staffing: 0, consumes: { power: 6 }, producesMat: 0.35, priority: 15 });
    expect(DEFS.bioprinter).toMatchObject({ glyph: "BIO", foot: [1, 1], matCost: 35, priority: 28, requiresPressure: false });
    expect(DEFS.atomic).toMatchObject({
      glyph: "ATM", foot: [2, 2], matCost: 120, staffing: 0, consumes: { power: 30 }, priority: 10, requiresPressure: false,
      printsLowest: { oxygen: 6, water: 8, food: 4, materials: 1 },
    });
  });
});

describe("printer unlocks", () => {
  it("Bio: a Hydroponics built, or sol 6; Atomic: a reactor built", () => {
    const s = stateOf(new Colony(7));
    s.sol = 1;
    expect(GATES.bioprinter(s)).toBe(false);
    s.sol = 6;
    expect(GATES.bioprinter(s)).toBe(true);
    s.sol = 1;
    s.buildings.push({ ...s.buildings[0], uid: 900, defId: "greenhouse" });
    expect(GATES.bioprinter(s)).toBe(true);
    expect(GATES.atomic(s)).toBe(false);
    s.buildings.push({ ...s.buildings[0], uid: 901, defId: "reactor" });
    expect(GATES.atomic(s)).toBe(true);
  });

  it("every gate has a hint for the palette, and every hint a gate", () => {
    expect(Object.keys(GATE_HINTS).sort()).toEqual(Object.keys(GATES).sort());
  });
});

describe("the Fabricator is gone", () => {
  it("has no def and no gate", () => {
    expect(DEFS.fabricator).toBeUndefined();
    expect("fabricator" in GATES).toBe(false);
  });

  it("a save with fabricators loads without them: cells free, no refund, not unlocked", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    const data = c.serialize();
    const hub = s.buildings.find((b) => b.defId === "hub")!;
    const cell = { gx: hub.gx - 6, gy: hub.gy - 6 };
    data.state.buildings.push({ ...data.state.buildings[0], uid: 950, defId: "fabricator", gx: cell.gx, gy: cell.gy, replicateT: 12 } as never);
    data.state.grid[cell.gy * data.state.N + cell.gx] = 950;
    data.state.unlocked.push("fabricator");
    const materials = data.state.materials.amount;
    const loaded = Colony.load(data);
    const ls = stateOf(loaded);
    expect(ls.buildings.some((b) => b.defId === "fabricator")).toBe(false);
    expect(ls.grid[cell.gy * ls.N + cell.gx]).toBe(0);
    expect(ls.unlocked).not.toContain("fabricator");
    expect(ls.materials.amount).toBe(materials);
    expect(ls.buildings.every((b) => !("replicateT" in b))).toBe(true);
    ls.materials.amount = 100;
    expect(loaded.place("battery", cell.gx, cell.gy)).toBe(true); // the cell is buildable
    loaded.tick(0.2); // and the colony runs
  });
});
