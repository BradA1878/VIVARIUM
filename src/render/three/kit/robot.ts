/* ============================================================================
   Robot — the autonomous mining drone, one mesh per snapshot robot. Smaller
   than an astronaut (~0.4 figure scale): two dark track boxes, a metal hull
   slung between them, and a single emissive eye on the front (+Z) that pulses —
   running cool cyan, dimming to an ember while the unit is flare-stunned. A
   carry crate rides the back deck while loaded.

   Faces local +Z like the astronauts/rover (renderer sets rotation.y = facing);
   setMotion vibrates the hull with travel so a working drone reads alive at iso
   scale. Procedural + disposable; the renderer owns the per-id lifecycle.
   ============================================================================ */
import * as THREE from "three";
import type { DepositKind } from "@shared/types";
import type { KitEnv } from "./contract";
import { disposeObject } from "./contract";

/** carry-crate tint by deposit kind (matches the astronaut's carry cube) */
const CARRY_COLOR: Record<DepositKind, number> = {
  ice: 0x7fd4e8,
  ore: 0xe0913a,
  cache: 0x6fcf7f,
};

export interface RobotMesh {
  /** the root, positioned by the renderer in world space (tracks at y≈0) */
  object: THREE.Group;
  /** per-frame look: eye pulse (dim ember while faulted), carry crate, night */
  setState(carryKind: DepositKind | null, faulted: boolean, pulse: number, env?: KitEnv): void;
  /** travel vibration — phase advances with the smoothed speed, amp 0..1 */
  setMotion(phase: number, amp: number): void;
  dispose(): void;
}

/** overall figure scale — a drone is knee-high beside a 0.55-scale astronaut */
const FIGURE_SCALE = 0.4;

export function buildRobot(): RobotMesh {
  const object = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(FIGURE_SCALE);
  object.add(body);

  // --- materials (one set per robot; disposed on removal) --------------------
  const trackMat = new THREE.MeshStandardMaterial({
    color: 0x23282e, roughness: 0.9, metalness: 0.25,
  });
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x9aa2ac, roughness: 0.55, metalness: 0.55,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x3a4048, roughness: 0.7, metalness: 0.4,
  });
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0x10161c, emissive: 0x7fd4e8, emissiveIntensity: 1.0,
    roughness: 0.3, metalness: 0.2,
  });
  const crateMat = new THREE.MeshStandardMaterial({
    color: 0x7fd4e8, emissive: 0x7fd4e8, emissiveIntensity: 0.8,
    roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.92,
  });

  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    parent.add(m);
    return m;
  };

  // --- two track boxes, one per side ------------------------------------------
  for (const sx of [-1, 1]) {
    add(body, new THREE.BoxGeometry(0.14, 0.16, 0.56), trackMat, sx * 0.18, 0.08, 0);
  }

  // --- hull slung between the tracks (vibrates with travel) -------------------
  const hull = new THREE.Group();
  hull.position.y = 0.2;
  body.add(hull);
  add(hull, new THREE.BoxGeometry(0.34, 0.16, 0.44), hullMat, 0, 0, 0);
  add(hull, new THREE.BoxGeometry(0.26, 0.05, 0.3), trimMat, 0, 0.1, -0.02, false); // deck lip
  // a stubby sensor mast
  add(hull, new THREE.CylinderGeometry(0.015, 0.015, 0.12, 5), trimMat, -0.1, 0.14, -0.12, false);

  // --- the single eye on the front (+Z) ----------------------------------------
  add(hull, new THREE.CylinderGeometry(0.055, 0.055, 0.04, 10).rotateX(Math.PI / 2), eyeMat, 0, 0.02, 0.23, false);

  // --- carry crate on the back deck (hidden unless loaded) --------------------
  const crate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.18), crateMat);
  crate.position.set(0, 0.2, -0.12);
  crate.visible = false;
  hull.add(crate);

  return {
    object,
    setState(carryKind, faulted, pulse, env) {
      const night = env?.night ?? 0;
      if (faulted) {
        // flare-stunned: the eye gutters a dim rust ember
        eyeMat.emissive.setHex(0xe8784f);
        eyeMat.emissiveIntensity = 0.15 + 0.15 * pulse;
      } else {
        eyeMat.emissive.setHex(0x7fd4e8);
        eyeMat.emissiveIntensity = (0.7 + 0.6 * pulse) * (1 + 0.6 * night);
      }
      if (carryKind) {
        crate.visible = true;
        const col = CARRY_COLOR[carryKind];
        crateMat.color.setHex(col);
        crateMat.emissive.setHex(col);
        crateMat.emissiveIntensity = 0.6 + 0.4 * pulse;
      } else {
        crate.visible = false;
      }
    },
    setMotion(phase, amp) {
      // track-vibration shudder while travelling; settles flat at rest
      hull.position.y = 0.2 + Math.abs(Math.sin(phase)) * 0.012 * amp;
      hull.rotation.z = Math.sin(phase * 0.7) * 0.02 * amp;
    },
    dispose() {
      disposeObject(object);
    },
  };
}
