/* ============================================================================
   Ufo — the evil abductor saucer, shown while snap.ufo is non-null. A sibling of
   the trader saucer (alienship.ts) but menacing: a dark crimson hull, a hot red
   rim, a single glowing "eye", and a strong tractor beam that pulls down over its
   victim. The renderer drives it by phase and positions it over the targeted
   colonist:
     inbound  — descend from high altitude to the hover height
     hovering — hold over the victim, beam blazing, a tense bob
     leaving  — rise back up, beam fading
   Procedural + disposable; the renderer creates it on first sighting and disposes
   it when snap.ufo returns to null.
   ============================================================================ */
import * as THREE from "three";
import type { UfoPhase } from "@shared/types";
import { disposeObject, greebleRng } from "./kit/contract";

const HOVER_Y = 3.0;   // resting altitude above the victim (higher than the trader)
const HIGH_Y = 10.0;   // entry/exit altitude

const BEAM_R = 0.7;    // outer-shell cone radius (the unit geometry below)
const MOTES = 40;      // dust caught in the beam, cycling upward

export interface UfoMesh {
  object: THREE.Group;
  /** advance the descent/hover/ascent animation; dt in seconds */
  update(phase: UfoPhase, dt: number, now: number): void;
  dispose(): void;
}

export function buildUfo(): UfoMesh {
  const object = new THREE.Group();
  object.position.y = HIGH_Y;

  // --- hull: a flattened sphere, dark and cold -------------------------------
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0x1c0a10,
    roughness: 0.35,
    metalness: 0.85,
    emissive: 0x2a0608,
    emissiveIntensity: 0.5,
  });
  const hullGeo = new THREE.SphereGeometry(0.8, 24, 16);
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.scale.set(1, 0.3, 1);
  hull.castShadow = true;
  object.add(hull);

  // --- hot rim torus ----------------------------------------------------------
  const rimMat = new THREE.MeshStandardMaterial({
    color: 0x1a0205,
    emissive: 0xff2a1c,
    emissiveIntensity: 1.2,
    roughness: 0.3,
    metalness: 0.5,
  });
  const rimGeo = new THREE.TorusGeometry(0.74, 0.1, 10, 32);
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = Math.PI / 2;
  object.add(rim);

  // --- a single menacing eye (underside) -------------------------------------
  const eyeMat = new THREE.MeshStandardMaterial({
    color: 0xff5a3a,
    emissive: 0xff2a10,
    emissiveIntensity: 1.4,
    roughness: 0.2,
    metalness: 0.2,
  });
  const eyeGeo = new THREE.SphereGeometry(0.18, 16, 12);
  const eye = new THREE.Mesh(eyeGeo, eyeMat);
  eye.position.y = -0.12;
  object.add(eye);

  // --- tractor beam cone toward the ground -----------------------------------
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xff3322,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  // cone with apex at the ship, widening to the ground; height set per-frame
  const beamGeo = new THREE.ConeGeometry(BEAM_R, 1, 24, 1, true);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.renderOrder = 10;
  object.add(beam);

  // --- beam core: a hot, narrow cone inside the shell -------------------------
  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xff6644,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const coreGeo = new THREE.ConeGeometry(BEAM_R * 0.35, 1, 16, 1, true);
  const core = new THREE.Mesh(coreGeo, coreMat);
  core.renderOrder = 11;
  object.add(core);

  // --- motes: dust grains drawn up the beam. Built in the unit cone's local
  // space (apex +0.5 at the ship, base -0.5 at the ground) and given the beam's
  // scale/position each frame, so they ride the frustum exactly. Seeded, not
  // Math.random, so the beam looks identical every encounter.
  const mrnd = greebleRng(0xabd0c7);
  const motePos = new Float32Array(MOTES * 3);
  const moteAng = new Float32Array(MOTES);
  const moteFrac = new Float32Array(MOTES);
  const moteSpeed = new Float32Array(MOTES);
  const seedMote = (i: number): void => {
    moteAng[i] = mrnd() * Math.PI * 2;
    moteFrac[i] = Math.sqrt(mrnd()); // uniform over the disc, not center-bunched
    moteSpeed[i] = 0.25 + mrnd() * 0.5; // unit heights per second
  };
  for (let i = 0; i < MOTES; i++) {
    seedMote(i);
    motePos[i * 3 + 1] = mrnd() - 0.5; // initial heights spread over the cone
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
  const moteMat = new THREE.PointsMaterial({
    color: 0xff8866,
    size: 0.05,
    transparent: true,
    opacity: 0.0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    sizeAttenuation: true,
  });
  const motes = new THREE.Points(moteGeo, moteMat);
  motes.renderOrder = 12;
  motes.frustumCulled = false;
  object.add(motes);

  // --- ground glow: a flat ring pinned to the ground under the ship -----------
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xff5533,
    transparent: true,
    opacity: 0.0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const glowGeo = new THREE.RingGeometry(0.35, 0.95, 32);
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.renderOrder = 10;
  object.add(glow);

  return {
    object,
    update(phase, dt, now) {
      // ease the altitude toward the phase target
      const targetY = phase === "leaving" ? HIGH_Y : HOVER_Y;
      const k = phase === "inbound" ? 2.0 * dt : phase === "leaving" ? 1.8 * dt : 1;
      if (phase === "hovering") {
        object.position.y = HOVER_Y + Math.sin(now / 420) * 0.12; // tense bob
      } else {
        object.position.y += (targetY - object.position.y) * Math.min(1, k);
      }

      // fast, ominous spin + a hot rim pulse
      rim.rotation.z = now / 700;
      rimMat.emissiveIntensity = 0.9 + 0.7 * (0.5 + 0.5 * Math.sin(now / 220));
      eyeMat.emissiveIntensity = 1.0 + 0.8 * (0.5 + 0.5 * Math.sin(now / 180));

      // tractor beam: blazing while hovering, faint on approach, off on exit
      const groundGap = object.position.y; // ground is world y=0
      const beamH = Math.max(0.2, groundGap);
      beam.scale.y = beamH;
      beam.position.y = -beamH / 2;
      const grab = phase === "hovering" ? 1 : phase === "inbound" ? 0.3 : 0.0;
      beam.scale.x = beam.scale.z = phase === "hovering" ? 1.1 : 0.85;
      beamMat.opacity = (0.28 + 0.18 * (0.5 + 0.5 * Math.sin(now / 130))) * grab;

      // core rides the shell's transform; hotter and flickering faster
      core.scale.copy(beam.scale);
      core.position.copy(beam.position);
      coreMat.opacity = (0.45 + 0.2 * (0.5 + 0.5 * Math.sin(now / 110))) * grab;
      core.visible = grab > 0;

      // motes climb the frustum, ticked only while the beam shows; a wrap at the
      // apex re-randomizes the grain's lane (angle/radius/speed)
      motes.scale.copy(beam.scale);
      motes.position.copy(beam.position);
      motes.visible = grab > 0;
      if (grab > 0) {
        for (let i = 0; i < MOTES; i++) {
          let h = motePos[i * 3 + 1] + moteSpeed[i] * dt;
          if (h > 0.5) {
            seedMote(i);
            h -= 1;
          }
          const r = BEAM_R * (0.5 - h) * moteFrac[i]; // inside the cone at this height
          motePos[i * 3] = Math.cos(moteAng[i]) * r;
          motePos[i * 3 + 1] = h;
          motePos[i * 3 + 2] = Math.sin(moteAng[i]) * r;
        }
        moteGeo.attributes.position.needsUpdate = true;
        moteMat.opacity = 0.85 * grab;
      }

      // ground glow pinned at world y≈0.03, breathing a gentle ±8% scale pulse
      glow.position.y = 0.03 - object.position.y;
      const gs = (phase === "hovering" ? 1.1 : 0.85) * (1 + 0.08 * Math.sin(now / 240));
      glow.scale.set(gs, gs, gs);
      glowMat.opacity = 0.3 * grab;
      glow.visible = grab > 0;
    },
    dispose() {
      disposeObject(object);
    },
  };
}
