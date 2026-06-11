/* ============================================================================
   Corridor — a frosted pressurized connector that orients to its neighbours
   instead of always facing world-X. The renderer hands it a 4-bit mask of which
   sides connect (N=1,E=2,S=4,W=8); the mesh builds one half-tube ARM per set bit
   plus a centre cap, so a run reads as a continuous pipe: straight / elbow / T /
   cross / end-cap. Arms reach to the cell edge to meet a neighbour or a door's
   airlock ("snap to opening"). alive ≈ sealed; unsealed reads dim.
   ============================================================================ */
import * as THREE from "three";
import type { KitBuilder, KitMesh, BuildingStatus, KitEnv } from "./contract";
import { disposeObject } from "./contract";
import { statusGlow, applyGlow } from "../materials";

// Y-rotation that aims the prototype +X arm toward each side (N=0,E=1,S=2,W=3).
const ARM_ROT = [Math.PI / 2, 0, -Math.PI / 2, Math.PI];

export const buildCorridor: KitBuilder = (ctx): KitMesh => {
  const cell = ctx.cell;
  const radius = cell * 0.3;
  const armLen = cell * 0.55; // reaches past the cell edge to meet a neighbour

  const group = new THREE.Group();

  const skinMat = ctx.materials.frostedDome();
  skinMat.transparent = true;
  skinMat.opacity = 0.55;
  skinMat.side = THREE.DoubleSide;
  const ribMat = ctx.materials.metal();
  const glowMat = ctx.materials.glow("#7fd4e8");

  // centre cap — a low frosted dome over the junction (always present)
  const capGeo = new THREE.SphereGeometry(radius * 1.04, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const cap = new THREE.Mesh(capGeo, skinMat);
  cap.castShadow = true;
  group.add(cap);

  // a faint cyan junction light
  const lightGeo = new THREE.SphereGeometry(radius * 0.4, 8, 6);
  const light = new THREE.Mesh(lightGeo, glowMat);
  light.position.y = radius * 0.5;
  group.add(light);

  // one reusable arm geometry: a half-cylinder from x=0 out to x=armLen, arch up.
  const armGeo = new THREE.CylinderGeometry(radius, radius, armLen, 16, 1, true, 0, Math.PI);
  armGeo.rotateZ(-Math.PI / 2);   // axis Y → X
  armGeo.rotateX(Math.PI / 2);    // open side faces up
  armGeo.translate(armLen / 2, 0, 0); // start at centre, extend +X

  const ribGeo = new THREE.TorusGeometry(radius * 1.02, radius * 0.05, 6, 16, Math.PI);

  const arms: THREE.Mesh[] = [];
  let lastMask = -1;

  function rebuild(mask: number): void {
    if (mask === lastMask) return;
    lastMask = mask;
    for (const a of arms) { group.remove(a); a.geometry.dispose(); }
    arms.length = 0;
    for (let side = 0; side < 4; side++) {
      if (!(mask & (1 << side))) continue;
      const arm = new THREE.Mesh(armGeo, skinMat);
      arm.rotation.y = ARM_ROT[side];
      arm.castShadow = true;
      group.add(arm);
      arms.push(arm);
      // a rib hoop near the arm's outer end
      const rib = new THREE.Mesh(ribGeo, ribMat);
      rib.rotation.y = ARM_ROT[side] + Math.PI / 2;
      const dir = sideDir(side);
      rib.position.set(dir[0] * armLen * 0.7, 0, dir[1] * armLen * 0.7);
      group.add(rib);
      arms.push(rib);
    }
  }

  // a lone corridor (mask 0) still shows its cap; default to a N–S stub look
  rebuild(0);

  return {
    object: group,
    setStatus(status: BuildingStatus, pulse: number, env?: KitEnv): void {
      // junction light brightens at night on the healthy (sealed) path only
      const boost = status.alive ? 1 + 1.4 * (env?.night ?? 0) : 1;
      applyGlow(glowMat, statusGlow(status.alive, status.hurt), (0.2 + 0.45 * pulse) * boost);
    },
    setNeighbors(mask: number): void { rebuild(mask); },
    dispose(): void {
      armGeo.dispose();
      ribGeo.dispose();
      disposeObject(group);
    },
  };
};

/** world XZ direction for a side index (N=0,E=1,S=2,W=3) */
function sideDir(side: number): [number, number] {
  return [[0, -1], [1, 0], [0, 1], [-1, 0]][side] as [number, number];
}
