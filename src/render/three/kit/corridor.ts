/* ============================================================================
   Corridor — a low, frosted, pressurized connector tube that carries the seal
   between the hub and habitats. Occupies a single 1×1 cell. Silhouette: a low
   half-cylinder (quonset segment) with a faint cyan-lit interior and thin metal
   rib bands. alive ≈ connected (sealed); when unsealed it reads dim.
   ============================================================================ */
import * as THREE from "three";
import type { KitBuilder, KitMesh, BuildingStatus } from "./contract";
import { disposeObject } from "./contract";
import { statusGlow, applyGlow } from "../materials";

export const buildCorridor: KitBuilder = (ctx): KitMesh => {
  const cell = ctx.cell;
  const length = cell * 0.98;
  const radius = cell * 0.34;

  const group = new THREE.Group();

  // --- Frosted tube skin: an open half-cylinder arch spanning the cell. -------
  // CylinderGeometry's axis is +Y; rotate -90° about Z so the axis runs along X.
  // thetaLength = PI gives a half-cylinder; orient so the flat edge faces down.
  const skinMat = ctx.materials.frostedDome();
  skinMat.transparent = true;
  skinMat.opacity = 0.55;
  skinMat.side = THREE.DoubleSide;

  const tubeGeo = new THREE.CylinderGeometry(
    radius,
    radius,
    length,
    24,
    1,
    true, // open ended — it's a tube/arch
    0, // thetaStart
    Math.PI, // thetaLength — half cylinder
  );
  const tube = new THREE.Mesh(tubeGeo, skinMat);
  // Lay the axis along X, then rotate about X so the arch opens upward.
  tube.rotation.z = -Math.PI / 2;
  tube.rotation.y = Math.PI / 2;
  tube.position.y = 0; // flat edge sits on the ground, arch grows +Y
  tube.castShadow = true;
  tube.receiveShadow = true;
  group.add(tube);

  // --- Rib bands: thin metal tori hooping the arch at intervals. --------------
  const ribMat = ctx.materials.metal();
  const ribCount = 3;
  for (let i = 0; i < ribCount; i++) {
    const ribGeo = new THREE.TorusGeometry(radius * 1.01, radius * 0.045, 8, 24, Math.PI);
    const rib = new THREE.Mesh(ribGeo, ribMat);
    // Torus lies in its local XY plane; rotate so its plane is the tube's YZ
    // cross-section (normal along X), arch opening up.
    rib.rotation.y = Math.PI / 2;
    // Distribute along the tube length (ribCount > 1).
    const t = i / (ribCount - 1);
    rib.position.x = THREE.MathUtils.lerp(-length * 0.42, length * 0.42, t);
    rib.castShadow = true;
    group.add(rib);
  }

  // --- Faint cyan interior glow strip running the length of the tube. ---------
  const glowMat = ctx.materials.glow("#7fd4e8");
  const stripGeo = new THREE.BoxGeometry(length * 0.92, radius * 0.04, radius * 0.18);
  const strip = new THREE.Mesh(stripGeo, glowMat);
  strip.position.y = radius * 0.12; // a little above the floor, inside the arch
  group.add(strip);

  return {
    object: group,
    setStatus(status: BuildingStatus, pulse: number): void {
      applyGlow(glowMat, statusGlow(status.alive, status.hurt), 0.2 + 0.4 * pulse);
    },
    dispose(): void {
      disposeObject(group);
    },
  };
};
