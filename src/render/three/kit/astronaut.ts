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

   The COMMANDER (ui/lead.ts — the lowest living colonist id) wears rank, not
   possession: setLeader(true) swaps the cyan accents (visor glow, antenna tip,
   suit trim, backpack accent) to amber-gold and reveals a chest chevron. The
   possession ring stays cyan — rank and possession are different signals — and
   succession repaints automatically because the renderer re-applies the flag
   every frame.
   ============================================================================ */
import * as THREE from "three";
import type { DepositKind } from "@shared/types";
import type { KitEnv } from "./contract";
import { disposeObject } from "./contract";

/** carry-cube tint by deposit kind */
const CARRY_COLOR: Record<DepositKind, number> = {
  ice: 0x7fd4e8,
  ore: 0xe0913a,
  cache: 0x6fcf7f,
};

// crew accents (cyan) vs the commander's amber-gold rank treatment
const ACCENT_CYAN = 0x7fd4e8;
const VISOR_CYAN = 0x2c4a55;
const ACCENT_LEAD = 0xe0a23a;
const VISOR_LEAD = 0x5a431f; // the same dim register as the cyan visor glow

export interface AstronautMesh {
  /** the root, positioned by the renderer in world space (feet ~ y=0) */
  object: THREE.Group;
  /** the inner figure the renderer bobs/turns (so the root stays at ground) */
  body: THREE.Group;
  /** drive per-frame look: possessed ring/emissive + carry cube + night glows */
  setState(possessed: boolean, carryKind: DepositKind | null, pulse: number, env?: KitEnv): void;
  /** drive the walk cycle: phase advances with travel, amp (0..1) scales the
   *  limb swing, lean tips the upper body into the stride. amp < 0.05 = idle. */
  setGait(phase: number, amp: number, lean: number): void;
  /** the commander's rank treatment: amber accents + chest chevron on, cyan
   *  crew accents off. Idempotent — safe to re-apply every frame. */
  setLeader(on: boolean): void;
  dispose(): void;
}

/** overall figure scale — a person is much smaller than a habitat dome, so keep
 *  the proportions but shrink the whole figure to read as to-scale on the grid */
const FIGURE_SCALE = 0.55;

export function buildAstronaut(): AstronautMesh {
  const object = new THREE.Group();
  const body = new THREE.Group();
  body.scale.setScalar(FIGURE_SCALE);
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
    emissive: VISOR_CYAN, emissiveIntensity: 0.65,
  });
  const packMat = new THREE.MeshStandardMaterial({
    color: 0x9aa2ac, roughness: 0.55, metalness: 0.55,
  });
  const accentMat = new THREE.MeshStandardMaterial({ // antenna tip, suit trim, pack accent
    color: ACCENT_CYAN, emissive: ACCENT_CYAN, emissiveIntensity: 1.0, roughness: 0.4,
  });
  const chevronMat = new THREE.MeshStandardMaterial({ // the commander's chest chevron
    color: ACCENT_LEAD, emissive: ACCENT_LEAD, emissiveIntensity: 0.85, roughness: 0.4,
  });
  const carryMat = new THREE.MeshStandardMaterial({
    color: 0x7fd4e8, emissive: 0x7fd4e8, emissiveIntensity: 1.0,
    roughness: 0.4, metalness: 0.1, transparent: true, opacity: 0.92,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7fd4e8, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
  });

  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    parent.add(m);
    return m;
  };

  // pivot heights (body-local). Limbs live in pivot groups so setGait can swing
  // them; every child offset is re-expressed pivot-local, so the rest pose
  // (all pivot rotations 0) matches the original flat layout exactly.
  const HIP_Y = 0.24;
  const SHOULDER_Y = 0.43;
  const NECK_Y = 0.49;

  // --- legs + boots in hip pivots (feet at y≈0) ------------------------------
  const buildLeg = (sx: number): THREE.Group => {
    const hip = new THREE.Group();
    hip.position.set(sx * 0.07, HIP_Y, 0);
    body.add(hip);
    add(hip, new THREE.CapsuleGeometry(0.05, 0.12, 3, 6), suitMat, 0, 0.13 - HIP_Y, 0);
    add(hip, new THREE.BoxGeometry(0.1, 0.05, 0.13), trimMat, 0, 0.03 - HIP_Y, 0.015); // boot
    return hip;
  };
  const hipL = buildLeg(1);
  const hipR = buildLeg(-1);

  // --- torso group: everything above the hips, so the upper body can lean ----
  const torsoG = new THREE.Group();
  torsoG.position.y = HIP_Y;
  body.add(torsoG);

  // torso: a bulky EVA suit (wider than tall reads "suited")
  const torso = add(torsoG, new THREE.CapsuleGeometry(0.135, 0.13, 5, 10), suitMat, 0, 0.34 - HIP_Y, 0);
  torso.scale.set(1.05, 1, 0.85);
  add(torsoG, new THREE.BoxGeometry(0.11, 0.1, 0.04), trimMat, 0, 0.32 - HIP_Y, 0.12, false); // chest panel
  // suit accent trim: a slim glowing belt-line under the chest panel
  add(torsoG, new THREE.BoxGeometry(0.17, 0.016, 0.016), accentMat, 0, 0.255 - HIP_Y, 0.118, false);

  // --- commander chevron: two thin angled bars meeting in a ∧ above the chest
  //     panel — hidden on the crew, revealed by setLeader(true) ----------------
  const chevron = new THREE.Group();
  chevron.position.set(0, 0.4 - HIP_Y, 0.115);
  const chevronGeo = new THREE.BoxGeometry(0.062, 0.015, 0.012);
  const chevL = new THREE.Mesh(chevronGeo, chevronMat);
  chevL.position.x = -0.024;
  chevL.rotation.z = 0.55;
  const chevR = new THREE.Mesh(chevronGeo, chevronMat);
  chevR.position.x = 0.024;
  chevR.rotation.z = -0.55;
  chevron.add(chevL, chevR);
  chevron.visible = false;
  torsoG.add(chevron);

  // --- shoulders + arms (angled slightly out) in shoulder pivots --------------
  const buildArm = (sx: number): THREE.Group => {
    const shoulder = new THREE.Group();
    shoulder.position.set(sx * 0.155, SHOULDER_Y - HIP_Y, 0);
    torsoG.add(shoulder);
    add(shoulder, new THREE.SphereGeometry(0.06, 8, 8), suitMat, 0, 0, 0); // shoulder
    const arm = add(shoulder, new THREE.CapsuleGeometry(0.045, 0.16, 3, 6), suitMat, sx * 0.025, 0.31 - SHOULDER_Y, 0);
    arm.rotation.z = sx * 0.22; // keep the slight outward splay
    add(shoulder, new THREE.SphereGeometry(0.05, 8, 8), trimMat, sx * 0.045, 0.21 - SHOULDER_Y, 0); // glove
    return shoulder;
  };
  const shoulderL = buildArm(1);
  const shoulderR = buildArm(-1);

  // --- neck → helmet (a head pivot lets the helmet tilt a touch past the lean)
  add(torsoG, new THREE.CylinderGeometry(0.055, 0.07, 0.05, 8), trimMat, 0, 0.46 - HIP_Y, 0, false);
  const head = new THREE.Group();
  head.position.y = NECK_Y - HIP_Y;
  torsoG.add(head);
  const helmet = add(head, new THREE.SphereGeometry(0.115, 14, 12), suitMat, 0, 0.57 - NECK_Y, 0);
  helmet.scale.set(1, 0.95, 1);

  // --- visor: a dark reflective lens across the FRONT of the helmet -----------
  const visor = add(head, new THREE.SphereGeometry(0.1, 14, 12), visorMat, 0, 0.565 - NECK_Y, 0.045, false);
  visor.scale.set(0.92, 0.62, 0.55);

  // --- antenna ---------------------------------------------------------------
  add(head, new THREE.CylinderGeometry(0.006, 0.006, 0.09, 5), trimMat, 0.07, 0.69 - NECK_Y, -0.02, false);
  add(head, new THREE.SphereGeometry(0.018, 8, 8), accentMat, 0.07, 0.74 - NECK_Y, -0.02, false);

  // --- life-support backpack on the BACK (−Z), with a glowing accent strip ---
  add(torsoG, new THREE.BoxGeometry(0.21, 0.26, 0.1), packMat, 0, 0.35 - HIP_Y, -0.14);
  add(torsoG, new THREE.BoxGeometry(0.05, 0.12, 0.016), accentMat, 0.06, 0.35 - HIP_Y, -0.195, false);

  // --- possessed ground ring (on the root, so it stays flat + un-bobbed) ------
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.24, 24), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.visible = false;
  object.add(ring);

  // --- carry cube above the head (hidden unless carrying) --------------------
  const carry = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), carryMat);
  carry.position.y = 0.84;
  carry.visible = false;
  body.add(carry);

  // rank state — guarded so the renderer can re-assert it every frame for free
  let isLeader = false;

  return {
    object,
    body,
    setState(possessed, carryKind, pulse, env) {
      const night = env?.night ?? 0;
      // antenna tip + visor brighten at night so figures read in the dark
      accentMat.emissiveIntensity = 1.0 + 0.8 * night;
      visorMat.emissiveIntensity = 0.65 + 0.5 * night;
      chevronMat.emissiveIntensity = 0.85 + 0.6 * night; // modest — rank, not a beacon
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
    setGait(phase, amp, lean) {
      if (amp < 0.05) {
        // idle: a slow micro-sway while every limb eases back to rest
        torsoG.rotation.z = Math.sin(phase * 0.3) * 0.02;
        torsoG.rotation.x *= 0.85;
        head.rotation.x *= 0.85;
        hipL.rotation.x *= 0.85;
        hipR.rotation.x *= 0.85;
        shoulderL.rotation.x *= 0.85;
        shoulderR.rotation.x *= 0.85;
        return;
      }
      const swing = Math.sin(phase) * 0.55 * amp;
      hipL.rotation.x = swing;
      hipR.rotation.x = -swing;
      shoulderL.rotation.x = -swing * 0.4; // arms counter-phase the legs
      shoulderR.rotation.x = swing * 0.4;
      torsoG.rotation.x = lean * 0.14; // lean into the stride
      head.rotation.x = lean * 0.06;
      torsoG.rotation.z *= 0.85; // the idle sway hands off as the walk takes over
    },
    setLeader(on) {
      if (on === isLeader) return;
      isLeader = on;
      chevron.visible = on;
      accentMat.color.setHex(on ? ACCENT_LEAD : ACCENT_CYAN);
      accentMat.emissive.setHex(on ? ACCENT_LEAD : ACCENT_CYAN);
      visorMat.emissive.setHex(on ? VISOR_LEAD : VISOR_CYAN);
    },
    dispose() {
      disposeObject(object);
    },
  };
}
