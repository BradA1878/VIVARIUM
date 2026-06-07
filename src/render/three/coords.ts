/* ============================================================================
   Grid ↔ world coordinate mapping. The colony grid is N×N cells; we lay it flat
   on the XZ plane centered at the origin, one world unit per cell, ground at
   y = 0. The isometric *look* comes from the camera (scene.ts), not the data.
   ============================================================================ */
import * as THREE from "three";
import type { BuildingDef } from "@shared/types";

export const CELL = 1;

export class GridSpace {
  constructor(public readonly N: number) {}

  private offset(): number {
    return ((this.N - 1) / 2) * CELL;
  }

  /** world center of a single grid cell */
  cellCenter(gx: number, gy: number): THREE.Vector3 {
    return new THREE.Vector3(gx * CELL - this.offset(), 0, gy * CELL - this.offset());
  }

  /** world center of a building's footprint (its lower-left cell is gx,gy) */
  footprintCenter(def: BuildingDef, gx: number, gy: number): THREE.Vector3 {
    const cx = gx + (def.foot[0] - 1) / 2;
    const cy = gy + (def.foot[1] - 1) / 2;
    return this.cellCenter(cx, cy);
  }

  /** world-space half-extent of the full play grid (for terrain/camera framing) */
  half(): number {
    return (this.N / 2) * CELL;
  }

  /** inverse of cellCenter: a world point → the grid cell containing it */
  worldToCell(p: THREE.Vector3): { gx: number; gy: number } {
    const off = ((this.N - 1) / 2) * CELL;
    return {
      gx: Math.round((p.x + off) / CELL),
      gy: Math.round((p.z + off) / CELL),
    };
  }

  inBounds(gx: number, gy: number): boolean {
    return gx >= 0 && gy >= 0 && gx < this.N && gy < this.N;
  }
}
