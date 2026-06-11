/* ============================================================================
   AlienShip — the trader saucer that appears while snap.trade is non-null. A
   flattened hull sphere + a glowing torus rim + a teal/purple dome, with a
   tractor-beam cone toward the ground. The renderer drives it by phase:
     inbound — descend from high altitude down to hover
     landed  — hover with a gentle bob, beam glowing
     leaving — rise back up, beam fading
   Procedural + disposable; the renderer creates it on first trade and disposes
   it when trade returns to null.
   ============================================================================ */
import * as THREE from "three";
import type { TradePhase } from "@shared/types";
import { disposeObject } from "./kit/contract";

const HOVER_Y = 1.9;   // resting altitude above the ground
const HIGH_Y = 9.0;    // entry/exit altitude

export interface AlienShipMesh {
  object: THREE.Group;
  /** advance the descent/hover/ascent animation; dt in seconds */
  update(phase: TradePhase, dt: number, now: number): void;
  dispose(): void;
}

export function buildAlienShip(): AlienShipMesh {
  const object = new THREE.Group();
  object.position.y = HIGH_Y;

  // --- hull: a flattened sphere ----------------------------------------------
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x2a2440,
    roughness: 0.4,
    metalness: 0.75,
    emissive: 0x140e26,
    emissiveIntensity: 0.5,
  });
  const hullGeo = new THREE.SphereGeometry(0.7, 24, 16);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.scale.set(1, 0.32, 1);
  hull.castShadow = true;
  object.add(hull);

  // --- glowing rim torus ------------------------------------------------------
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x10202a,
    emissive: 0x9b6cff,
    emissiveIntensity: 1.1,
    roughness: 0.3,
    metalness: 0.4,
  });
  const rimGeo = new THREE.TorusGeometry(0.66, 0.09, 10, 32);
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = Math.PI / 2;
  object.add(rim);

  // --- canopy dome ------------------------------------------------------------
  const domeMat = new THREE.MeshStandardMaterial({
    color: 0x3fe0d0,
    emissive: 0x1f9c92,
    emissiveIntensity: 0.7,
    roughness: 0.2,
    metalness: 0.3,
    transparent: true,
    opacity: 0.85,
  });
  const domeGeo = new THREE.SphereGeometry(0.32, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.position.y = 0.16;
  object.add(dome);

  // --- tractor beam cone toward the ground -----------------------------------
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0x9b6cff,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  // cone with apex at the ship, widening to the ground; height set per-frame
  const beamGeo = new THREE.ConeGeometry(0.55, 1, 20, 1, true);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  object.add(beam);

  // --- landing struts: a deploy flourish while landed. The ship keeps hovering
  // (no ground contact) — they fold flat against the hull rim and swing ~40°
  // down-and-out with a slight extension as `deploy01` rises.
  const strutMat = new THREE.MeshStandardMaterial({
    color: 0x3a3354,
    roughness: 0.5,
    metalness: 0.7,
    emissive: 0x140e26,
    emissiveIntensity: 0.4,
  });
  const STRUT_LEN = 0.4;
  const strutGeo = new THREE.CylinderGeometry(0.025, 0.018, STRUT_LEN, 6);
  const struts: { hinge: THREE.Group; leg: THREE.Mesh }[] = [];
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Group();
    arm.rotation.y = (i / 3) * Math.PI * 2;
    const hinge = new THREE.Group();
    hinge.position.set(0.5, -0.08, 0); // on the hull rim, just under the skin
    const leg = new THREE.Mesh(strutGeo, strutMat);
    leg.rotation.z = -Math.PI / 2; // cylinder axis → hinge-local +X (outward)
    leg.position.x = (STRUT_LEN / 2) * 0.7;
    hinge.add(leg);
    arm.add(hinge);
    object.add(arm);
    struts.push({ hinge, leg });
  }
  let deploy01 = 0;

  // --- ground glow disc, pinned to the pad while the struts are out -----------
  const padMat = new THREE.MeshBasicMaterial({
    color: 0x9b6cff,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const padGeo = new THREE.CircleGeometry(0.9, 28);
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.rotation.x = -Math.PI / 2;
  pad.renderOrder = 10;
  object.add(pad);

  return {
    object,
    update(phase, dt, now) {
      // ease the altitude toward the phase target
      const targetY = phase === "leaving" ? HIGH_Y : HOVER_Y;
      const k = phase === "inbound" ? 2.2 * dt : phase === "leaving" ? 1.6 * dt : 1;
      if (phase === "landed") {
        object.position.y = HOVER_Y + Math.sin(now / 600) * 0.08;
      } else {
        object.position.y += (targetY - object.position.y) * Math.min(1, k);
      }

      // slow spin of the rim glow
      rim.rotation.z = now / 1400;
      const rimPulse = 0.8 + 0.4 * (0.5 + 0.5 * Math.sin(now / 400));
      rimMat.emissiveIntensity = rimPulse;

      // tractor beam: bright when landed, fades while moving
      const groundGap = object.position.y; // ground is world y=0
      const beamH = Math.max(0.2, groundGap);
      beam.scale.y = beamH;
      beam.position.y = -beamH / 2;
      const landedness = phase === "landed" ? 1 : phase === "inbound" ? 0.25 : 0.0;
      beamMat.opacity = (0.18 + 0.12 * (0.5 + 0.5 * Math.sin(now / 250))) * landedness;

      // struts swing out while landed, fold back for flight
      deploy01 += ((phase === "landed" ? 1 : 0) - deploy01) * Math.min(1, 3 * dt);
      const ext = 0.7 + 0.3 * deploy01; // slight extension as they deploy
      for (const s of struts) {
        s.hinge.rotation.z = -0.7 * deploy01; // 0 (flat) → ~40° down-and-out
        s.leg.scale.y = ext;
        s.leg.position.x = (STRUT_LEN / 2) * ext;
      }

      // pad glow pinned at world y≈0.03, fading with the landed factor
      pad.position.y = 0.03 - object.position.y;
      padMat.opacity = (0.14 + 0.05 * (0.5 + 0.5 * Math.sin(now / 500))) * deploy01;
      pad.visible = deploy01 > 0.01;
    },
    dispose() {
      disposeObject(object);
    },
  };
}
