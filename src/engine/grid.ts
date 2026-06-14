/* ============================================================================
   Grid helpers — placement geometry over the typed-array occupancy grid.
   ============================================================================ */
import type { BuildingDef } from "@shared/types";
import { DEFS } from "./defs";
import type { ColonyState } from "./state";
import { defLocked } from "./unlocks";

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
  if (defLocked(s, def.id)) return false; // the expansion tier is earned, not bought
  if ((def.matCost ?? 0) > s.materials.amount) return false; // can't afford it
  for (const [x, y] of cellsFor(def, gx, gy)) {
    if (!inBounds(s.N, x, y)) return false;
    if (s.grid[idx(s.N, x, y)] !== 0) return false;
  }
  // terrain-restricted: the geothermal tap must cover a vent cell
  if (def.needsVent && !cellsFor(def, gx, gy).some(([x, y]) =>
    s.vents.some((v) => v.gx === x && v.gy === y))) return false;
  // terrain-restricted: the aquifer well must cover an aquifer site
  if (def.needsAquifer && !cellsFor(def, gx, gy).some(([x, y]) =>
    s.aquifers.some((a) => a.gx === x && a.gy === y))) return false;
  return true;
}

/** re-center a colony saved on a smaller build grid into a larger one: shift
 *  every entity by the centering offset, then rebuild the occupancy grid from
 *  the shifted building list (the old grid is discarded). Pure — no RNG — so a
 *  migrated save still replays. A no-op when newN === oldN; grows only (callers
 *  must not shrink below the base's extent). Mutates and returns s. */
export function migrateGrid(s: ColonyState, newN: number): ColonyState {
  const oldN = s.N;
  if (newN === oldN) return s;
  const off = Math.floor((newN - oldN) / 2);
  for (const b of s.buildings) { b.gx += off; b.gy += off; }
  for (const d of s.deposits) { d.gx += off; d.gy += off; }
  for (const v of s.vents) { v.gx += off; v.gy += off; }
  for (const a of s.aquifers ?? []) { a.gx += off; a.gy += off; }
  for (const k of s.colonists) { k.x += off; k.y += off; }
  for (const r of s.rovers ?? []) { r.x += off; r.y += off; }
  for (const r of s.robots ?? []) { r.x += off; r.y += off; }
  s.depot.gx += off; s.depot.gy += off;
  if (s.ufo) { s.ufo.gx += off; s.ufo.gy += off; }
  if (s.trade) { s.trade.gx += off; s.trade.gy += off; }
  const grid = new Int32Array(newN * newN);
  for (const b of s.buildings) {
    const def = DEFS[b.defId];
    if (!def) continue;
    for (const [x, y] of cellsFor(def, b.gx, b.gy))
      if (inBounds(newN, x, y)) grid[idx(newN, x, y)] = b.uid;
  }
  s.grid = grid;
  s.N = newN;
  return s;
}

/** remove a building by uid: clear its grid cells + drop it from the list.
 *  Caller is responsible for recomputeCaps(). Returns the defId removed, or null. */
export function removeBuilding(s: ColonyState, uid: number): string | null {
  const b = s.buildings.find((x) => x.uid === uid);
  if (!b) return null;
  const def = DEFS[b.defId];
  if (def) for (const [x, y] of cellsFor(def, b.gx, b.gy)) s.grid[idx(s.N, x, y)] = 0;
  s.buildings = s.buildings.filter((x) => x.uid !== uid);
  return b.defId;
}
