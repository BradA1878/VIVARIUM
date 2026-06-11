/* ============================================================================
   Main-thread placement prediction. The worker is authoritative on actual
   placement (doc §0), but the renderer needs synchronous, per-frame answers for
   the ghost preview ("would this fit here?"). These pure helpers compute that
   from the latest Snapshot — no worker round-trip, no engine state leaked.
   ============================================================================ */
import type { BuildingState, Snapshot } from "@shared/types";
import { DEFS } from "./defs";
import { cellsFor } from "./grid";

/** occupancy set keyed "x,y" built from a snapshot's buildings */
export function occupancy(snap: Snapshot): Set<string> {
  const occ = new Set<string>();
  for (const b of snap.buildings) {
    const def = DEFS[b.defId];
    if (!def) continue;
    for (const [x, y] of cellsFor(def, b.gx, b.gy)) occ.add(`${x},${y}`);
  }
  return occ;
}

export function canPlacePredict(
  snap: Snapshot, defId: string, gx: number, gy: number, occ?: Set<string>,
): boolean {
  const def = DEFS[defId];
  if (!def) return false;
  if ((def.matCost ?? 0) > snap.materials.amount) return false; // can't afford it
  const o = occ ?? occupancy(snap);
  for (const [x, y] of cellsFor(def, gx, gy)) {
    if (x < 0 || y < 0 || x >= snap.N || y >= snap.N) return false;
    if (o.has(`${x},${y}`)) return false;
  }
  // terrain-restricted (mirrors grid.ts): geothermal must cover a vent cell
  if (def.needsVent && !cellsFor(def, gx, gy).some(([x, y]) =>
    snap.vents.some((v) => v.gx === x && v.gy === y))) return false;
  return true;
}

/** can building `uid` be relocated to (gx,gy)? (its own cells don't block it) */
export function canMovePredict(snap: Snapshot, uid: number, gx: number, gy: number): boolean {
  const b = snap.buildings.find((x) => x.uid === uid);
  if (!b) return false;
  const def = DEFS[b.defId];
  if (!def) return false;
  const occ = occupancy(snap);
  for (const [x, y] of cellsFor(def, b.gx, b.gy)) occ.delete(`${x},${y}`); // ignore self
  for (const [x, y] of cellsFor(def, gx, gy)) {
    if (x < 0 || y < 0 || x >= snap.N || y >= snap.N) return false;
    if (occ.has(`${x},${y}`)) return false;
  }
  return true;
}

export function buildingAtPredict(snap: Snapshot, gx: number, gy: number): BuildingState | null {
  for (const b of snap.buildings) {
    const def = DEFS[b.defId];
    if (!def) continue;
    for (const [x, y] of cellsFor(def, b.gx, b.gy)) {
      if (x === gx && y === gy) return b;
    }
  }
  return null;
}
