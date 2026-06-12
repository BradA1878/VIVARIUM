/* ============================================================================
   Grid migration tests — growing the buildable area must carry an existing
   colony into the larger grid (re-centered), not strand it in a corner or drop
   the save. migrateGrid is pure (no RNG), so a migrated save still replays.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "./index";
import type { ColonyState } from "./state";
import { migrateGrid, idx } from "./grid";
import { GRID_N } from "./tuning";

/** reach the engine's private state (the suite's seam for inspecting) */
const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

describe("migrateGrid re-centers a colony into a larger build grid", () => {
  it("shifts every entity by the centering offset and restamps occupancy", () => {
    const c = new Colony(101);
    const s = stateOf(c);
    s.deposits = [{ id: 9, gx: 8, gy: 7, kind: "ore", amount: 40, max: 40 }];
    const oldN = s.N;
    const newN = oldN + 10;               // grows by 5 cells on every side
    const off = Math.floor((newN - oldN) / 2); // = 5

    const b0 = s.buildings.map((b) => ({ uid: b.uid, gx: b.gx, gy: b.gy }));
    const dep0 = s.deposits.map((d) => ({ id: d.id, gx: d.gx, gy: d.gy }));
    const col0 = s.colonists.map((k) => ({ id: k.id, x: k.x, y: k.y }));
    const depot0 = { gx: s.depot.gx, gy: s.depot.gy };

    migrateGrid(s, newN);

    expect(s.N).toBe(newN);
    expect(s.grid.length).toBe(newN * newN);

    // buildings shifted, and each footprint cell re-stamped with its uid
    for (const ref of b0) {
      const b = s.buildings.find((x) => x.uid === ref.uid)!;
      expect([b.gx, b.gy]).toEqual([ref.gx + off, ref.gy + off]);
      expect(s.grid[idx(newN, b.gx, b.gy)]).toBe(b.uid);
    }
    // a cell far outside the shifted base is empty in the new grid
    expect(s.grid[idx(newN, newN - 1, newN - 1)]).toBe(0);

    // depot, deposits, colonists all shift by the same offset
    expect([s.depot.gx, s.depot.gy]).toEqual([depot0.gx + off, depot0.gy + off]);
    for (const ref of dep0) {
      const d = s.deposits.find((x) => x.id === ref.id)!;
      expect([d.gx, d.gy]).toEqual([ref.gx + off, ref.gy + off]);
    }
    for (const ref of col0) {
      const k = s.colonists.find((x) => x.id === ref.id)!;
      expect([k.x, k.y]).toEqual([ref.x + off, ref.y + off]);
    }
  });

  it("is a no-op when the grid size is unchanged", () => {
    const c = new Colony(102);
    const s = stateOf(c);
    const before = s.buildings.map((b) => [b.gx, b.gy] as const);
    const gridBefore = s.grid.slice();
    migrateGrid(s, s.N);
    expect(s.buildings.map((b) => [b.gx, b.gy] as const)).toEqual(before);
    expect(s.grid).toEqual(gridBefore);
  });

  it("Colony.load grows an older, smaller-grid save up to GRID_N and replays", () => {
    const c = new Colony(103);
    c.tick(0.2); c.drainEvents();
    const save = c.serialize();
    // pretend the save predates the larger grid (the seed base lives in 0..14, so
    // it fits any oldN < GRID_N). load rebuilds the occupancy grid during migration.
    const oldN = GRID_N - 4;
    save.state.N = oldN;
    save.state.grid = new Int32Array(oldN * oldN); // a same-N grid; migration discards it

    const d = Colony.load(save);
    const sd = stateOf(d);
    expect(sd.N).toBe(GRID_N);
    expect(sd.grid.length).toBe(GRID_N * GRID_N);
    for (const b of sd.buildings) {
      expect(sd.grid[idx(GRID_N, b.gx, b.gy)]).toBe(b.uid);
    }
    // a migrated colony keeps running (lockstep against a second load of the same save)
    const e = Colony.load(save);
    for (let i = 0; i < 100; i++) { d.tick(0.2); d.drainEvents(); e.tick(0.2); e.drainEvents(); }
    expect(e.snapshot()).toEqual(d.snapshot());
  });
});
