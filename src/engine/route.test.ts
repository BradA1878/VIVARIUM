/* ============================================================================
   Doors + auto-routing tests — the door exit cell turns with rotation, and the
   BFS finds an axis-aligned path (or reports none).
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony, DEFS, doorCells, routeCorridor } from "./index";

describe("door geometry rotates with the building", () => {
  it("a habitat's door exit cell turns a quarter at a time", () => {
    const hab = DEFS.hab; // local door = south (2)
    expect(doorCells(hab, 3, 6, 0)).toEqual({ side: 2, edge: [3, 6], exit: [3, 7] });
    expect(doorCells(hab, 3, 6, 1)!.exit).toEqual([2, 6]); // → west
    expect(doorCells(hab, 3, 6, 2)!.exit).toEqual([3, 5]); // → north
    expect(doorCells(hab, 3, 6, 3)!.exit).toEqual([4, 6]); // → east
  });

  it("a 2×2 hub's door sits on its south edge cell", () => {
    expect(doorCells(DEFS.hub, 4, 4, 0)).toEqual({ side: 2, edge: [4, 5], exit: [4, 6] });
  });

  it("non-pressure buildings have no door", () => {
    expect(doorCells(DEFS.solar, 0, 0, 0)).toBeNull();
  });
});

describe("routeCorridor (pure BFS)", () => {
  it("finds the straight path on an empty grid", () => {
    const path = routeCorridor({ N: 11, isBlocked: () => false }, [0, 0], [0, 3]);
    expect(path).toEqual([[0, 0], [0, 1], [0, 2], [0, 3]]);
  });

  it("detours around a wall", () => {
    // a wall along column x=0 at y=1..3 forces a step to x=1
    const wall = new Set(["0,1"]);
    const path = routeCorridor(
      { N: 11, isBlocked: (x, y) => wall.has(`${x},${y}`) },
      [0, 0], [0, 2],
    );
    expect(path).not.toBeNull();
    expect(path!.some(([x]) => x === 1)).toBe(true); // it went around
    expect(path![path!.length - 1]).toEqual([0, 2]);
  });

  it("returns null when fully walled off", () => {
    const blocked = (_x: number, y: number) => y === 1; // a full wall across row 1
    const path = routeCorridor({ N: 5, isBlocked: blocked }, [0, 0], [0, 2]);
    expect(path).toBeNull();
  });
});

describe("Colony.route lays a corridor run between two doors", () => {
  it("connects two electrolysis units whose doors face the gap", () => {
    const c = new Colony(1);
    // open ground in the top-left; A at (1,1) door south → exit (1,2)
    c.place("electrolysis", 1, 1, 0);
    // B at (1,4); rotate twice so its door faces north → exit (1,3)
    c.place("electrolysis", 1, 4, 2);
    const before = c.snapshot().buildings.filter((b) => b.defId === "corridor").length;
    const a = c.buildingAt(1, 1)!.uid;
    const b = c.buildingAt(1, 4)!.uid;
    const ok = c.route(a, b);
    expect(ok).toBe(true);
    const after = c.snapshot().buildings.filter((bb) => bb.defId === "corridor").length;
    expect(after).toBeGreaterThan(before); // corridors were laid along the path
  });
});
