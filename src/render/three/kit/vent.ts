/* ============================================================================
   Vents — the geothermal fumaroles the tap must seat on. One mesh per snapshot
   vent, mirroring deposit.ts: a greebleRng rock mound (3–4 flat-shaded
   dodecahedra) ringing a dark throat, an inner emissive disc that pulses warm
   (#e8a04f), and a slow heat-shimmer — a single vertical translucent additive
   cone whose height breathes with the pulse. Static terrain: vents never move
   and never deplete, so there is no setAmount. Kept visually distinct from
   deposits (warm, breathing) and rocks (these glow). The renderer owns the
   per-id lifecycle; this owns geometry/material via dispose().
   ============================================================================ */
import * as THREE from "three";
import { disposeObject, greebleRng } from "./contract";

export interface VentMesh {
  object: THREE.Group;
  /** drive the throat glow + the heat-shimmer breathing */
  setPulse(pulse: number): void;
  dispose(): void;
}

/** the throat's warm ember — sits between ore-orange and rust */
const EMBER = 0xe8a04f;

export function buildVent(seed: number): VentMesh {
  const object = new THREE.Group();
  const rng = greebleRng(seed);

  // --- rock mound: 3-4 flat-shaded dodecahedra around the throat -------------
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x4a3a30, // heat-stained basalt, warmer than the ore rock
    roughness: 0.95,
    metalness: 0.1,
    flatShading: true,
  });
  const rocks = 3 + Math.floor(rng() * 2);
  for (let i = 0; i < rocks; i++) {
    const r = 0.09 + rng() * 0.08;
    const a = (i / rocks) * Math.PI * 2 + rng() * 0.8;
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(r, 0), rockMat);
    m.position.set(Math.cos(a) * 0.16, r * 0.55, Math.sin(a) * 0.16);
    m.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
    m.scale.y = 0.7;
    m.castShadow = true;
    object.add(m);
  }

  // --- the dark throat with an emissive ember disc inside ---------------------
  const throatMat = new THREE.MeshStandardMaterial({
    color: 0x14100c, roughness: 0.9, metalness: 0.1,
  });
  const throat = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.07, 12), throatMat);
  throat.position.y = 0.035;
  object.add(throat);

  const emberMat = new THREE.MeshStandardMaterial({
    color: 0x1a120a, emissive: EMBER, emissiveIntensity: 0.8,
    roughness: 0.6, metalness: 0.1,
  });
  const ember = new THREE.Mesh(new THREE.CircleGeometry(0.1, 14), emberMat);
  ember.rotation.x = -Math.PI / 2;
  ember.position.y = 0.072;
  object.add(ember);

  // --- heat shimmer: one translucent additive cone, breathing slowly ----------
  const shimmerMat = new THREE.MeshBasicMaterial({
    color: EMBER, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const shimmer = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1, 10, 1, true), shimmerMat);
  shimmer.scale.set(1, 0.5, 1);
  shimmer.position.y = 0.07 + 0.25; // base at the throat; recentered per-pulse
  shimmer.renderOrder = 10; // beside the other additive FX (beams, pads)
  object.add(shimmer);

  return {
    object,
    setPulse(pulse) {
      emberMat.emissiveIntensity = 0.5 + 0.7 * pulse;
      // the column breathes: taller + slightly clearer at the top of the pulse
      const h = 0.42 + 0.18 * pulse;
      shimmer.scale.y = h;
      shimmer.position.y = 0.07 + h / 2; // keep the base seated on the throat
      shimmerMat.opacity = 0.08 + 0.06 * pulse;
    },
    dispose() {
      disposeObject(object);
    },
  };
}
