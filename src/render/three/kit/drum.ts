/* ============================================================================
   Battery Bank ("battery") — a squat industrial drum/canister occupying a single
   1×1 cell. Reproduces the prototype's silhouette: a wide short cylinder with a
   brighter top cap and vertical seam ribs, fronted by a column of 3 horizontal
   LED charge bars that light up according to the battery's charge level.

   Build convention (see ./contract): geometry sits around the LOCAL origin with
   the base on y = 0 growing +Y; the renderer positions the group — we never
   translate it. Fully deterministic: no Math.random / Date / assets / network.
   ============================================================================ */
import * as THREE from "three";
import type { BuildingStatus, KitContext, KitMesh, KitBuilder } from "./contract";
import { disposeObject } from "./contract";
import { statusGlow, applyGlow } from "../materials";

export const buildDrum: KitBuilder = (ctx: KitContext): KitMesh => {
  const { cell, materials } = ctx;
  const group = new THREE.Group();

  const radius = cell * 0.36;
  const height = cell * 0.5;

  // --- drum body: wide short cylinder ---------------------------------------
  const bodyMat = materials.metal("#6a727c");
  const body = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 24), bodyMat);
  body.position.y = height / 2;
  body.castShadow = true;
  group.add(body);

  // --- slightly brighter top cap (thin cylinder) ----------------------------
  const capMat = materials.metal("#828a94", { rough: 0.5 });
  const capH = height * 0.08;
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.02, radius * 1.02, capH, 24), capMat);
  cap.position.y = height + capH / 2;
  cap.castShadow = true;
  group.add(cap);

  // --- vertical seam ribs (thin boxes around the circumference) -------------
  const ribMat = materials.metal("#454b53", { rough: 0.7 });
  const ribCount = 6;
  const ribW = radius * 0.08;
  const ribD = radius * 0.12;
  const ribH = height * 0.92;
  const ribGeo = new THREE.BoxGeometry(ribW, ribH, ribD);
  for (let i = 0; i < ribCount; i++) {
    const a = (i / ribCount) * Math.PI * 2;
    const rib = new THREE.Mesh(ribGeo, ribMat);
    rib.position.set(Math.cos(a) * radius, ribH / 2, Math.sin(a) * radius);
    rib.rotation.y = -a;
    rib.castShadow = true;
    group.add(rib);
  }

  // --- 3 horizontal LED charge bars on the front face (+Z) ------------------
  // Each bar gets its OWN glow material so they can be lit independently.
  const barMats: THREE.MeshStandardMaterial[] = [];
  const barW = radius * 0.9;
  const barH = height * 0.14;
  const barD = radius * 0.06;
  const barGeo = new THREE.BoxGeometry(barW, barH, barD);
  const barCount = 3;
  // stack vertically, centered on the body height
  const span = height * 0.6;
  const step = span / barCount;
  const baseY = height / 2 - span / 2 + step / 2;
  for (let i = 0; i < barCount; i++) {
    const mat = materials.glow("#7fd4e8");
    barMats.push(mat);
    const bar = new THREE.Mesh(barGeo, mat);
    bar.position.set(0, baseY + i * step, radius + barD / 2);
    group.add(bar);
  }

  function setStatus(status: BuildingStatus, pulse: number): void {
    const fill = status.fill ?? 0;
    const cyan = statusGlow(true, false);
    const tint = status.hurt ? statusGlow(false, true) : cyan;
    for (let i = 0; i < barCount; i++) {
      const on = fill > (i + 0.5) / barCount;
      applyGlow(barMats[i], tint, on ? 0.6 + 0.4 * pulse : 0.06);
    }
  }

  return {
    object: group,
    setStatus,
    dispose(): void {
      disposeObject(group);
    },
  };
};
