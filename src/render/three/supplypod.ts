/* ============================================================================
   SupplyPod — the Earth-resupply lander that descends while a resupply window is
   open (snap.resupplyT > 0). A blunt capsule on splayed legs under a translucent
   ballute canopy, with a retro-thruster glow on the way down and a slow strobe
   beacon once settled. The renderer drives it by phase, mirroring the alien
   ship's lifecycle: it creates the pod when a window opens, animates the descent
   / sit, and disposes it when the window closes.

   Phases:
     inbound — drop from high altitude to the pad, retros lit, canopy full
     landed  — sit with a faint settle bob, canopy furled, beacon strobing
   Procedural + disposable.
   ============================================================================ */
import * as THREE from "three";
import { disposeObject } from "./kit/contract";

export type PodPhase = "inbound" | "landed";

const HIGH_Y = 8.5;    // entry altitude
const LAND_Y = 0;      // legs touch the ground (capsule offset built in)

export interface SupplyPodMesh {
  object: THREE.Group;
  /** advance the descent/settle animation; dt in seconds */
  update(phase: PodPhase, dt: number, now: number): void;
  dispose(): void;
}

export function buildSupplyPod(): SupplyPodMesh {
  const object = new THREE.Group();
  object.position.y = HIGH_Y;

  // --- capsule body: a blunt cone-frustum hull with a domed top --------------
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0xb8bcc2, // bare aluminium — an Earth craft, not the saucer's purple
    roughness: 0.45,
    metalness: 0.7,
  });
  const bodyGeo = new THREE.CylinderGeometry(0.26, 0.42, 0.5, 16, 1);
  const body = new THREE.Mesh(bodyGeo, hullMat);
  body.position.y = 0.42; // base of the frustum sits above the legs
  body.castShadow = true;
  object.add(body);

  const capGeo = new THREE.SphereGeometry(0.26, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  const cap = new THREE.Mesh(capGeo, hullMat);
  cap.position.y = 0.67;
  cap.castShadow = true;
  object.add(cap);

  // a scorched heat-shield band around the wide base
  const bandMat = new THREE.MeshStandardMaterial({
    color: 0x3a2c24, roughness: 0.9, metalness: 0.2,
  });
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.1, 16), bandMat);
  band.position.y = 0.2;
  object.add(band);

  // --- landing legs: three splayed struts with foot pads ----------------------
  const legMat = new THREE.MeshStandardMaterial({
    color: 0x6a7078, roughness: 0.5, metalness: 0.7,
  });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.42, 6), legMat);
    leg.position.set(Math.cos(a) * 0.3, 0.16, Math.sin(a) * 0.3);
    leg.rotation.z = Math.cos(a) * 0.5;
    leg.rotation.x = -Math.sin(a) * 0.5;
    leg.castShadow = true;
    object.add(leg);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.03, 8), legMat);
    pad.position.set(Math.cos(a) * 0.42, 0.015, Math.sin(a) * 0.42);
    object.add(pad);
  }

  // --- ballute canopy: a translucent dome high above, furling on landing ------
  const canopyMat = new THREE.MeshBasicMaterial({
    color: 0xe6e2d8,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const canopyGeo = new THREE.SphereGeometry(0.7, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  object.add(canopy);

  // --- retro-thruster glow under the base, lit while descending --------------
  const retroMat = new THREE.MeshBasicMaterial({
    color: 0xffb060,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const retroGeo = new THREE.ConeGeometry(0.34, 0.7, 16, 1, true);
  const retro = new THREE.Mesh(retroGeo, retroMat);
  retro.position.y = -0.15; // apex up at the base, plume hanging down
  retro.rotation.x = Math.PI; // widen toward the ground
  object.add(retro);

  // --- landing beacon: a small emissive node that strobes once settled --------
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0x101418, emissive: 0xff6a4a, emissiveIntensity: 0.0,
    roughness: 0.4,
  });
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), beaconMat);
  beacon.position.y = 0.95;
  object.add(beacon);

  // --- ground glow disc, pinned to the pad while settled ----------------------
  const padGlowMat = new THREE.MeshBasicMaterial({
    color: 0xffb060,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const padGlow = new THREE.Mesh(new THREE.CircleGeometry(0.8, 24), padGlowMat);
  padGlow.rotation.x = -Math.PI / 2;
  padGlow.renderOrder = 10;
  object.add(padGlow);

  let settle01 = 0; // 0 in flight → 1 fully landed (drives canopy furl + beacon)

  return {
    object,
    update(phase, dt, now) {
      const targetY = phase === "landed" ? LAND_Y : HIGH_Y;
      if (phase === "inbound") {
        // ease the drop down toward the pad
        object.position.y += (LAND_Y - object.position.y) * Math.min(1, 2.0 * dt);
      } else {
        // settled: snap to the pad with a faint touchdown bob
        object.position.y = LAND_Y + Math.max(0, Math.sin(now / 700)) * 0.015;
      }
      void targetY;

      settle01 += ((phase === "landed" ? 1 : 0) - settle01) * Math.min(1, 2.5 * dt);
      const aloft = 1 - settle01;

      // canopy: full + visible while dropping, furls (scales down + fades) on land
      const cScale = 0.5 + 0.5 * aloft;
      canopy.scale.set(cScale, cScale, cScale);
      canopy.position.y = 1.0 + 0.4 * aloft;
      canopyMat.opacity = 0.32 * aloft;

      // retro plume: bright while descending and near the ground, fades when down
      const nearGround = Math.max(0, 1 - object.position.y / 2.5);
      retroMat.opacity = aloft * nearGround * (0.4 + 0.25 * (0.5 + 0.5 * Math.sin(now / 60)));

      // beacon strobes once settled
      const strobe = settle01 * (Math.sin(now / 180) > 0.7 ? 1 : 0.05);
      beaconMat.emissiveIntensity = 1.6 * strobe;

      // pad glow pinned at world y≈0.03, blooming as it settles
      padGlow.position.y = 0.03 - object.position.y;
      padGlowMat.opacity = settle01 * (0.12 + 0.05 * (0.5 + 0.5 * Math.sin(now / 500)));
      padGlow.visible = settle01 > 0.01;
    },
    dispose() {
      disposeObject(object);
    },
  };
}
