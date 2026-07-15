/* ============================================================================
   Pathfind tests — characterization pinned BEFORE the scratch-buffer reuse
   refactor, so the optimization provably changes nothing: shortest paths,
   deterministic tie-breaks (repeat calls byte-equal), blocked/target rules,
   and — the reason these exist — zero contamination across calls that reuse
   the module-scoped scratch (different states, different grid sizes).
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { findPath } from "./pathfind";
import type { ColonyState } from "./state";

/** a minimal state: N and an occupancy grid (uid 99 marks a blocked cell) */
function state(N: number, blocked: [number, number][] = []): ColonyState {
  const grid = new Int32Array(N * N);
  for (const [x, y] of blocked) grid[y * N + x] = 99;
  return { N, grid } as unknown as ColonyState;
}

const len = (p: [number, number][] | null): number => (p ? p.length : -1);

describe("findPath — shape and rules", () => {
  it("finds a shortest path, endpoints inclusive, unit steps", () => {
    const s = state(6);
    const p = findPath(s, 0, 0, 3, 2)!;
    expect(p[0]).toEqual([0, 0]);
    expect(p.at(-1)).toEqual([3, 2]);
    expect(p.length).toBe(6); // manhattan 5 + 1 — optimal on an empty grid
    for (let i = 1; i < p.length; i++) {
      const d = Math.abs(p[i][0] - p[i - 1][0]) + Math.abs(p[i][1] - p[i - 1][1]);
      expect(d).toBe(1);
    }
  });

  it("start === target is the one-cell path; out of bounds is null", () => {
    const s = state(4);
    expect(findPath(s, 2, 2, 2, 2)).toEqual([[2, 2]]);
    expect(findPath(s, -1, 0, 2, 2)).toBeNull();
    expect(findPath(s, 0, 0, 4, 0)).toBeNull();
  });

  it("routes AROUND a wall; never stands on a blocked intermediate cell", () => {
    // a vertical wall with no gap forces the long way round its end
    const s = state(5, [[2, 0], [2, 1], [2, 2], [2, 3]]);
    const p = findPath(s, 0, 2, 4, 2)!;
    expect(p.length).toBeGreaterThan(5); // detoured, not through
    for (const [x, y] of p.slice(0, -1)) {
      expect(s.grid[y * 5 + x]).toBe(0);
    }
  });

  it("the TARGET may be an occupied cell (aiming at a building), intermediates may not", () => {
    const s = state(5, [[3, 1]]);
    const p = findPath(s, 1, 1, 3, 1)!;
    expect(p.at(-1)).toEqual([3, 1]); // lands on the building's own cell
    expect(p.length).toBe(3);
  });

  it("a walled-off room is unreachable → null", () => {
    const s = state(5, [[1, 0], [1, 1], [0, 1]]); // corner cell (0,0) sealed
    expect(findPath(s, 3, 3, 0, 0)).toBeNull();
    expect(findPath(s, 0, 0, 3, 3)).toBeNull(); // and from inside it, outward
  });
});

describe("findPath — determinism and scratch isolation", () => {
  it("repeat calls are byte-identical (fixed tie-breaks, no per-call drift)", () => {
    const s = state(7, [[3, 3], [3, 4], [4, 3]]);
    const first = findPath(s, 0, 0, 6, 6);
    for (let i = 0; i < 5; i++) expect(findPath(s, 0, 0, 6, 6)).toEqual(first);
  });

  it("interleaved states do not contaminate each other", () => {
    const a = state(6, [[2, 0], [2, 1], [2, 2]]);
    const b = state(6, [[4, 4]]);
    const pa1 = findPath(a, 0, 1, 5, 1);
    const pb1 = findPath(b, 0, 0, 5, 5);
    const pa2 = findPath(a, 0, 1, 5, 1);
    const pb2 = findPath(b, 0, 0, 5, 5);
    expect(pa2).toEqual(pa1);
    expect(pb2).toEqual(pb1);
  });

  it("grid-size changes between calls are safe (small → large → small)", () => {
    const small = state(4);
    const large = state(25);
    const p1 = findPath(small, 0, 0, 3, 3);
    const p2 = findPath(large, 0, 0, 24, 24);
    const p3 = findPath(small, 0, 0, 3, 3);
    expect(len(p1)).toBe(7);
    expect(len(p2)).toBe(49);
    expect(p3).toEqual(p1);
  });

  it("an unreachable probe leaves no residue for the next search", () => {
    const s = state(5, [[1, 0], [1, 1], [0, 1]]);
    expect(findPath(s, 3, 3, 0, 0)).toBeNull(); // floods most of the grid
    const p = findPath(s, 3, 3, 4, 4)!; // the very next search must be clean
    expect(p.length).toBe(3);
    expect(p[0]).toEqual([3, 3]);
    expect(p.at(-1)).toEqual([4, 4]);
  });
});
