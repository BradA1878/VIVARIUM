/* ============================================================================
   Astronaut — a low-poly EVA figure, one per colonist. Built to actually READ as
   an astronaut at iso scale: a bulky white suit torso, two arms and two legs (so
   it's a figure, not a pill), a round helmet with a clear dark visor on the FRONT
   (+Z), a life-support backpack on the BACK (−Z), and a little antenna. The figure
   faces local +Z; the renderer sets group.rotation.y = colonist.facing (atan2(dx,dy)
   in grid space, which maps directly because grid +x→world +x, grid +y→world +z).

   The possessed colonist gets a bright cyan ground ring and a brighter emissive
   suit; a carried resource floats as a glowing cube above the head. Everything is
   procedural and disposable — the renderer owns the per-id lifecycle, this owns the
   geometry/material lifetime via dispose().
   ============================================================================ */
import * as THREE from "three";
import type { DepositKind } from "@shared/types";
import { disposeObject } from "./contract";

/** carry-cube tint by deposit kind */
const CARRY_COLOR: Record<DepositKind, number> = {
  ice: 0x7fd4e8,
  ore: 0xe0913a,
  cache: 0x6fcf7f,
};

export interface AstronautMesh {
  /** the root, positioned by the renderer in world space (feet ~ y=0) */
  object: THREE.Group;
  /** the inner figure the renderer bobs/turns (so the root stays at ground) */
  body: THREE.Group;
  /** drive per-frame look: possessed ring/emissive + carry cube */
  setState(possessed: boolean, carryKind: DepositKind | null, pulse: number): void;
  dispose(): void;
}

export function buildAstronaut(): AstronautMesh {
  const object = new THREE.Group();
  const body = new THREE.Group();
  object.add(body);

  // --- materials (one set per astronaut; disposed on removal) ----------------
  const suitMat = new THREE.MeshStandardMaterial({
    color: 0xeef1f4, roughness: 0.6, metalness: 0.12,
    emissive: 0x223036, emissiveIntensity: 0.0,
  });
  const trimMat = new THREE.MeshStandardMaterial({ // boots, joints, chest panel
    color: 0x3a4048, roughness: 0.7, metalness: 0.4,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x0b1318, roughness: 0.18, metalness: 0.7,
    emissive: 0x2c4a55, emissiveIntensity: 0.65,
  });
  const packMat = new THREE.MeshStandardMaterial({
    color: 0x9aa2ac, roughness: 0.55, metalness: 0.55,
  });
  const accentMat = new THREE.MeshStandardMaterial({ // antenna tip
    color: 0x7fd4e8, emissive: 0x7fd4e8, emissiveIntensity: 1.0, roughness: 0.4,
  });
  const carryMat = new THREE.MeshStandardMaterial({
    color: 0x7fd4e8, emissive: 0x7fd4e8, emissiveIntensity: 1.0,
    roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.92,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7fd4e8, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
  });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    body.add(m);
    return m;
  };

  // --- legs + boots (feet at y≈0) --------------------------------------------
  for (const sx of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.05, 0.12, 3, 6), suitMat, sx * 0.07, 0.13, 0);
    add(new THREE.BoxGeometry(0.1, 0.05, 0.13), trimMat, sx * 0.07, 0.03, 0.015); // boot
  }

  // --- torso: a bulky EVA suit (wider than tall reads "suited") ---------------
  const torso = add(new THREE.CapsuleGeometry(0.135, 0.13, 5, 10), suitMat, 0, 0.34, 0);
  torso.scale.set(1.05, 1, 0.85);
  add(new THREE.BoxGeometry(0.11, 0.1, 0.04), trimMat, 0, 0.32, 0.12, false); // chest panel

  // --- shoulders + arms (angled slightly out) --------------------------------
  for (const sx of [-1, 1]) {
    add(new THREE.SphereGeometry(0.06, 8, 8), suitMat, sx * 0.155, 0.43, 0); // shoulder
    const arm = add(new THREE.CapsuleGeometry(0.045, 0.16, 3, 6), suitMat, sx * 0.18, 0.31, 0);
    arm.rotation.z = sx * 0.22;
    add(new THREE.SphereGeometry(0.05, 8, 8), trimMat, sx * 0.2, 0.21, 0); // glove
  }

  // --- neck → helmet ---------------------------------------------------------
  add(new THREE.CylinderGeometry(0.055, 0.07, 0.05, 8), trimMat, 0, 0.46, 0, false);
  const helmet = add(new THREE.SphereGeometry(0.115, 14, 12), suitMat, 0, 0.57, 0);
  helmet.scale.set(1, 0.95, 1);

  // --- visor: a dark reflective lens across the FRONT of the helmet -----------
  const visor = add(new THREE.SphereGeometry(0.1, 14, 12), visorMat, 0, 0.565, 0.045, false);
  visor.scale.set(0.92, 0.62, 0.55);

  // --- antenna ---------------------------------------------------------------
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 5), trimMat, 0.07, 0.69, -0.02, false);
  add(new THREE.SphereGeometry(0.018, 8, 8), accentMat, 0.07, 0.74, -0.02, false);

  // --- life-support backpack on the BACK (−Z) --------------------------------
  add(new THREE.BoxGeometry(0.21, 0.26, 0.1), packMat, 0, 0.35, -0.14);

  // --- possessed ground ring (on the root, so it stays flat + un-bobbed) ------
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.22, 0.32, 24), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.visible = false;
  object.add(ring);

  // --- carry cube above the head (hidden unless carrying) --------------------
  const carry = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), carryMat);
  carry.position.y = 0.84;
  carry.visible = false;
  body.add(carry);

  return {
    object,
    body,
    setState(possessed, carryKind, pulse) {
      ring.visible = possessed;
      if (possessed) {
        ringMat.opacity = 0.55 + 0.35 * pulse;
        suitMat.emissive.setHex(0x2f6f7a);
        suitMat.emissiveIntensity = 0.35 + 0.25 * pulse;
      } else {
        suitMat.emissiveIntensity = 0.0;
      }
      if (carryKind) {
        carry.visible = true;
        const col = CARRY_COLOR[carryKind];
        carryMat.color.setHex(col);
        carryMat.emissive.setHex(col);
        carryMat.emissiveIntensity = 0.7 + 0.4 * pulse;
      } else {
        carry.visible = false;
      }
    },
    dispose() {
      disposeObject(object);
    },
  };
}
