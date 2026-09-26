import { describe, expect, it } from "vitest";
import { Colony } from "./colony";
import { DEFS } from "./defs";
import { modesFor } from "./modes";
import type { ColonyState } from "./state";

const stateOf = (c: Colony) => (c as unknown as { s: ColonyState }).s;

describe("modesFor — which settings a building offers", () => {
  it("offers FIRST / NORMAL / OFF on every building that needs crew", () => {
    for (const id of ["extractor", "awg", "aquifer", "reclaimer", "electrolysis", "greenhouse", "medbay", "reactor", "roboticsbay"]) {
      expect(modesFor(DEFS[id]), id).toEqual(["first", "normal", "off"]);
    }
  });

  it("offers NORMAL / OFF on crewless buildings that draw power", () => {
    for (const id of ["deflector", "printer", "roverbay", "ptp"]) expect(modesFor(DEFS[id]), id).toEqual(["normal", "off"]);
  });

  it("offers nothing on the hub, corridors, habitats, generators, and storage", () => {
    for (const id of ["hub", "corridor", "hab", "solar", "windturbine", "geothermal", "battery", "cistern", "o2tank"]) {
      expect(modesFor(DEFS[id]), id).toEqual([]);
    }
  });
});

describe("Colony.setMode", () => {
  const seed = () => {
    const c = new Colony(7);
    const s = stateOf(c);
    const elec = s.buildings.find((b) => b.defId === "electrolysis")!;
    return { c, s, elec };
  };

  it("stores FIRST and OFF, and clears the field for NORMAL", () => {
    const { c, elec } = seed();
    expect(c.setMode(elec.uid, "first")).toBe(true);
    expect(elec.mode).toBe("first");
    expect(c.setMode(elec.uid, "off")).toBe(true);
    expect(elec.mode).toBe("off");
    expect(c.setMode(elec.uid, "normal")).toBe(true);
    expect("mode" in elec).toBe(false);
  });

  it("rejects an unknown uid (a building demolished a moment ago)", () => {
    const { c, s } = seed();
    const before = JSON.stringify(s.buildings);
    expect(c.setMode(99_999, "off")).toBe(false);
    expect(JSON.stringify(s.buildings)).toBe(before);
  });

  it("rejects a setting the building does not offer", () => {
    const { c, s } = seed();
    const hub = s.buildings.find((b) => b.defId === "hub")!;
    const solar = s.buildings.find((b) => b.defId === "solar")!;
    expect(c.setMode(hub.uid, "off")).toBe(false);
    expect(c.setMode(solar.uid, "first")).toBe(false);
    expect(c.setMode(hub.uid, "banana" as never)).toBe(false);
    expect(hub.mode).toBeUndefined();
  });
});
