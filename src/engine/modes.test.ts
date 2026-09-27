import { describe, expect, it } from "vitest";
import { Colony } from "./colony";
import { DEFS } from "./defs";
import { modesFor, productionOrder } from "./modes";
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

describe("productionOrder", () => {
  it("is the same array when nothing is set to FIRST", () => {
    const list = [{ uid: 1 }, { uid: 2, mode: "off" as const }];
    expect(productionOrder(list)).toBe(list);
  });

  it("puts FIRST buildings first, each group in build order", () => {
    const list = [{ uid: 1 }, { uid: 2, mode: "first" as const }, { uid: 3 }, { uid: 4, mode: "first" as const }];
    expect(productionOrder(list).map((b) => b.uid)).toEqual([2, 4, 1, 3]);
  });
});

describe("crew order in the tick", () => {
  /** the seed colony at noon, pools full, plus two more electrolysis units on
   *  the network, with `labor` workers. Staffed buildings in build order: the
   *  seed electrolysis (e1), the seed extractor (x2), e3, e4. */
  function scene(labor: number) {
    const c = new Colony(7);
    const s = stateOf(c);
    s.tod = 0.5;
    for (const k of ["power", "water", "oxygen", "food"] as const) s.pools[k].amount = s.pools[k].capacity;
    s.materials.amount = 400;
    const hub = s.buildings.find((b) => b.defId === "hub")!;
    expect(c.place("electrolysis", hub.gx - 3, hub.gy, 0, true)).toBe(true); // lays a corridor to the hub
    const e3 = s.buildings.find((b) => b.defId === "electrolysis" && b.gx === hub.gx - 3 && b.gy === hub.gy)!;
    expect(c.place("electrolysis", hub.gx - 3, hub.gy + 1, 0, true)).toBe(true); // docks to e3
    const e4 = s.buildings.find((b) => b.defId === "electrolysis" && b.gx === hub.gx - 3 && b.gy === hub.gy + 1)!;
    s.population = labor;
    const e1 = s.buildings.find((b) => b.defId === "electrolysis")!;
    const x2 = s.buildings.find((b) => b.defId === "extractor")!;
    const staffedNow = () =>
      [e1, x2, e3, e4].filter((b) => b.offReason !== "crew" && b.offReason !== "off").map((b) => b.uid);
    return { c, s, e1, x2, e3, e4, staffedNow };
  }

  it("by default staffs the oldest first", () => {
    const { c, e1, x2, staffedNow } = scene(2);
    c.tick(0.1);
    expect(staffedNow()).toEqual([e1.uid, x2.uid]);
  });

  it("a FIRST building is staffed before the rest", () => {
    const { c, e1, e4, staffedNow } = scene(2);
    c.setMode(e4.uid, "first");
    c.tick(0.1);
    expect(staffedNow().sort()).toEqual([e1.uid, e4.uid].sort());
  });

  it("an OFF building takes no worker, runs nothing, and says so", () => {
    const { c, e1, x2, e3, staffedNow } = scene(2);
    c.setMode(e1.uid, "off");
    c.tick(0.1);
    expect(e1.offReason).toBe("off");
    expect(e1.online).toBe(false);
    expect(e1.util).toBe(0);
    expect(staffedNow()).toEqual([x2.uid, e3.uid]);
  });

  it("a FIRST building that cannot run passes its worker on", () => {
    const { c, e1, x2, e4, staffedNow } = scene(2);
    c.setMode(e4.uid, "first");
    e4.integrity = 0.2; // below working integrity: it fails a gate before crew
    c.tick(0.1);
    expect(e4.offReason).toBe("damaged");
    expect(staffedNow().filter((u) => u !== e4.uid)).toEqual([e1.uid, x2.uid]);
  });

  it("OFF takes no power: with power for everything else, everything else runs", () => {
    const { c, s, e1 } = scene(10);
    c.setMode(e1.uid, "off");
    s.tod = 0; // night: no solar
    const dt = 0.1;
    const need = s.buildings
      .filter((b) => b.uid !== e1.uid)
      .reduce((sum, b) => sum + (DEFS[b.defId].consumes.power ?? 0) * dt, 0);
    s.pools.power.amount = need + 1e-6;
    c.tick(dt);
    for (const b of s.buildings) {
      if (b.uid === e1.uid || !(DEFS[b.defId].consumes.power ?? 0)) continue;
      expect(b.offReason, b.defId).not.toBe("power");
    }
  });

  it("an OFF building with no power draw stays offline", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.unlocked.push("reactor");
    s.materials.amount = 400;
    s.tod = 0.5;
    const hub = s.buildings.find((b) => b.defId === "hub")!;
    expect(c.place("reactor", hub.gx - 5, hub.gy - 5)).toBe(true);
    const reactor = s.buildings.at(-1)!;
    expect(c.setMode(reactor.uid, "off")).toBe(true);
    c.tick(0.1);
    expect(reactor.online).toBe(false);
    expect(reactor.offReason).toBe("off");
  });

  it("posts a worker at every running building first, FIRST ones first", () => {
    const { c, s, e1, e4 } = scene(2);
    c.setMode(e4.uid, "first");
    c.tick(0.1);
    const posted = s.colonists.map((k) => k.workUid).filter((u): u is number => u != null).sort();
    expect(posted).toEqual([e1.uid, e4.uid].sort());
  });

  it("gives an OFF building no post, and lets a stopped one keep its crew", () => {
    const { c, s, e1, e3 } = scene(10);
    c.setMode(e1.uid, "off");
    e3.integrity = 0.2; // stopped by damage
    c.tick(0.1);
    const posted = s.colonists.map((k) => k.workUid);
    expect(posted).not.toContain(e1.uid); // switching it off freed its worker
    expect(posted).toContain(e3.uid); // a stopped building's crew stays on post, as before
  });

  it("keeps colonists on their posts when a building flickers between running and stopped", () => {
    const { c, s, e1 } = scene(10); // four colonists for the four staffed buildings
    c.tick(0.1);
    const posts = () => s.colonists.map((k) => `${k.id}:${k.workUid}`).join(" ");
    const before = posts();
    expect(s.colonists.filter((k) => k.workUid != null)).toHaveLength(4);
    e1.integrity = 0.2; // stopped for a tick
    c.tick(0.1);
    expect(posts()).toBe(before);
    e1.integrity = 1; // running again
    c.tick(0.1);
    expect(posts()).toBe(before);
  });

  it("stays deterministic with settings in play", () => {
    const run = () => {
      const { c, e1, e4 } = scene(2);
      c.setMode(e4.uid, "first");
      c.setMode(e1.uid, "off");
      for (let i = 0; i < 300; i++) c.tick(0.2);
      return JSON.stringify(c.serialize());
    };
    expect(run()).toBe(run());
  });
});

describe("the setting in saves", () => {
  it("round-trips, and a save without it loads as NORMAL", () => {
    const c = new Colony(7);
    const elec = stateOf(c).buildings.find((b) => b.defId === "electrolysis")!;
    c.setMode(elec.uid, "first");
    const data = c.serialize();
    expect(stateOf(Colony.load(data)).buildings.find((b) => b.uid === elec.uid)!.mode).toBe("first");
    delete data.state.buildings.find((b) => b.uid === elec.uid)!.mode;
    expect(stateOf(Colony.load(data)).buildings.find((b) => b.uid === elec.uid)!.mode).toBeUndefined();
  });
});
