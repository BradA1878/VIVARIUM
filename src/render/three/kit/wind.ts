/* ============================================================================
   Wind Turbine (`windturbine`) — a tapered mast, a nacelle, and a 3-blade rotor
   facing local +Z. The rotor's speed is the building's whole story: setStatus
   RATE-INTEGRATES spin += (0.4 + 7·env.wind) · env.dt, so the blades idle on a
   still sol, blur in a storm, and never jump angle when the wind level steps
   between snapshots (the renderer feeds env.wind = snap.windLevel and env.dt
   each frame). Status light per the tank pattern: cyan alive / rust hurt, with
   the night boost on the healthy path only.

   Built around the local origin, base on y = 0, growing +Y; the renderer
   positions the group and turns it by the building's rot.
   ============================================================================ */
import * as THREE from "three";
import type { KitBuilder, KitContext, KitMesh, BuildingStatus, KitEnv } from "./contract";
import { disposeObject } from "./contract";
import { statusGlow, applyGlow } from "../materials";

export const buildWind: KitBuilder = (ctx: KitContext): KitMesh => {
  const { materials, def, cell } = ctx;

  const group = new THREE.Group();
  group.name = `wind:${def.id}`;

  const mastH = cell * 1.5;
  const mastMat = materials.metal("#8a929c");
  const trimMat = materials.metal("#5a626c", { rough: 0.5, metal: 0.8 });

  // --- foundation pad + tapered mast ------------------------------------------
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(cell * 0.18, cell * 0.22, cell * 0.06, 12), trimMat);
  pad.position.y = cell * 0.03;
  pad.castShadow = true;
  pad.receiveShadow = true;
  group.add(pad);

  const mast = new THREE.Mesh(new THREE.CylinderGeometry(cell * 0.035, cell * 0.07, mastH, 10), mastMat);
  mast.position.y = mastH / 2;
  mast.castShadow = true;
  group.add(mast);

  // --- nacelle: the generator housing at the masthead, nose toward +Z ---------
  const nacelle = new THREE.Mesh(new THREE.BoxGeometry(cell * 0.12, cell * 0.12, cell * 0.3), mastMat);
  nacelle.position.set(0, mastH, 0);
  nacelle.castShadow = true;
  group.add(nacelle);

  // --- rotor: a hub + 3 tapered blades, spinning about the nacelle's Z axis ---
  const rotor = new THREE.Group();
  rotor.position.set(0, mastH, cell * 0.18);
  group.add(rotor);
  const hub = new THREE.Mesh(new THREE.SphereGeometry(cell * 0.05, 10, 8), trimMat);
  hub.castShadow = true;
  rotor.add(hub);
  const bladeGeo = new THREE.BoxGeometry(cell * 0.045, cell * 0.55, cell * 0.02);
  const bladeMat = materials.metal("#c7ccd2", { rough: 0.45, metal: 0.5 });
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    // a pivot per blade: offset along its length, fanned 120° apart about Z
    const pivot = new THREE.Group();
    blade.position.y = cell * 0.3;
    blade.rotation.y = 0.22; // a touch of pitch so the disc catches light
    blade.castShadow = true;
    pivot.add(blade);
    pivot.rotation.z = (i / 3) * Math.PI * 2;
    rotor.add(pivot);
  }

  // --- status light on the nacelle's tail (tank pattern) -----------------------
  const lightMat = materials.glow();
  const light = new THREE.Mesh(new THREE.SphereGeometry(cell * 0.035, 10, 8), lightMat);
  light.position.set(0, mastH + cell * 0.08, -cell * 0.12);
  group.add(light);

  // the rotor's integrated angle — persists across frames so speed changes
  // never snap the blades to a new angle
  let spin = 0;

  function setStatus(status: BuildingStatus, pulse: number, env?: KitEnv): void {
    const night = env?.night ?? 0;
    // rate-integrate the spin from the live wind level (idle creep at calm)
    spin += (0.4 + 7 * (env?.wind ?? 0)) * (env?.dt ?? 0);
    rotor.rotation.z = spin;
    const intensity = (0.35 + 0.55 * pulse) * (status.alive ? 1 + 1.2 * night : 1);
    applyGlow(lightMat, statusGlow(status.alive, status.hurt), intensity);
  }

  function dispose(): void {
    disposeObject(group);
  }

  return { object: group, setStatus, dispose };
};
