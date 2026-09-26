import { describe, expect, it } from "vitest";
import { Colony } from "./colony";
import { DEFS } from "./defs";
import { cellsFor } from "./grid";
import { planSealRoute, sealNetwork, sealPreview, type SealBuilding, type SealPlan } from "./seal";
import type { ColonyState } from "./state";

let nextUid = 1;
const at = (defId: string, gx: number, gy: number): SealBuilding => ({ uid: nextUid++, defId, gx, gy });
const N = 16;

describe("sealNetwork — the pressure rule", () => {
  it("floods from every hub, not just the first", () => {
    const a = at("hub", 0, 0), b = at("hub", 10, 10), habB = at("hab", 12, 10);
    const net = sealNetwork(N, [a, b, habB]);
    expect([...net.connected].sort((x, y) => x - y)).toEqual([a.uid, b.uid, habB.uid].sort((x, y) => x - y));
  });

  it("docked sealed buildings share the seal through each other", () => {
    const hub = at("hub", 0, 0), hab = at("hab", 2, 0), elec = at("electrolysis", 3, 0), med = at("medbay", 4, 0);
    const net = sealNetwork(N, [hub, hab, elec, med]);
    expect(net.connected.has(hab.uid)).toBe(true);
    expect(net.connected.has(elec.uid)).toBe(true);
    expect(net.connected.has(med.uid)).toBe(true);
  });

  it("a surface building breaks the chain and is never marked connected", () => {
    const hub = at("hub", 0, 0), hab = at("hab", 2, 0), bat = at("battery", 3, 0), elec = at("electrolysis", 4, 0);
    const net = sealNetwork(N, [hub, hab, bat, elec]);
    expect(net.connected.has(hab.uid)).toBe(true);
    expect(net.connected.has(bat.uid)).toBe(false);
    expect(net.connected.has(elec.uid)).toBe(false);
  });

  it("corridors carry it, and a sealed building off the end of the run joins, every cell of it", () => {
    const hub = at("hub", 0, 0), c1 = at("corridor", 2, 0), c2 = at("corridor", 3, 0), gh = at("greenhouse", 4, 0);
    const net = sealNetwork(N, [hub, c1, c2, gh]);
    expect(net.connected.has(c2.uid)).toBe(true);
    expect(net.connected.has(gh.uid)).toBe(true);
    for (const [x, y] of [[4, 0], [5, 0], [4, 1], [5, 1]]) expect(net.cells.has(y * N + x)).toBe(true);
  });

  it("a corridor that does not trace back to a hub stays unsealed", () => {
    const hub = at("hub", 0, 0), lone = at("corridor", 8, 8), hab = at("hab", 9, 8);
    const net = sealNetwork(N, [hub, lone, hab]);
    expect(net.connected.has(lone.uid)).toBe(false);
    expect(net.connected.has(hab.uid)).toBe(false);
  });

  it("with no hub nothing is connected", () => {
    const net = sealNetwork(N, [at("hab", 3, 3), at("corridor", 4, 3)]);
    expect(net.connected.size).toBe(0);
    expect(net.cells.size).toBe(0);
  });
});

const foot = (defId: string, gx: number, gy: number) => cellsFor(DEFS[defId], gx, gy);

describe("planSealRoute", () => {
  it("touching the network needs no corridor", () => {
    const bs = [at("hub", 0, 0)]; // cells (0,0)-(1,1)
    expect(planSealRoute(N, bs, sealNetwork(N, bs), foot("hab", 2, 1)).kind).toBe("touching");
  });

  it("touching a docked module counts as touching", () => {
    const bs = [at("hub", 0, 0), at("hab", 2, 0)];
    expect(planSealRoute(N, bs, sealNetwork(N, bs), foot("electrolysis", 3, 0)).kind).toBe("touching");
  });

  it("lays the shortest corridor to the network and prices every new cell", () => {
    const bs = [at("hub", 0, 0)];
    const plan = planSealRoute(N, bs, sealNetwork(N, bs), foot("hab", 6, 0));
    if (plan.kind !== "corridor") throw new Error(`expected a corridor, got ${plan.kind}`);
    expect(plan.path).toHaveLength(4);
    expect(plan.newCells).toHaveLength(4);
    expect(plan.cost).toBe(4 * (DEFS.corridor.matCost ?? 0));
    // the path is contiguous, starts beside the building, and ends beside the network
    const [sx, sy] = plan.path[0];
    expect(Math.abs(sx - 6) + Math.abs(sy - 0)).toBe(1);
    const [ex, ey] = plan.path[plan.path.length - 1];
    expect(Math.abs(ex - 1) + Math.abs(ey - 0)).toBe(1);
    for (let i = 1; i < plan.path.length; i++) {
      const [ax, ay] = plan.path[i - 1], [bx, by] = plan.path[i];
      expect(Math.abs(ax - bx) + Math.abs(ay - by)).toBe(1);
    }
  });

  it("reuses a dangling corridor for free", () => {
    const bs = [at("hub", 0, 0), at("corridor", 4, 0)];
    const plan = planSealRoute(N, bs, sealNetwork(N, bs), foot("hab", 6, 0));
    if (plan.kind !== "corridor") throw new Error(`expected a corridor, got ${plan.kind}`);
    expect(plan.path).toHaveLength(4);
    expect(plan.newCells).toHaveLength(3);
    expect(plan.newCells.some(([x, y]) => x === 4 && y === 0)).toBe(false);
    expect(plan.cost).toBe(3 * (DEFS.corridor.matCost ?? 0));
  });

  it("routes around buildings in the way", () => {
    const bs = [at("hub", 0, 0), at("battery", 3, 0), at("battery", 3, 1)];
    const plan = planSealRoute(N, bs, sealNetwork(N, bs), foot("hab", 5, 0));
    if (plan.kind !== "corridor") throw new Error(`expected a corridor, got ${plan.kind}`);
    for (const [x, y] of plan.path) expect(x === 3 && (y === 0 || y === 1)).toBe(false);
  });

  it("a boxed-in site has no route", () => {
    const bs = [at("hub", 0, 0), at("battery", 8, 7), at("battery", 8, 9), at("battery", 7, 8), at("battery", 9, 8)];
    expect(planSealRoute(N, bs, sealNetwork(N, bs), foot("hab", 8, 8)).kind).toBe("no-route");
  });

  it("no hub means no route", () => {
    expect(planSealRoute(N, [], sealNetwork(N, []), foot("hab", 4, 4)).kind).toBe("no-route");
  });

  it("gives the same answer for the same inputs", () => {
    const bs = [at("hub", 0, 0), at("battery", 4, 1)];
    const a = planSealRoute(N, bs, sealNetwork(N, bs), foot("greenhouse", 7, 3));
    const b = planSealRoute(N, bs, sealNetwork(N, bs), foot("greenhouse", 7, 3));
    expect(a).toEqual(b);
    expect(a.kind).toBe("corridor");
  });
});

describe("sealPreview", () => {
  const plan: SealPlan = { kind: "corridor", path: [[2, 0], [3, 0]], newCells: [[2, 0], [3, 0]], cost: 4 };

  it("adds the building's cost and says whether it is affordable, exact totals included", () => {
    expect(sealPreview(plan, 24, 28)).toEqual({ kind: "corridor", path: plan.path, cells: 2, cost: 4, total: 28, affordable: true });
    expect(sealPreview(plan, 24, 27)).toMatchObject({ total: 28, affordable: false });
  });

  it("passes touching and no-route through", () => {
    expect(sealPreview({ kind: "touching" }, 24, 0)).toEqual({ kind: "touching" });
    expect(sealPreview({ kind: "no-route" }, 24, 0)).toEqual({ kind: "no-route" });
  });
});

describe("Colony.place with connect", () => {
  const stateOf = (c: Colony) => (c as unknown as { s: ColonyState }).s;
  /** the first cell (scan order) at least `minDist` from every building, with a
   *  clear radius-1 ring, so a 1×1 sealed building placed there must route */
  const farEmptyCell = (s: ColonyState, minDist = 7): [number, number] => {
    const occupied = (x: number, y: number) => x < 0 || y < 0 || x >= s.N || y >= s.N || s.grid[y * s.N + x] !== 0;
    for (let y = 1; y < s.N - 1; y++)
      for (let x = 1; x < s.N - 1; x++) {
        let clear = true;
        for (let dy = -1; dy <= 1 && clear; dy++) for (let dx = -1; dx <= 1 && clear; dx++) if (occupied(x + dx, y + dy)) clear = false;
        if (!clear) continue;
        const far = s.buildings.every((b) => Math.abs(b.gx - x) + Math.abs(b.gy - y) >= minDist);
        if (far) return [x, y];
      }
    throw new Error("no far empty cell");
  };
  const count = (s: ColonyState, defId: string) => s.buildings.filter((b) => b.defId === defId).length;

  it("lays the corridor, charges the building plus 2 per new cell, and connects it", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = 300;
    const [x, y] = farEmptyCell(s);
    const corridorsBefore = count(s, "corridor");
    expect(c.place("hab", x, y, 0, true)).toBe(true);
    const laid = count(s, "corridor") - corridorsBefore;
    expect(laid).toBeGreaterThan(0);
    expect(s.materials.amount).toBe(300 - (DEFS.hab.matCost ?? 0) - laid * (DEFS.corridor.matCost ?? 0));
    expect(s.buildings.find((b) => b.defId === "hab" && b.gx === x && b.gy === y)!.connected).toBe(true);
  });

  it("places nothing when the building fits the budget but the corridor does not", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    const [x, y] = farEmptyCell(s);
    s.materials.amount = (DEFS.hab.matCost ?? 0) + 1;
    const before = s.buildings.length;
    expect(c.place("hab", x, y, 0, true)).toBe(false);
    expect(s.buildings.length).toBe(before);
    expect(s.materials.amount).toBe((DEFS.hab.matCost ?? 0) + 1);
  });

  it("exact materials are enough", () => {
    const probe = new Colony(7);
    const ps = stateOf(probe);
    ps.materials.amount = 300; // under the cap: placing re-clamps materials to capacity
    const [x, y] = farEmptyCell(ps);
    expect(probe.place("hab", x, y, 0, true)).toBe(true);
    const spent = 300 - ps.materials.amount;
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = spent;
    expect(c.place("hab", x, y, 0, true)).toBe(true);
    expect(s.materials.amount).toBe(0);
  });

  it("touching the base lays no corridor", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = 300;
    const hub = s.buildings.find((b) => b.defId === "hub")!;
    // the first empty cell bordering the hub's 2×2 footprint
    const ring: [number, number][] = [];
    for (let i = 0; i < 2; i++) ring.push([hub.gx + i, hub.gy - 1], [hub.gx + 2, hub.gy + i], [hub.gx + i, hub.gy + 2], [hub.gx - 1, hub.gy + i]);
    const spot = ring.find(([x, y]) => x >= 0 && y >= 0 && x < s.N && y < s.N && s.grid[y * s.N + x] === 0)!;
    const before = s.buildings.length;
    expect(c.place("electrolysis", spot[0], spot[1], 0, true)).toBe(true);
    expect(s.buildings.length).toBe(before + 1);
    expect(s.buildings.at(-1)!.connected).toBe(true);
  });

  it("a second placement in the same batch docks to the first", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = 500;
    const [x, y] = farEmptyCell(s);
    expect(c.place("hab", x, y, 0, true)).toBe(true);
    const before = s.buildings.length;
    expect(c.place("electrolysis", x + 1, y, 0, true) || c.place("electrolysis", x - 1, y, 0, true)).toBe(true);
    expect(s.buildings.length).toBe(before + 1); // docked: no corridor
    expect(s.buildings.at(-1)!.connected).toBe(true);
  });

  it("with no route the building is placed unsealed", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = 300;
    for (const hub of s.buildings.filter((b) => DEFS[b.defId].isHub)) expect(c.removeAt(hub.gx, hub.gy)).toBe(true);
    const [x, y] = farEmptyCell(s);
    const before = s.buildings.length;
    expect(c.place("hab", x, y, 0, true)).toBe(true);
    expect(s.buildings.length).toBe(before + 1);
    expect(s.buildings.at(-1)!.connected).toBe(false);
  });

  it("without connect nothing changes from before", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = 300;
    const [x, y] = farEmptyCell(s);
    const before = s.buildings.length;
    expect(c.place("hab", x, y)).toBe(true);
    expect(s.buildings.length).toBe(before + 1);
    expect(s.materials.amount).toBe(300 - (DEFS.hab.matCost ?? 0));
  });

  it("connect is ignored for surface buildings", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = 300;
    const [x, y] = farEmptyCell(s);
    const before = s.buildings.length;
    expect(c.place("battery", x, y, 0, true)).toBe(true);
    expect(s.buildings.length).toBe(before + 1);
  });

  // the snapshot the host sends after each command must show the network as it
  // now is, even while paused (no tick): the overlay reads these flags
  describe("connected flags follow every command, not only the tick", () => {
    /** the seed electrolysis docks to the network through one corridor, north of it */
    const seed = () => {
      const c = new Colony(7);
      const s = stateOf(c);
      s.materials.amount = 300;
      const elec = s.buildings.find((b) => b.defId === "electrolysis")!;
      return { c, s, elec, cut: [elec.gx, elec.gy - 1] as const };
    };

    it("the seed colony is sealed before its first tick", () => {
      const { elec } = seed();
      expect(elec.connected).toBe(true);
    });

    it("remove and a hand-laid corridor update the flags at once", () => {
      const { c, elec, cut } = seed();
      expect(c.removeAt(...cut)).toBe(true);
      expect(elec.connected).toBe(false);
      expect(c.place("corridor", ...cut)).toBe(true); // no connect
      expect(elec.connected).toBe(true);
    });

    it("a moved building takes its flag with it", () => {
      const { c, s, elec } = seed();
      const home = [elec.gx, elec.gy] as const;
      const [x, y] = farEmptyCell(s);
      expect(c.move(elec.uid, x, y)).toBe(true);
      expect(elec.connected).toBe(false);
      expect(c.move(elec.uid, ...home)).toBe(true);
      expect(elec.connected).toBe(true);
    });

    it("a two-click route reconnects at once", () => {
      const { c, s, elec, cut } = seed();
      expect(c.removeAt(...cut)).toBe(true);
      const hub = s.buildings.find((b) => DEFS[b.defId].isHub)!;
      expect(c.route(elec.uid, hub.uid)).toBe(true);
      expect(elec.connected).toBe(true);
    });

    it("loading a save re-derives stale flags from the buildings", () => {
      const { c, elec } = seed();
      const data = c.serialize();
      const saved = data.state.buildings.find((b) => b.uid === elec.uid)!;
      saved.connected = false; // as a save from before the rule would carry it
      const loaded = stateOf(Colony.load(data));
      expect(loaded.buildings.find((b) => b.uid === elec.uid)!.connected).toBe(true);
    });
  });
});
