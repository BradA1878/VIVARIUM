/* ============================================================================
   Astronaut — a low-poly EVA figure, one per colonist. A white capsule torso, a
   small visor-helmet sphere (faint emissive, on the FRONT so heading reads), and
   a backpack box (on the BACK). The figure is built so its local +Z is "forward":
   the renderer sets group.rotation.y = colonist.facing (facing = atan2(dx,dy) in
   grid space, which maps directly because grid +x→world +x, grid +y→world +z).

   The possessed colonist gets a bright cyan ground ring and a brighter emissive
   skin; a carried resource floats as a glowing cube above the head. Everything is
   procedural and disposable — the renderer owns the per-id lifecycle, this owns
   the geometry/material lifetime via dispose().
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
    color: 0xeef1f4,
    roughness: 0.55,
    metalness: 0.15,
    emissive: 0x223036,
    emissiveIntensity: 0.0,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x0c1418,
    roughness: 0.25,
    metalness: 0.5,
    emissive: 0x2c4a55,
    emissiveIntensity: 0.6,
  });
  const packMat = new THREE.MeshStandardMaterial({
    color: 0x8a929c,
    roughness: 0.6,
    metalness: 0.6,
  });
  const carryMat = new THREE.MeshStandardMaterial({
    color: 0x7fd4e8,
    emissive: 0x7fd4e8,
    emissiveIntensity: 1.0,
    roughness: 0.4,
    metalness: 0.1,
    transparent: true,
    opacity: 0.92,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7fd4e8,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });

  // --- torso: a capsule, feet near y=0 ---------------------------------------
  const torsoGeo = new THREE.CapsuleGeometry(0.13, 0.26, 4, 8);
  const torso = new THREE.Mesh(torsoGeo, suitMat);
  torso.position.y = 0.26;
  torso.castShadow = true;
  body.add(torso);

  // --- helmet sphere on top --------------------------------------------------
  const helmetGeo = new THREE.SphereGeometry(0.12, 12, 10);
  const helmet = new THREE.Mesh(helmetGeo, suitMat);
  helmet.position.y = 0.52;
  helmet.castShadow = true;
  body.add(helmet);

  // --- visor on the FRONT (+Z) so the figure has a clear heading -------------
  const visorGeo = new THREE.SphereGeometry(0.085, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, 0.5, 0.06);
  visor.rotation.x = Math.PI / 2.2; // tilt the cap to face forward
  body.add(visor);

  // --- backpack on the BACK (−Z) ---------------------------------------------
  const packGeo = new THREE.BoxGeometry(0.18, 0.22, 0.1);
  const pack = new THREE.Mesh(packGeo, packMat);
  pack.position.set(0, 0.3, -0.14);
  pack.castShadow = true;
  body.add(pack);

  // --- possessed ground ring (hidden unless piloted) -------------------------
  const ringGeo = new THREE.RingGeometry(0.22, 0.32, 24);
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.visible = false;
  object.add(ring); // on the root: stays flat on the ground, doesn't bob

  // --- carry cube above the head (hidden unless carrying) --------------------
  const carryGeo = new THREE.BoxGeometry(0.14, 0.14, 0.14);
  const carry = new THREE.Mesh(carryGeo, carryMat);
  carry.position.y = 0.72;
  carry.visible = false;
  body.add(carry);

  return {
    object,
    body,
    setState(possessed, carryKind, pulse) {
      // possessed: bright cyan ring + brighter suit emissive
      ring.visible = possessed;
      if (possessed) {
        ringMat.opacity = 0.55 + 0.35 * pulse;
        suitMat.emissive.setHex(0x2f6f7a);
        suitMat.emissiveIntensity = 0.35 + 0.25 * pulse;
      } else {
        suitMat.emissiveIntensity = 0.0;
      }
      // carried resource cube
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
