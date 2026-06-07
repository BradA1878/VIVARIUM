/* ============================================================================
   Door geometry. A pressure building has one airlock on a local side (def.door);
   rotating the building turns that side. These helpers give the world-space door
   side and the two cells that matter for routing + rendering: the building's own
   edge cell at the door, and the exterior cell a corridor connects to. Pure.
   ============================================================================ */
import type { BuildingDef, BuildingState, Side } from "@shared/types";

/** grid deltas per side: N, E, S, W */
export const SIDE_DELTA: ReadonlyArray<readonly [number, number]> = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
];

/** the world side a building's door faces (local door turned by its rotation) */
export function worldDoorSide(def: BuildingDef, rot: Side): Side | null {
  if (def.door == null) return null;
  return (((def.door + rot) % 4) + 4) % 4 as Side;
}

export interface DoorCells {
  side: Side;
  /** the building's own footprint cell at the door */
  edge: [number, number];
  /** the exterior cell just outside the door (a corridor's connection point) */
  exit: [number, number];
}

/** the door's edge + exit cells for a placed building, or null if it has no door.
 *  For a 2×2 footprint the door sits at the lower-index cell along its side. */
export function doorCells(def: BuildingDef, gx: number, gy: number, rot: Side): DoorCells | null {
  const side = worldDoorSide(def, rot);
  if (side == null) return null;
  const [w, h] = def.foot;
  const [dx, dy] = SIDE_DELTA[side];

  // pick the footprint edge cell on this side (lower-index along the edge)
  let ex = gx, ey = gy;
  switch (side) {
    case 0: ex = gx; ey = gy; break;             // north edge, top-left cell
    case 1: ex = gx + w - 1; ey = gy; break;     // east edge, top cell
    case 2: ex = gx; ey = gy + h - 1; break;     // south edge, left cell
    case 3: ex = gx; ey = gy; break;             // west edge, top cell
  }
  return { side, edge: [ex, ey], exit: [ex + dx, ey + dy] };
}

/** convenience for a live BuildingState */
export function doorCellsOf(def: BuildingDef, b: BuildingState): DoorCells | null {
  return doorCells(def, b.gx, b.gy, (b.rot ?? 0) as Side);
}
