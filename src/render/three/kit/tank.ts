/* ============================================================================
   Procedural mesh for the "tank" family of buildings — upright industrial
   pressure vessels reproducing the prototype's vertical-capsule silhouette
   (render.js). Covers: Ice Extractor (extractor), Electrolysis Unit
   (electrolysis), Water Cistern (cistern), Oxygen Tank (o2tank).

   A cylindrical body with a domed cap, a few banding rings, a side pipe, and a
   small emissive status light near the top. Each id varies in height, metal
   tint, and a distinguishing topper (derrick / vent stack / antenna).

   Built around the local origin with the base on y = 0 growing +Y; the renderer
   positions the group — we never translate the group itself.
   ============================================================================ */
import * as THREE from "three";
import {
  type KitBuilder,
  type KitContext,
  type KitMesh,
  type BuildingStatus,
  type KitEnv,
  greebleRng,
  disposeObject,
} from "./contract";
import { statusGlow, applyGlow } from "../materials";

/** per-id tuning: silhouette height (in cells) and metal tint. */
interface TankSpec {
  /** total height as a multiple of ctx.cell */
  heightMul: number;
  /** body metal hex */
  metal: string;
  /** which topper to attach */
  topper: "derrick" | "vent" | "antenna" | "none";
}

function specFor(id: string): TankSpec {
  switch (id) {
    case "extractor":
      // shorter, greenish-grey metal, with a small derrick/tripod.
      return { heightMul: 0.9, metal: "#7c8a7e", topper: "derrick" };
    case "electrolysis":
      // standard height, blue-grey, with a small vent stack on top.
      return { heightMul: 1.2, metal: "#737f8c", topper: "vent" };
    case "cistern":
      // bluish metal, tallest.
      return { heightMul: 1.5, metal: "#6078a0", topper: "none" };
    case "o2tank":
      // teal metal, tall, with an antenna on top.
      return { heightMul: 1.5, metal: "#6c96a2", topper: "antenna" };
    case "geothermal":
      // squat, heat-stained bronze, venting steam through its stack — it sits
      // ON the fumarole, so the silhouette stays low and wellhead-like.
      return { heightMul: 0.8, metal: "#8a6a4a", topper: "vent" };
    default:
      return { heightMul: 1.2, metal: "#7a828c", topper: "none" };
  }
}

export const buildTank: KitBuilder = (ctx: KitContext): KitMesh => {
  const { materials, def, cell, seed } = ctx;
  const rng = greebleRng(seed);
  const spec = specFor(def.id);

  const group = new THREE.Group();
  group.name = `tank:${def.id}`;

  const radius = cell * 0.3;
  const totalHeight = cell * spec.heightMul;

  const metalMat = materials.metal(spec.metal);
  const bandMat = materials.metal(spec.metal, { rough: 0.5, metal: 0.85 });

  // --- body: a domed cap caps the top, so the cylinder spans most of the height
  const domeHeight = radius * 0.85;
  const bodyHeight = Math.max(totalHeight - domeHeight, radius);
  const bodyGeo = new THREE.CylinderGeometry(radius, radius, bodyHeight, 24, 1);
  const body = new THREE.Mesh(bodyGeo, metalMat);
  body.position.y = bodyHeight / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  group.add(body);

  // --- domed cap (half-sphere)
  const domeGeo = new THREE.SphereGeometry(radius, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  domeGeo.scale(1, domeHeight / radius, 1);
  const dome = new THREE.Mesh(domeGeo, metalMat);
  dome.position.y = bodyHeight;
  dome.castShadow = true;
  group.add(dome);

  // --- banding rings (2-3 thin tori, evenly spaced up the body)
  const bandCount = 3;
  const bandTube = radius * 0.06;
  for (let i = 0; i < bandCount; i++) {
    const t = (i + 1) / (bandCount + 1);
    const ringGeo = new THREE.TorusGeometry(radius * 1.02, bandTube, 8, 24);
    const ring = new THREE.Mesh(ringGeo, bandMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = bodyHeight * t;
    ring.castShadow = true;
    group.add(ring);
  }

  // --- side pipe: a short vertical riser + a horizontal elbow stub
  const pipeAngle = rng() * Math.PI * 2;
  const pipeR = radius * 0.09;
  const riserH = bodyHeight * 0.5;
  const riserGeo = new THREE.CylinderGeometry(pipeR, pipeR, riserH, 10);
  const riser = new THREE.Mesh(riserGeo, bandMat);
  const px = Math.cos(pipeAngle) * (radius + pipeR);
  const pz = Math.sin(pipeAngle) * (radius + pipeR);
  riser.position.set(px, riserH / 2, pz);
  riser.castShadow = true;
  group.add(riser);

  const elbowLen = radius * 0.6;
  const elbowGeo = new THREE.CylinderGeometry(pipeR, pipeR, elbowLen, 10);
  const elbow = new THREE.Mesh(elbowGeo, bandMat);
  // lay it horizontal, pointing radially outward from the riser top
  elbow.rotation.z = Math.PI / 2;
  elbow.rotation.y = -pipeAngle;
  elbow.position.set(
    Math.cos(pipeAngle) * (radius + pipeR + elbowLen / 2),
    riserH,
    Math.sin(pipeAngle) * (radius + pipeR + elbowLen / 2),
  );
  elbow.castShadow = true;
  group.add(elbow);

  // --- status light near the top of the body, just under the dome
  const lightMat = materials.glow();
  const lightGeo = new THREE.SphereGeometry(radius * 0.12, 10, 8);
  const light = new THREE.Mesh(lightGeo, lightMat);
  const lightAngle = pipeAngle + Math.PI; // opposite the pipe
  light.position.set(
    Math.cos(lightAngle) * radius,
    bodyHeight * 0.92,
    Math.sin(lightAngle) * radius,
  );
  group.add(light);

  // --- warm port lights (night life) -----------------------------------------
  // Two small lit ports on the body — invisible by day, blooming at night.
  // Positions come from a DERIVED rng stream so the main greeble draws above
  // stay byte-stable across this addition.
  const prng = greebleRng(seed ^ 0x77aa);
  const portMat = materials.glow("#ffd9a0");
  portMat.emissiveIntensity = 0;
  const portGeo = new THREE.BoxGeometry(radius * 0.18, radius * 0.22, radius * 0.1);
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI + prng() * Math.PI; // one per body half
    const port = new THREE.Mesh(portGeo, portMat);
    port.position.set(
      Math.cos(a) * radius,
      bodyHeight * (0.3 + 0.35 * prng()),
      Math.sin(a) * radius,
    );
    port.rotation.y = Math.PI / 2 - a; // face outward
    group.add(port);
  }

  // --- per-id topper
  const topY = bodyHeight + domeHeight;
  switch (spec.topper) {
    case "derrick": {
      // 3 thin struts meeting at a point above the top (tripod/derrick)
      const apexY = topY + radius * 1.2;
      const strutR = radius * 0.045;
      const apex = new THREE.Vector3(0, apexY, 0);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        const foot = new THREE.Vector3(
          Math.cos(a) * radius * 0.7,
          topY,
          Math.sin(a) * radius * 0.7,
        );
        const dir = new THREE.Vector3().subVectors(apex, foot);
        const len = dir.length();
        const strutGeo = new THREE.CylinderGeometry(strutR, strutR, len, 6);
        const strut = new THREE.Mesh(strutGeo, bandMat);
        strut.position.copy(foot).add(dir.clone().multiplyScalar(0.5));
        strut.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir.clone().normalize(),
        );
        strut.castShadow = true;
        group.add(strut);
      }
      break;
    }
    case "vent": {
      // a small vent stack on top
      const stackH = radius * 0.9;
      const stackGeo = new THREE.CylinderGeometry(radius * 0.22, radius * 0.28, stackH, 12);
      const stack = new THREE.Mesh(stackGeo, bandMat);
      stack.position.y = topY + stackH / 2;
      stack.castShadow = true;
      group.add(stack);
      const capGeo = new THREE.CylinderGeometry(radius * 0.3, radius * 0.22, radius * 0.18, 12);
      const cap = new THREE.Mesh(capGeo, bandMat);
      cap.position.y = topY + stackH;
      cap.castShadow = true;
      group.add(cap);
      break;
    }
    case "antenna": {
      // a thin antenna with a small node on top
      const antH = radius * 1.6;
      const antGeo = new THREE.CylinderGeometry(radius * 0.03, radius * 0.03, antH, 6);
      const ant = new THREE.Mesh(antGeo, bandMat);
      ant.position.y = topY + antH / 2;
      ant.castShadow = true;
      group.add(ant);
      const nodeGeo = new THREE.SphereGeometry(radius * 0.09, 8, 6);
      const node = new THREE.Mesh(nodeGeo, bandMat);
      node.position.y = topY + antH;
      node.castShadow = true;
      group.add(node);
      break;
    }
    case "none":
    default:
      break;
  }

  function setStatus(status: BuildingStatus, pulse: number, env?: KitEnv): void {
    const night = env?.night ?? 0;
    // night boost on the healthy path only — hurt (rust) stays under bloom
    const intensity = (0.35 + 0.55 * pulse) * (status.alive ? 1 + 1.2 * night : 1);
    applyGlow(lightMat, statusGlow(status.alive, status.hurt), intensity);
    portMat.emissiveIntensity = status.alive ? Math.pow(night, 1.5) * (1.5 + 0.2 * pulse) : 0;
  }

  function dispose(): void {
    disposeObject(group);
  }

  return { object: group, setStatus, dispose };
};
