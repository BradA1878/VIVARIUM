/* ============================================================================
   Rover — the drivable bulk hauler, one mesh per snapshot rover. Built to read
   as a vehicle beside the astronauts: a low chassis (~0.8 cell long) on four
   cylinder wheels that ROLL (the renderer integrates a wheelPhase from the
   smoothed speed), a forward cab with an emissive visor strip, a whip antenna,
   and 1–3 cargo crates on the bed that appear as the bays fill.

   The vehicle faces local +Z like the astronauts (renderer sets rotation.y =
   facing). The possessed rover gets the astronaut-style cyan ground ring plus
   a headlight — an emissive cone + a small additive ground quad ahead of the
   cab (NO real SpotLight; lights are banned in the kit for perf). Procedural +
   disposable; the renderer owns the per-id lifecycle.
   ============================================================================ */
import * as THREE from "three";
import type { KitEnv } from "./contract";
import { disposeObject } from "./contract";

export interface RoverMesh {
  /** the root, positioned by the renderer in world space (wheels at y≈0) */
  object: THREE.Group;
  /** drive per-frame look: possessed ring + headlight, crates by load, night */
  setState(possessed: boolean, loadFrac: number, pulse: number, env?: KitEnv): void;
  /** roll the wheels — phase in radians, integrated by the renderer */
  setMotion(wheelPhase: number): void;
  dispose(): void;
}

/** chassis length along +Z, in world units (~0.8 of a cell) */
const BODY_LEN = 0.8;
const BODY_W = 0.46;
const WHEEL_R = 0.09;

export function buildRover(): RoverMesh {
  const object = new THREE.Group();

  // --- materials (one set per rover; disposed on removal) --------------------
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0xb8bfc7, roughness: 0.55, metalness: 0.35,
    emissive: 0x223036, emissiveIntensity: 0.0,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x3a4048, roughness: 0.7, metalness: 0.4,
  });
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x23282e, roughness: 0.9, metalness: 0.2,
  });
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0x0b1318, roughness: 0.18, metalness: 0.7,
    emissive: 0x2c4a55, emissiveIntensity: 0.65,
  });
  const accentMat = new THREE.MeshStandardMaterial({ // antenna tip — crew cyan
    color: 0x7fd4e8, emissive: 0x7fd4e8, emissiveIntensity: 1.0, roughness: 0.4,
  });
  const crateMat = new THREE.MeshStandardMaterial({
    color: 0x556152, roughness: 0.65, metalness: 0.35,
  });
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7fd4e8, transparent: true, opacity: 0.85, side: THREE.DoubleSide,
  });
  // headlight: a warm emissive lens + an additive throw — never a real light
  const lampMat = new THREE.MeshStandardMaterial({
    color: 0xfff2d0, emissive: 0xffe2a8, emissiveIntensity: 0.0, roughness: 0.3,
  });
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xffd9a0, transparent: true, opacity: 0.0, side: THREE.DoubleSide,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const throwMat = new THREE.MeshBasicMaterial({
    color: 0xffd9a0, transparent: true, opacity: 0.0,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });

  const add = (parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, cast = true): THREE.Mesh => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = cast;
    parent.add(m);
    return m;
  };

  // --- chassis: a low slab riding above the axles ----------------------------
  const deckY = WHEEL_R + 0.05;
  add(object, new THREE.BoxGeometry(BODY_W, 0.1, BODY_LEN), hullMat, 0, deckY, 0);
  // skirt rails along each side (reads "frame", breaks the slab silhouette)
  add(object, new THREE.BoxGeometry(0.05, 0.05, BODY_LEN * 0.92), trimMat, BODY_W / 2, deckY - 0.05, 0);
  add(object, new THREE.BoxGeometry(0.05, 0.05, BODY_LEN * 0.92), trimMat, -BODY_W / 2, deckY - 0.05, 0);

  // --- four cylinder wheels in pivot groups so they can roll -----------------
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.07, 12);
  wheelGeo.rotateZ(Math.PI / 2); // axle along X
  const wheels: THREE.Mesh[] = [];
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat);
      w.position.set(sx * (BODY_W / 2 + 0.045), WHEEL_R, sz * BODY_LEN * 0.32);
      w.castShadow = true;
      object.add(w);
      wheels.push(w);
    }
  }

  // --- cab at the front (+Z) with an emissive visor strip ---------------------
  const cab = add(object, new THREE.BoxGeometry(BODY_W * 0.86, 0.17, 0.26), hullMat, 0, deckY + 0.13, BODY_LEN * 0.27);
  cab.castShadow = true;
  add(object, new THREE.BoxGeometry(BODY_W * 0.7, 0.05, 0.02), visorMat, 0, deckY + 0.16, BODY_LEN * 0.27 + 0.13, false);

  // --- antenna off the cab roof ----------------------------------------------
  add(object, new THREE.CylinderGeometry(0.006, 0.006, 0.22, 5), trimMat, BODY_W * 0.3, deckY + 0.32, BODY_LEN * 0.2, false);
  add(object, new THREE.SphereGeometry(0.02, 8, 8), accentMat, BODY_W * 0.3, deckY + 0.44, BODY_LEN * 0.2, false);

  // --- headlight: lens on the cab nose, an emissive cone + a ground quad ------
  add(object, new THREE.BoxGeometry(0.12, 0.05, 0.03), lampMat, 0, deckY + 0.07, BODY_LEN / 2 + 0.01, false);
  // throw cone: apex at the lamp, widening forward and slightly down
  const beamGeo = new THREE.ConeGeometry(0.16, 0.7, 12, 1, true);
  const beam = new THREE.Mesh(beamGeo, beamMat);
  beam.rotation.x = -Math.PI / 2 - 0.18; // lie forward along +Z, nose dipped
  beam.position.set(0, deckY + 0.04, BODY_LEN / 2 + 0.36);
  beam.renderOrder = 10;
  beam.visible = false;
  object.add(beam);
  // a small additive pool of light on the ground ahead of the cab
  const throwQuad = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.6), throwMat);
  throwQuad.rotation.x = -Math.PI / 2;
  throwQuad.position.set(0, 0.025, BODY_LEN / 2 + 0.55);
  throwQuad.renderOrder = 10;
  throwQuad.visible = false;
  object.add(throwQuad);

  // --- cargo crates on the bed: 1–3 appear as the bays fill -------------------
  const crateGeo = new THREE.BoxGeometry(0.16, 0.14, 0.16);
  const crates: THREE.Mesh[] = [];
  const crateSlots: [number, number][] = [[-0.1, -0.1], [0.1, -0.22], [0, -0.34]];
  for (const [cx, cz] of crateSlots) {
    const c = new THREE.Mesh(crateGeo, crateMat);
    c.position.set(cx, deckY + 0.12, cz * (BODY_LEN / 0.8));
    c.castShadow = true;
    c.visible = false;
    object.add(c);
    crates.push(c);
  }

  // --- possessed ground ring (flat on the root, astronaut-style) --------------
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 28), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  ring.visible = false;
  object.add(ring);

  return {
    object,
    setState(possessed, loadFrac, pulse, env) {
      const night = env?.night ?? 0;
      accentMat.emissiveIntensity = 1.0 + 0.8 * night;
      visorMat.emissiveIntensity = 0.65 + 0.5 * night;
      ring.visible = possessed;
      beam.visible = possessed;
      throwQuad.visible = possessed;
      if (possessed) {
        ringMat.opacity = 0.55 + 0.35 * pulse;
        hullMat.emissive.setHex(0x2f6f7a);
        hullMat.emissiveIntensity = 0.25 + 0.2 * pulse;
        // headlight reads faint by day, strong at night
        lampMat.emissiveIntensity = 0.8 + 1.4 * night;
        beamMat.opacity = 0.05 + 0.1 * night;
        throwMat.opacity = 0.06 + 0.12 * night;
      } else {
        hullMat.emissiveIntensity = 0.0;
        lampMat.emissiveIntensity = 0.15;
      }
      // crates step in with the load: >0 shows one, ≥half two, ≈full three
      const f = Math.max(0, Math.min(1, loadFrac));
      crates[0].visible = f > 0.02;
      crates[1].visible = f >= 0.45;
      crates[2].visible = f >= 0.9;
    },
    setMotion(wheelPhase) {
      for (const w of wheels) w.rotation.x = wheelPhase;
    },
    dispose() {
      disposeObject(object);
    },
  };
}
