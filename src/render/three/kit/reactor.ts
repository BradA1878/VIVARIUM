/* ============================================================================
   Fission Reactor (`reactor`) — a squat containment dome on a wide collar, a
   cooling stack off one shoulder (the tank family's vent-stack recipe), and a
   core ring light around the dome's waist that carries the whole status story:
   a hot white-cyan band breathing 0.6→1.5 while the pile runs, guttering to a
   faint 0.1 when offline, and turning rust when hurt (unstaffed / dry / dark).

   Built around the local origin, base on y = 0, growing +Y; the renderer
   positions the group and turns it by the building's rot.
   ============================================================================ */
import * as THREE from "three";
import type { KitBuilder, KitContext, KitMesh, BuildingStatus } from "./contract";
import { greebleRng, disposeObject } from "./contract";
import { RUST } from "../materials";

/** the core's hot white-cyan — paler and hotter than the signal cyan */
const CORE_HOT = new THREE.Color("#d8f4ff");

export const buildReactor: KitBuilder = (ctx: KitContext): KitMesh => {
  const { materials, def, cell, seed } = ctx;
  const rng = greebleRng(seed);

  const group = new THREE.Group();
  group.name = `reactor:${def.id}`;

  const footMin = Math.min(def.foot[0], def.foot[1]);
  const radius = footMin * cell * 0.42;
  const collarH = radius * 0.45;
  const domeH = radius * 0.7; // squat — wider than tall

  const metalMat = materials.metal("#848a7a"); // the def's olive-grey family
  const bandMat = materials.metal("#5a626c", { rough: 0.5, metal: 0.8 });

  // --- collar + squat containment dome ----------------------------------------
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.02, radius * 1.08, collarH, 32), metalMat);
  collar.position.y = collarH / 2;
  collar.castShadow = true;
  collar.receiveShadow = true;
  group.add(collar);

  const domeGeo = new THREE.SphereGeometry(radius, 32, 18, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGeo.scale(1, domeH / radius, 1);
  const dome = new THREE.Mesh(domeGeo, metalMat);
  dome.position.y = collarH;
  dome.castShadow = true;
  group.add(dome);

  // --- core ring light around the dome's waist ---------------------------------
  const coreMat = materials.glow("#d8f4ff");
  const core = new THREE.Mesh(new THREE.TorusGeometry(radius * 1.01, radius * 0.06, 10, 36), coreMat);
  core.rotation.x = Math.PI / 2;
  core.position.y = collarH;
  group.add(core);

  // --- cooling stack off one shoulder (the tank family's vent-stack recipe) ---
  const stackAngle = rng() * Math.PI * 2;
  const stackR = radius * 0.28;
  const stackH = radius * 1.3;
  const sx = Math.cos(stackAngle) * radius * 0.95;
  const sz = Math.sin(stackAngle) * radius * 0.95;
  const stack = new THREE.Mesh(new THREE.CylinderGeometry(stackR * 0.78, stackR, stackH, 12), bandMat);
  stack.position.set(sx, stackH / 2, sz);
  stack.castShadow = true;
  group.add(stack);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(stackR * 1.06, stackR * 0.78, stackR * 0.6, 12), bandMat);
  cap.position.set(sx, stackH, sz);
  cap.castShadow = true;
  group.add(cap);

  // --- a feed pipe from the stack into the collar (it drinks water) -----------
  const pipeR = radius * 0.07;
  const pipe = new THREE.Mesh(new THREE.CylinderGeometry(pipeR, pipeR, radius * 0.9, 8), bandMat);
  pipe.rotation.z = Math.PI / 2;
  pipe.rotation.y = -stackAngle;
  pipe.position.set(sx * 0.55, collarH * 0.5, sz * 0.55);
  pipe.castShadow = true;
  group.add(pipe);

  function setStatus(status: BuildingStatus, pulse: number): void {
    if (status.hurt) {
      coreMat.emissive.copy(RUST);
      coreMat.emissiveIntensity = 0.35 + 0.3 * pulse;
    } else {
      coreMat.emissive.copy(CORE_HOT);
      coreMat.emissiveIntensity = status.alive ? 0.6 + 0.9 * pulse : 0.1;
    }
  }

  function dispose(): void {
    disposeObject(group);
  }

  return { object: group, setStatus, dispose };
};
