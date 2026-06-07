/* ============================================================================
   Grid helpers — placement geometry over the typed-array occupancy grid.
   ============================================================================ */
import type { BuildingDef } from "@shared/types";
import type { ColonyState } from "./state";

export function idx(N: number, x: number, y: number): number {
  return y * N + x;
}

/** every cell a building of this def at (gx,gy) would occupy */
export function cellsFor(def: BuildingDef, gx: number, gy: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dx = 0; dx < def.foot[0]; dx++)
    for (let dy = 0; dy < def.foot[1]; dy++) out.push([gx + dx, gy + dy]);
  return out;
}

export function inBounds(N: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < N && y < N;
}

export function canPlace(s: ColonyState, def: BuildingDef, gx: number, gy: number): boolean {
  for (const [x, y] of cellsFor(def, gx, gy)) {
    if (!inBounds(s.N, x, y)) return false;
    if (s.grid[idx(s.N, x, y)] !== 0) return false;
  }
  return true;
}
