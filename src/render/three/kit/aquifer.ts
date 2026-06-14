/* ============================================================================
   Aquifer sites — the subsurface brine pockets the well must seat on. One mesh
   per snapshot aquifer, mirroring vent.ts so the two terrain markers read as a
   matched pair, but cool/wet instead of warm/heat: a greebleRng rock rim around
   a dark sink, a damp emissive pool disc that pulses cool (#5fc9e8), and a slow
   rising vapor wisp — a single vertical translucent additive cone whose height
   breathes with the pulse. Static terrain: aquifers never move and never
   deplete, so there is no setAmount. The renderer owns the per-id lifecycle;
   this owns geometry/material via dispose().
   ============================================================================ */
import * as THREE from "three";
import { disposeObject, greebleRng } from "./contract";

export interface AquiferMesh {
  object: THREE.Group;
  /** drive the pool glow + the vapor-wisp breathing */
  setPulse(pulse: number): void;
  dispose(): void;
}

/** the pool's cool sheen — a pale brine cyan, kept clear of the vent's ember */
const BRINE = 0x5fc9e8;

export function buildAquifer(seed: number): AquiferMesh {
  const object = new THREE.Group();
  const rng = greebleRng(seed);

  // --- rock rim: 3-4 flat-shaded dodecahedra around the sink ------------------
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x3a4650, // damp grey basalt, cooler than the vent's heat-stain
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

  // --- the dark sink with a damp emissive pool disc inside --------------------
  const sinkMat = new THREE.MeshStandardMaterial({
    color: 0x0c1216, roughness: 0.9, metalness: 0.1,
  });
  const sink = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.07, 12), sinkMat);
  sink.position.y = 0.035;
  object.add(sink);

  const poolMat = new THREE.MeshStandardMaterial({
    color: 0x0a141a, emissive: BRINE, emissiveIntensity: 0.6,
    roughness: 0.25, metalness: 0.2, // a wet, faintly reflective sheen
  });
  const pool = new THREE.Mesh(new THREE.CircleGeometry(0.1, 14), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = 0.072;
  object.add(pool);

  // --- vapor wisp: one translucent additive cone, breathing slowly -----------
  const wispMat = new THREE.MeshBasicMaterial({
    color: BRINE, transparent: true, opacity: 0.1, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const wisp = new THREE.Mesh(new THREE.ConeGeometry(0.1, 1, 10, 1, true), wispMat);
  wisp.scale.set(1, 0.5, 1);
  wisp.position.y = 0.07 + 0.25; // base at the sink; recentered per-pulse
  wisp.renderOrder = 10; // beside the other additive FX (beams, pads, vents)
  object.add(wisp);

  return {
    object,
    setPulse(pulse) {
      poolMat.emissiveIntensity = 0.4 + 0.6 * pulse;
      // the column breathes: taller + slightly clearer at the top of the pulse
      const h = 0.42 + 0.18 * pulse;
      wisp.scale.y = h;
      wisp.position.y = 0.07 + h / 2; // keep the base seated on the sink
      wispMat.opacity = 0.06 + 0.05 * pulse;
    },
    dispose() {
      disposeObject(object);
    },
  };
}
