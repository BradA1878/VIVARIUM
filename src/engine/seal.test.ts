import { describe, expect, it } from "vitest";
import { DEFS } from "./defs";
import { cellsFor } from "./grid";
import { planSealRoute, sealNetwork, sealPreview, type SealBuilding, type SealPlan } from "./seal";

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
