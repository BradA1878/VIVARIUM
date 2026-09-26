import { describe, expect, it } from "vitest";
import { sealNetwork, type SealBuilding } from "./seal";

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
