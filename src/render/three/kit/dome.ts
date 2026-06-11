/* ============================================================================
   buildDome — procedural mesh for the "dome" family of pressurized colony
   buildings: the Pressure Hub (`hub`), the Habitat (`hab`), and the Hydroponics
   greenhouse (`greenhouse`). Reproduces the prototype's silhouette (render.js):
   a metal collar ring at the base, a frosted dome cap, a small lit hatch at the
   front, and a rooftop greeble. The hub is the largest and carries a comms
   array; the greenhouse glows green from within.

   Geometry is built around the local origin, base on y = 0, growing +Y. The
   renderer positions the group; we never translate or rotate the group itself.
   ============================================================================ */
import * as THREE from "three";
import type { KitBuilder, KitMesh, BuildingStatus, KitEnv } from "./contract";
import { greebleRng, disposeObject } from "./contract";
import { statusGlow, applyGlow } from "../materials";

export const buildDome: KitBuilder = (ctx): KitMesh => {
  const { materials, def, cell, seed } = ctx;
  const rng = greebleRng(seed);
  const isHub = def.isHub === true;
  const isGreenhouse = def.id === "greenhouse";

  const group = new THREE.Group();

  // --- Footprint sizing -----------------------------------------------------
  // Radius keyed to the smaller footprint side so we stay inside the cell box
  // and never overlap a neighbour. The hub reads bigger and taller.
  const footMin = Math.min(def.foot[0], def.foot[1]);
  const baseRadius = footMin * cell * 0.46;
  const radius = isHub ? baseRadius * 1.08 : baseRadius;
  const domeHeight = radius * (isHub ? 1.15 : 0.95);

  // --- Base collar ring -----------------------------------------------------
  const collarMat = materials.metal("#7a828c", { rough: 0.6, metal: 0.78 });
  const collarHeight = radius * 0.34;
  const collarGeo = new THREE.CylinderGeometry(
    radius * 1.02,
    radius * 1.06,
    collarHeight,
    40,
  );
  const collar = new THREE.Mesh(collarGeo, collarMat);
  collar.position.y = collarHeight / 2;
  collar.castShadow = true;
  collar.receiveShadow = true;
  group.add(collar);

  // A thin darker rim cap on top of the collar where the dome seats.
  const rimMat = materials.metal("#5a626c", { rough: 0.5, metal: 0.8 });
  const rimGeo = new THREE.TorusGeometry(radius, radius * 0.05, 10, 40);
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = collarHeight;
  rim.castShadow = true;
  group.add(rim);

  // --- Frosted dome cap -----------------------------------------------------
  const domeTint = isGreenhouse ? "#7fb98a" : "#787f8a";
  const domeMat = materials.frostedDome(domeTint);
  // Upper hemisphere only (phiStart 0..PI on the vertical sweep).
  const domeGeo = new THREE.SphereGeometry(
    radius,
    44,
    28,
    0,
    Math.PI * 2,
    0,
    Math.PI / 2,
  );
  // Scale Y so the dome reaches the desired height regardless of radius.
  domeGeo.scale(1, domeHeight / radius, 1);
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.position.y = collarHeight;
  dome.castShadow = true;
  group.add(dome);

  // Greenhouse: a faint green interior glow, sitting just inside the dome.
  // Captured here so setStatus can ramp it with the night level.
  let interiorMat: THREE.MeshStandardMaterial | null = null;
  if (isGreenhouse) {
    interiorMat = materials.glow("#3ad17a");
    interiorMat.transparent = true;
    interiorMat.opacity = 0.55;
    interiorMat.emissiveIntensity = 0.35;
    const interiorGeo = new THREE.SphereGeometry(radius * 0.7, 24, 16);
    const interior = new THREE.Mesh(interiorGeo, interiorMat);
    interior.position.y = collarHeight + domeHeight * 0.28;
    group.add(interior);
  }

  // --- Warm collar windows (night life) --------------------------------------
  // Two small lit portholes on the collar — invisible by day, blooming at
  // night. Positions come from a DERIVED rng stream so the existing greeble
  // picks below stay byte-stable across this addition.
  const wrng = greebleRng(seed ^ 0x77aa);
  const windowMat = materials.glow("#ffd9a0");
  windowMat.emissiveIntensity = 0;
  const windowGeo = new THREE.BoxGeometry(radius * 0.16, collarHeight * 0.4, radius * 0.06);
  for (let i = 0; i < 2; i++) {
    // one window per collar half, both kept clear of the front hatch (+Z)
    const a = Math.PI * (0.3 + 0.7 * i + 0.7 * wrng());
    const win = new THREE.Mesh(windowGeo, windowMat);
    win.position.set(Math.sin(a) * radius * 1.02, collarHeight * (0.45 + 0.25 * wrng()), Math.cos(a) * radius * 1.02);
    win.rotation.y = a; // face outward
    group.add(win);
  }

  // --- Front hatch (lit) ----------------------------------------------------
  // A small emissive door set into the collar at +Z (the "front").
  const hatchMat = materials.glow();
  const hatchW = radius * 0.42;
  const hatchH = collarHeight * 0.82;
  const hatchGeo = new THREE.BoxGeometry(hatchW, hatchH, radius * 0.12);
  const hatch = new THREE.Mesh(hatchGeo, hatchMat);
  hatch.position.set(0, hatchH / 2 + collarHeight * 0.08, radius * 1.02);
  group.add(hatch);

  // A thin metal frame around the hatch for readability.
  const frameMat = materials.metal("#4d545d", { rough: 0.55, metal: 0.7 });
  const frameGeo = new THREE.BoxGeometry(
    hatchW * 1.28,
    hatchH * 1.18,
    radius * 0.08,
  );
  const frame = new THREE.Mesh(frameGeo, frameMat);
  frame.position.set(0, hatch.position.y, radius * 0.99);
  frame.castShadow = true;
  group.add(frame);

  // --- Rooftop greeble ------------------------------------------------------
  // Collect any emissive tips so setStatus can pulse them with the hatch.
  const tipMats: THREE.MeshStandardMaterial[] = [];
  const greebleMat = materials.metal("#8a929c", { rough: 0.55, metal: 0.75 });
  const topY = collarHeight + domeHeight;

  if (isHub) {
    // Hub always gets a comms array: a mast, a small dish, and a glowing tip.
    const mastH = domeHeight * 0.6;
    const mastGeo = new THREE.CylinderGeometry(
      radius * 0.05,
      radius * 0.07,
      mastH,
      10,
    );
    const mast = new THREE.Mesh(mastGeo, greebleMat);
    mast.position.y = topY + mastH / 2;
    mast.castShadow = true;
    group.add(mast);

    // Small dish angled off the mast.
    const dishGeo = new THREE.SphereGeometry(
      radius * 0.22,
      18,
      12,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2,
    );
    dishGeo.scale(1, 0.45, 1);
    const dish = new THREE.Mesh(dishGeo, materials.panel());
    dish.position.set(radius * 0.18, topY + mastH * 0.7, 0);
    dish.rotation.z = -Math.PI / 3;
    dish.castShadow = true;
    group.add(dish);

    // Glowing comms tip.
    const tipMat = materials.glow();
    tipMats.push(tipMat);
    const tipGeo = new THREE.SphereGeometry(radius * 0.07, 12, 8);
    const tip = new THREE.Mesh(tipGeo, tipMat);
    tip.position.y = topY + mastH + radius * 0.04;
    group.add(tip);
  } else {
    // Non-hub domes pick a greeble deterministically.
    const pick = rng();
    if (pick < 0.4) {
      // Antenna: thin cylinder + blinking tip.
      const antH = domeHeight * 0.45;
      const antGeo = new THREE.CylinderGeometry(
        radius * 0.035,
        radius * 0.045,
        antH,
        8,
      );
      const ant = new THREE.Mesh(antGeo, greebleMat);
      ant.position.y = topY + antH / 2;
      ant.castShadow = true;
      group.add(ant);

      const tipMat = materials.glow();
      tipMats.push(tipMat);
      const tipGeo = new THREE.SphereGeometry(radius * 0.055, 10, 8);
      const tip = new THREE.Mesh(tipGeo, tipMat);
      tip.position.y = topY + antH + radius * 0.03;
      group.add(tip);
    } else if (pick < 0.72) {
      // Vent: a cluster of short stacks near the apex.
      const stackCount = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < stackCount; i++) {
        const sh = domeHeight * (0.14 + rng() * 0.12);
        const sr = radius * (0.05 + rng() * 0.03);
        const stackGeo = new THREE.CylinderGeometry(sr, sr * 1.1, sh, 8);
        const stack = new THREE.Mesh(stackGeo, greebleMat);
        const ang = rng() * Math.PI * 2;
        const off = radius * 0.18 * rng();
        stack.position.set(
          Math.cos(ang) * off,
          topY - domeHeight * 0.04 + sh / 2,
          Math.sin(ang) * off,
        );
        stack.castShadow = true;
        group.add(stack);
      }
    } else {
      // Dish: a shallow parabola on a short stub.
      const stubH = domeHeight * 0.16;
      const stubGeo = new THREE.CylinderGeometry(
        radius * 0.04,
        radius * 0.05,
        stubH,
        8,
      );
      const stub = new THREE.Mesh(stubGeo, greebleMat);
      stub.position.y = topY + stubH / 2;
      stub.castShadow = true;
      group.add(stub);

      const dishGeo = new THREE.SphereGeometry(
        radius * 0.26,
        18,
        12,
        0,
        Math.PI * 2,
        0,
        Math.PI / 2,
      );
      dishGeo.scale(1, 0.4, 1);
      const dish = new THREE.Mesh(dishGeo, materials.panel());
      dish.position.y = topY + stubH;
      dish.rotation.z = -Math.PI / 5;
      dish.castShadow = true;
      group.add(dish);
    }
  }

  return {
    object: group,
    setStatus(status: BuildingStatus, pulse: number, env?: KitEnv): void {
      const night = env?.night ?? 0;
      const color = statusGlow(status.alive, status.hurt);
      // night boost rides the healthy path only — rust/hurt glows must stay
      // under the bloom threshold so damage warnings never halo
      const intensity = (0.35 + 0.55 * pulse) * (status.alive ? 1 + 1.2 * night : 1);
      applyGlow(hatchMat, color, intensity);
      for (const m of tipMats) applyGlow(m, color, intensity);
      if (interiorMat) interiorMat.emissiveIntensity = 0.35 + (status.alive ? 1.3 * night : 0);
      windowMat.emissiveIntensity = status.alive ? Math.pow(night, 1.5) * (1.5 + 0.2 * pulse) : 0;
    },
    dispose(): void {
      disposeObject(group);
    },
  };
};
