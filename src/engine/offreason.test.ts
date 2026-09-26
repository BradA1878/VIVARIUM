import { describe, expect, it } from "vitest";
import { Colony } from "./colony";
import type { ColonyState } from "./state";

const stateOf = (c: Colony) => (c as unknown as { s: ColonyState }).s;
const seedElectrolysis = (s: ColonyState) => s.buildings.find((b) => b.defId === "electrolysis")!;

/** a fresh colony at noon with full pools, so only the condition under test fails */
function colony(): { c: Colony; s: ColonyState } {
  const c = new Colony(7);
  const s = stateOf(c);
  s.tod = 0.5;
  s.pools.power.amount = s.pools.power.capacity;
  s.pools.water.amount = s.pools.water.capacity;
  return { c, s };
}

describe("offReason — the first production gate that failed", () => {
  it("is unset while the building runs", () => {
    const { c, s } = colony();
    c.tick(0.1);
    expect(seedElectrolysis(s).util).toBe(1);
    expect(seedElectrolysis(s).offReason).toBeUndefined();
  });

  it("names power when a brownout sheds it", () => {
    const { c, s } = colony();
    s.tod = 0; // midnight: no solar
    s.pools.power.amount = 0;
    c.tick(0.1);
    expect(seedElectrolysis(s).offReason).toBe("power");
  });

  it("names damage, and a flare fault separately", () => {
    const a = colony();
    seedElectrolysis(a.s).integrity = 0.2;
    a.c.tick(0.1);
    expect(seedElectrolysis(a.s).offReason).toBe("damaged");
    const b = colony();
    seedElectrolysis(b.s).faulted = 5;
    b.c.tick(0.1);
    expect(seedElectrolysis(b.s).offReason).toBe("faulted");
  });

  it("names the seal for a sealed building off the network", () => {
    const { c, s } = colony();
    s.materials.amount = 200;
    // a cell well away from every building, with a clear ring around it
    let spot: [number, number] | null = null;
    for (let y = 1; y < s.N - 1 && !spot; y++)
      for (let x = 1; x < s.N - 1 && !spot; x++) {
        let clear = true;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (s.grid[(y + dy) * s.N + (x + dx)] !== 0) clear = false;
        if (clear && s.buildings.every((b) => Math.abs(b.gx - x) + Math.abs(b.gy - y) >= 7)) spot = [x, y];
      }
    expect(c.place("electrolysis", spot![0], spot![1])).toBe(true); // no connect
    c.tick(0.1);
    expect(s.buildings.at(-1)!.offReason).toBe("seal");
  });

  it("names crew when no one is free to staff it", () => {
    const { c, s } = colony();
    s.population = 0;
    c.tick(0.1);
    expect(seedElectrolysis(s).offReason).toBe("crew");
  });

  it("names the missing input", () => {
    const { c, s } = colony();
    s.pools.water.amount = 0;
    c.tick(0.1);
    expect(seedElectrolysis(s).offReason).toBe("water");
  });

  it("clears once the building runs again", () => {
    const { c, s } = colony();
    s.pools.water.amount = 0;
    c.tick(0.1);
    expect(seedElectrolysis(s).offReason).toBe("water");
    s.pools.water.amount = s.pools.water.capacity;
    c.tick(0.1);
    expect(seedElectrolysis(s).offReason).toBeUndefined();
  });
});
