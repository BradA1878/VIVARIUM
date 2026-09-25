/* ============================================================================
   Small seeded pebbles scattered across the build area — pure ground clutter.
   One InstancedMesh, tinted per-instance from the world's rock color so it
   reads as loose scree rather than a repeated stamp. Too small to cast a
   useful shadow, so it skips that draw; it still receives the terrain's.
   Terrain builds it over the build area and its border and owns its disposal.
   ============================================================================ */
import * as THREE from "three";
import { greebleRng } from "./kit/contract";

export const PEBBLE_COUNT = 1500;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

// InstancedMesh stores instanceMatrix in a Float32Array, so a scale clamped
// flush to an edge can round either way on read-back (~1e-9 either side).
// Keep jittered scale a hair inside [0.03, 0.09] so that storage round-trip
// never pushes it outside the nominal range.
const SCALE_MIN = 0.03, SCALE_MAX = 0.09, SCALE_EDGE = 1e-4;

/** Scatter `count` small rocks over [-extent, extent] on x and z, resting on
 *  heightAt(x, z). Seeded from look.rockSeed, so the field is identical every
 *  time the same world is built. Geometry and material belong to the returned
 *  mesh — the caller disposes both when it disposes the mesh. */
export function buildPebbles(
  heightAt: (x: number, z: number) => number,
  extent: number,
  look: { rockSeed: number; rockColor: number },
  count = PEBBLE_COUNT,
): THREE.InstancedMesh {
  const rng = greebleRng(look.rockSeed ^ 0x9eb1);

  const geo = new THREE.IcosahedronGeometry(1, 0);
  geo.scale(1, 0.6, 1);
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.InstancedMesh(geo, mat, count);
  mesh.name = "pebbles";
  mesh.castShadow = false;
  mesh.receiveShadow = true;

  const rockColor = new THREE.Color(look.rockColor);
  const tint = new THREE.Color();
  const dummy = new THREE.Object3D();

  for (let i = 0; i < count; i++) {
    const x = (rng() * 2 - 1) * extent;
    const z = (rng() * 2 - 1) * extent;
    const s = SCALE_MIN + 0.06 * rng() ** 3;
    const sx = clamp(s + (rng() - 0.5) * 0.02, SCALE_MIN + SCALE_EDGE, SCALE_MAX - SCALE_EDGE);
    const sz = clamp(s + (rng() - 0.5) * 0.02, SCALE_MIN + SCALE_EDGE, SCALE_MAX - SCALE_EDGE);

    dummy.position.set(x, heightAt(x, z) + 0.2 * s * 0.6, z);
    dummy.rotation.set((rng() - 0.5) * 0.3, rng() * Math.PI * 2, (rng() - 0.5) * 0.3);
    dummy.scale.set(sx, s, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);

    tint.copy(rockColor).multiplyScalar(0.8 + 0.4 * rng());
    mesh.setColorAt(i, tint);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  return mesh;
}
