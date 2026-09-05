/* Grid growth preserves a colony's layout, identities and running state. The
 * migration consumes no RNG; a migrated save must still resume deterministically. */
import { describe, it, expect } from "vitest";
import { Colony, DEFS } from "./index";
import type { ColonyState, SaveData } from "./state";
import { migrateGrid, idx } from "./grid";
import { canPlacePredict } from "./predict";
import { FOUNDING_GRID_N, GRID_N } from "./tuning";

const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

/** Build a valid historical-size save, including its occupancy array. Fresh
 * colonies now expose translated coordinates; undo that translation in this
 * fixture rather than merely relabeling a larger grid as a smaller one. */
function oldSave(): SaveData {
  const save = new Colony(7324).serialize();
  const s = save.state;
  const off = (s.N - FOUNDING_GRID_N) / 2;
  for (const b of s.buildings) { b.gx -= off; b.gy -= off; }
  for (const d of [...s.deposits, ...s.vents, ...s.aquifers, s.depot]) { d.gx -= off; d.gy -= off; }
  for (const c of s.colonists) { c.x -= off; c.y -= off; }
  s.N = FOUNDING_GRID_N;
  s.grid = occupancy(s.N, s.buildings);

  // Include live, fractional actors and identity-based relationships that an
  // incorrect migration could lose even if the buildings still look right.
  Object.assign(s.colonists[0], {
    x: 6.25, y: 4.5, carryKind: "ore", carryAmt: 1.5,
    gatherDepositId: s.deposits[0].id, gatherT: 0.75, workUid: 10, homeUid: 5,
  });
  s.rovers = [{ id: 5, x: 7.75, y: 5.5, facing: 0.5, cargo: { ore: 2, ice: 1 }, integrity: 0.8 }];
  s.robots = [{ id: 6, x: 8.2, y: 5.2, facing: 1, state: "hauling", carryKind: "ice", carryAmt: 2,
    faulted: 0.25, gatherDepositId: s.deposits[2].id, gatherT: 0.5 }];
  s.pilots = [{ id: s.colonists[0].id, dx: 0.5, dy: -0.25 }, { id: 5, dx: 0.25, dy: 0.5 }];
  s.colonistCounter = 7;
  s.trade = { id: 3, phase: "landed", give: { res: "water", amount: 10 },
    take: { res: "food", amount: 3 }, tLeft: 12.5, gx: 23, gy: 8 };
  s.tradeCounter = 4;
  s.ufo = { id: 4, phase: "inbound", tLeft: 15, targetId: s.colonists[1].id, gx: 6, gy: 4 };
  s.ufoCounter = 5;
  s.pools.water.amount = 31.5;
  s.materials.amount = 117.5;
  s.timers = { oxygen: 3.25, water: null, food: 4 };
  s.roverFab = 9; s.robotFab = 13; s.depositRespawn = 12.5;
  s.nextTrade = 18; s.nextUfo = 22;
  return save;
}

function occupancy(N: number, buildings: ColonyState["buildings"]): Int32Array {
  const grid = new Int32Array(N * N);
  for (const b of buildings) {
    const [w, h] = DEFS[b.defId].foot;
    for (let y = b.gy; y < b.gy + h; y++) for (let x = b.gx; x < b.gx + w; x++) {
      expect(x >= 0 && y >= 0 && x < N && y < N).toBe(true);
      expect(grid[idx(N, x, y)]).toBe(0);
      grid[idx(N, x, y)] = b.uid;
    }
  }
  return grid;
}

function expectTranslated(after: ColonyState, before: ColonyState, newN: number): void {
  const off = (newN - before.N) / 2;
  const gridPoint = <T extends { gx: number; gy: number }>(p: T): T => ({ ...p, gx: p.gx + off, gy: p.gy + off });
  const actorPoint = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.x + off, y: p.y + off });
  const buildings = before.buildings.map(gridPoint);
  // A whole-state comparison also pins IDs, cargo, claims, pilots, resources,
  // progress counters and timers: only spatial coordinates and N/grid change.
  expect(after).toEqual({
    ...before, N: newN, grid: occupancy(newN, buildings), buildings,
    deposits: before.deposits.map(gridPoint), vents: before.vents.map(gridPoint),
    aquifers: before.aquifers.map(gridPoint), depot: gridPoint(before.depot),
    colonists: before.colonists.map(actorPoint), rovers: before.rovers.map(actorPoint),
    robots: before.robots.map(actorPoint),
    trade: before.trade && gridPoint(before.trade), ufo: before.ufo && gridPoint(before.ufo),
  });
  // Odd-sized grids preserve world positions exactly when recentered.
  for (let i = 0; i < before.buildings.length; i++) {
    expect(after.buildings[i].gx - (newN - 1) / 2).toBe(before.buildings[i].gx - (before.N - 1) / 2);
    expect(after.buildings[i].gy - (newN - 1) / 2).toBe(before.buildings[i].gy - (before.N - 1) / 2);
  }
}

describe("migrateGrid re-centers a colony into a larger build grid", () => {
  it("shifts every spatial entity and preserves all non-spatial state", () => {
    const save = oldSave();
    const before = structuredClone(save.state);
    expect(migrateGrid(save.state, GRID_N)).toBe(save.state);
    expectTranslated(save.state, before, GRID_N);
  });

  it("is an exact no-op when the grid size is unchanged", () => {
    const s = stateOf(new Colony(102));
    const before = structuredClone(s), grid = s.grid;
    expect(migrateGrid(s, s.N)).toBe(s);
    expect(s).toEqual(before);
    expect(s.grid).toBe(grid);
  });

  it("loads a valid 25-cell save without changing the input or RNGs, and never translates twice", () => {
    const save = oldSave();
    const before = structuredClone(save);
    const loaded = Colony.load(save).serialize();
    expect(save).toEqual(before);
    expectTranslated(loaded.state, before.state, GRID_N);
    expect([loaded.seed, loaded.rngState, loaded.envRngState]).toEqual([before.seed, before.rngState, before.envRngState]);
    const again = Colony.load(loaded).serialize();
    expect(again).toEqual(loaded);
    expect(save).toEqual(before);
  });

  it("continues migrated actors, events and RNG streams identically after another save/load", () => {
    const save = oldSave();
    const before = structuredClone(save);
    const a = Colony.load(save), b = Colony.load(save);
    for (let i = 0; i < 100; i++) {
      a.tick(0.2); b.tick(0.2);
      expect(a.drainEvents()).toEqual(b.drainEvents());
    }
    const resumed = Colony.load(a.serialize());
    for (let i = 0; i < 200; i++) {
      a.tick(0.2); b.tick(0.2); resumed.tick(0.2);
      const events = a.drainEvents();
      expect(b.drainEvents()).toEqual(events);
      expect(resumed.drainEvents()).toEqual(events);
    }
    expect(b.serialize()).toEqual(a.serialize());
    expect(resumed.serialize()).toEqual(a.serialize());
    expect(a.snapshot().t).toBeGreaterThan(50);
    expect(save).toEqual(before);
  });
});

describe("expanded construction area", () => {
  it("retains the established opening's resource positions and RNG draw count", () => {
    const c = new Colony(7324);
    const initial = c.serialize();
    const off = (GRID_N - FOUNDING_GRID_N) / 2;
    expect([initial.state.N, FOUNDING_GRID_N]).toEqual([41, 25]);
    // Captured from this seed before expansion; independent of the migration
    // helper so changed terrain draw counts or a second offset cannot hide.
    expect([initial.rngState, initial.envRngState]).toEqual([7324, 2142900925]);
    expect(initial.state.buildings.find((b) => b.defId === "hub")).toMatchObject({ gx: 4 + off, gy: 4 + off });
    expect(initial.state.deposits.map((d) => [d.gx - off, d.gy - off])).toEqual([
      [14, 14], [1, 17], [3, 18], [3, 8], [19, 4], [21, 9],
      [8, 14], [22, 10], [18, 3], [3, 22], [13, 19],
    ]);
    expect(initial.state.vents.map((v) => [v.gx - off, v.gy - off])).toEqual([[15, 21], [3, 15], [23, 9]]);
    expect(initial.state.aquifers.map((a) => [a.gx - off, a.gy - off])).toEqual([[4, 15], [5, 23]]);
    c.tick(0.2);
    c.reset("normal", 7324, "mars");
    expect(c.serialize()).toEqual(initial);
  });

  it("places full footprints beyond all four former boundaries and rejects overflow at the new edges", () => {
    const c = new Colony(103);
    const s = stateOf(c);
    s.materials.amount = s.materials.capacity;
    const far = GRID_N - 2; // a 2x2 solar array fits exactly against the boundary
    for (const [x, y] of [[0, 0], [far, 0], [0, far], [far, far]]) {
      expect(canPlacePredict(c.snapshot(), "solar", x, y)).toBe(true);
      expect(c.place("solar", x, y)).toBe(true);
      const uid = c.buildingAt(x, y)!.uid;
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        expect(s.grid[idx(GRID_N, x + dx, y + dy)]).toBe(uid);
        expect(c.buildingAt(x + dx, y + dy)?.uid).toBe(uid);
      }
    }
    const before = c.serialize();
    const mid = Math.floor(GRID_N / 2);
    for (const [x, y] of [[-1, mid], [mid, -1], [GRID_N - 1, mid], [mid, GRID_N - 1], [GRID_N, mid], [mid, GRID_N]]) {
      expect(canPlacePredict(c.snapshot(), "solar", x, y)).toBe(false);
      expect(c.place("solar", x, y)).toBe(false);
    }
    expect(c.serialize()).toEqual(before);
  });
});
