/* ============================================================================
   The building-kit contract. Each builder turns a BuildingDef into a procedural
   THREE.Object3D reproducing the prototype's silhouette (render.js), plus a
   setStatus() that drives its status glow and a dispose(). A GLTFLoader-backed
   builder can implement this same interface later to drop in real .glb assets
   with no call-site changes (doc §1 deviation note).

   Convention: build geometry around the local origin with the structure's base
   sitting on y = 0 and growing +Y. The renderer positions the group at the
   building's footprint center and never rotates it. Size to the footprint using
   ctx.cell × ctx.def.foot.
   ============================================================================ */
import * as THREE from "three";
import type { BuildingDef } from "@shared/types";
import type { MaterialLib } from "../materials";

export interface BuildingStatus {
  /** online + connected + staffed + fed */
  alive: boolean;
  /** offline for a reason the player should notice (no seal / staff / feed / power) */
  hurt: boolean;
  /** 0..1, e.g. battery charge for the drum LEDs or pool fill */
  fill?: number;
}

export interface KitContext {
  materials: MaterialLib;
  def: BuildingDef;
  /** world units per grid cell */
  cell: number;
  /** stable per-building seed for greeble variation (use instead of Math.random) */
  seed: number;
}

/** per-frame world context the renderer hands every kit; builders that ignore
 *  it simply don't declare the parameter (structural typing keeps them valid) */
export interface KitEnv {
  /** 0 = full day → 1 = deep night (scene.ts nightLevel) */
  night: number;
}

export interface KitMesh {
  /** positioned by the renderer at the footprint center, base on the ground */
  object: THREE.Object3D;
  /** called each frame with current status + a 0..1 pulse phase for glows */
  setStatus(status: BuildingStatus, pulse: number, env?: KitEnv): void;
  /** corridors only: a 4-bit mask (N=1,E=2,S=4,W=8) of connected neighbours, so
   *  the mesh can orient as straight / elbow / T / cross / end-cap */
  setNeighbors?(mask: number): void;
  dispose(): void;
}

export type KitBuilder = (ctx: KitContext) => KitMesh;

/** deterministic per-building RNG for greebles (mulberry32) */
export function greebleRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    let a = (s += 0x6d2b79f5);
    a = Math.imul(a ^ (a >>> 15), 1 | a);
    a ^= a + Math.imul(a ^ (a >>> 7), 61 | a);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}

/** dispose every geometry/material under an object — call from KitMesh.dispose */
export function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = (mesh as THREE.Mesh).material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) (mat as THREE.Material).dispose();
  });
}
