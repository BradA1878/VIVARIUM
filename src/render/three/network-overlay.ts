/* ============================================================================
   Network overlay — flat ground tiles showing which cells are on the sealed
   pressure network and which sealed buildings are cut off from it (design
   doc 2026-09-26-pressure-network-design.md §4). Two InstancedMeshes share
   one plane geometry: dim cyan under the connected network (hubs, corridors,
   and sealed buildings the flood reaches), rust under a sealed building that
   is not connected. Surface buildings never appear — the `connected` flag
   means nothing for them.

   This module renders the engine's own `connected` flag; it does not
   recompute connectivity itself. The renderer shows it only while a build
   tool is up. sync() rebuilds only when the relevant buildings' uid,
   position, or connected state actually changed, so an unrelated snapshot
   change (a resource tick, an unrelated colonist moving) is a no-op.
   ============================================================================ */
import * as THREE from "three";
import { DEFS } from "@/engine";
import type { BuildingState } from "@shared/types";
import { CELL, GridSpace } from "./coords";

export interface OverlayCell {
  gx: number;
  gy: number;
  ok: boolean;
}

const OK_COLOR = "#7fd4e8";
const OK_OPACITY = 0.18;
const BAD_COLOR = "#e8784f";
const BAD_OPACITY = 0.32;
const TILE_Y = 0.025;

/** true for a def whose cells carry the seal: a hub, a conduit (corridor), or
 *  any sealed (requiresPressure) building — the only defs the overlay ever
 *  marks, in either color. */
function isNetworkMember(defId: string): boolean {
  const def = DEFS[defId];
  return !!def && (def.isHub === true || def.conduit === true || def.requiresPressure === true);
}

/** Every footprint cell a building contributes to the overlay: ok when it is
 *  on the connected network (a hub, a conduit, or a connected sealed
 *  building); not ok when it is a sealed building that is not connected.
 *  A surface building contributes nothing, connected or not — the flag is
 *  meaningless for it. */
export function overlayCells(buildings: readonly BuildingState[]): OverlayCell[] {
  const cells: OverlayCell[] = [];
  for (const b of buildings) {
    const def = DEFS[b.defId];
    if (!def) continue;
    const ok = b.connected && isNetworkMember(b.defId);
    const bad = !b.connected && def.requiresPressure === true;
    if (!ok && !bad) continue;
    for (let dx = 0; dx < def.foot[0]; dx++)
      for (let dy = 0; dy < def.foot[1]; dy++) cells.push({ gx: b.gx + dx, gy: b.gy + dy, ok });
  }
  return cells;
}

/** A rebuild key from only the buildings that can ever put a cell on the
 *  overlay, and only the fields that change what they'd draw — position and
 *  connectivity. Anything else in the snapshot changing is a no-op sync. */
function overlayKey(buildings: readonly BuildingState[]): string {
  let key = "";
  for (const b of buildings) {
    if (!isNetworkMember(b.defId)) continue;
    key += `${b.uid}:${b.gx}:${b.gy}:${b.connected}|`;
  }
  return key;
}

export class NetworkOverlay {
  readonly group = new THREE.Group();

  private geo: THREE.PlaneGeometry;
  private okMat: THREE.MeshBasicMaterial;
  private badMat: THREE.MeshBasicMaterial;
  private okMesh: THREE.InstancedMesh;
  private badMesh: THREE.InstancedMesh;
  private lastKey = "";

  constructor(private grid: GridSpace) {
    this.group.name = "network-overlay";
    this.group.visible = false;

    this.geo = new THREE.PlaneGeometry(CELL * 0.96, CELL * 0.96).rotateX(-Math.PI / 2);
    this.okMat = new THREE.MeshBasicMaterial({
      color: OK_COLOR, transparent: true, opacity: OK_OPACITY, depthWrite: false,
    });
    this.badMat = new THREE.MeshBasicMaterial({
      color: BAD_COLOR, transparent: true, opacity: BAD_OPACITY, depthWrite: false,
    });

    const capacity = grid.N * grid.N;
    this.okMesh = new THREE.InstancedMesh(this.geo, this.okMat, capacity);
    this.badMesh = new THREE.InstancedMesh(this.geo, this.badMat, capacity);
    this.okMesh.name = "network-overlay-ok";
    this.badMesh.name = "network-overlay-bad";
    this.okMesh.count = 0;
    this.badMesh.count = 0;
    this.okMesh.userData.noAO = true; // an overlay marker: no AO shadow on the ground
    this.badMesh.userData.noAO = true;
    this.group.add(this.okMesh, this.badMesh);
  }

  setVisible(on: boolean): void {
    this.group.visible = on;
  }

  /** Rebuild the two instanced meshes from the current buildings, but only
   *  when the relevant buildings actually changed position or connectivity. */
  sync(buildings: readonly BuildingState[]): void {
    const key = overlayKey(buildings);
    if (key === this.lastKey) return;
    this.lastKey = key;

    const cells = overlayCells(buildings);
    this.write(this.okMesh, cells.filter((c) => c.ok));
    this.write(this.badMesh, cells.filter((c) => !c.ok));
  }

  private write(mesh: THREE.InstancedMesh, cells: OverlayCell[]): void {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < cells.length; i++) {
      const c = this.grid.cellCenter(cells[i].gx, cells[i].gy);
      dummy.position.set(c.x, TILE_Y, c.z);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.count = cells.length;
    mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.okMat.dispose();
    this.badMat.dispose();
  }
}
