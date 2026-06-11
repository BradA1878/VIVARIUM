/* ============================================================================
   Solar Array (`solar`) — a 2×2-cell tilted photovoltaic panel on short legs.
   Dark blue glassy PV surface with a faint grid of cells, lifted off the ground
   on four thin metal legs and tilted toward the sky. Reproduces the prototype's
   silhouette: a flat rectangular panel angled up, sitting on a few thin legs.

   Build around the local origin, base on y = 0, growing +Y. The renderer
   positions the group; this builder never translates the root.
   ============================================================================ */
import * as THREE from "three";
import type { KitBuilder, KitContext, KitMesh, BuildingStatus, KitEnv } from "./contract";
import { disposeObject } from "./contract";
import { statusGlow, applyGlow } from "../materials";

export const buildSolar: KitBuilder = (ctx: KitContext): KitMesh => {
  const { materials, def, cell } = ctx;

  const root = new THREE.Group();

  // --- footprint-derived panel dimensions -----------------------------------
  const panelW = def.foot[0] * cell * 0.92; // across X
  const panelD = def.foot[1] * cell * 0.92; // along Z (pre-tilt depth)
  const panelThickness = cell * 0.04;
  const legHeight = cell * 0.35; // raised off the ground
  const tilt = THREE.MathUtils.degToRad(24); // ~20–30° toward the sky

  // --- legs ------------------------------------------------------------------
  // Four thin metal legs near the panel corners. The panel pivots about X, so
  // legs at the +Z (front) edge are shorter and -Z (back) edge taller to meet
  // the underside of the tilted panel; we keep them simple and uniform-ish by
  // giving each a height matching the panel corner it supports.
  const legMat = materials.metal();
  const legRadius = cell * 0.025;
  const legInset = 0.82; // how far legs sit from center toward the edges
  const halfW = (panelW * legInset) / 2;
  const halfD = (panelD * legInset) / 2;

  // The tilted panel's corner height above the leg-mount plane = sin(tilt) * z.
  // Back edge (-Z) rises, front edge (+Z) lowers. We mount all legs at y=0 base
  // and extend each to the underside of the panel at its (x, z) location.
  const cornerLift = (z: number) => legHeight + Math.sin(tilt) * -z;

  const legPositions: Array<[number, number]> = [
    [-halfW, -halfD],
    [halfW, -halfD],
    [-halfW, halfD],
    [halfW, halfD],
  ];

  for (const [x, z] of legPositions) {
    const h = Math.max(cell * 0.08, cornerLift(z));
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(legRadius, legRadius * 1.2, h, 8),
      legMat
    );
    leg.position.set(x, h / 2, z);
    leg.castShadow = true;
    root.add(leg);
  }

  // --- tilted panel assembly -------------------------------------------------
  // A pivot group placed at the mid-height of the legs; tilting it about X lifts
  // the back edge and drops the front edge, giving the angled-to-sky silhouette.
  const panelPivot = new THREE.Group();
  panelPivot.position.set(0, legHeight, 0);
  panelPivot.rotation.x = tilt;
  root.add(panelPivot);

  // Panel glass surface — the dark blue glassy PV material.
  const panelMat = materials.panel();
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(panelW, panelThickness, panelD),
    panelMat
  );
  panel.castShadow = true;
  panel.receiveShadow = true;
  panelPivot.add(panel);

  // --- thin metal frame around the panel edge -------------------------------
  const frameMat = materials.metal("#5a626c", { rough: 0.5, metal: 0.8 });
  const frameThickness = cell * 0.03;
  const frameHeight = panelThickness * 1.6;
  const frameY = 0; // centered on the panel slab
  // side rails (run along Z)
  for (const sx of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(frameThickness, frameHeight, panelD),
      frameMat
    );
    rail.position.set((sx * panelW) / 2, frameY, 0);
    rail.castShadow = true;
    panelPivot.add(rail);
  }
  // end rails (run along X)
  for (const sz of [-1, 1]) {
    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(panelW + frameThickness, frameHeight, frameThickness),
      frameMat
    );
    rail.position.set(0, frameY, (sz * panelD) / 2);
    rail.castShadow = true;
    panelPivot.add(rail);
  }

  // --- subtle cell grid: thin dark inset seams ------------------------------
  // One vertical + one horizontal seam splits the panel into a 2×2 cell layout.
  const seamMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color("#0b1019"),
    roughness: 0.35,
    metalness: 0.6,
  });
  const seamWidth = cell * 0.012;
  const seamY = panelThickness / 2 + 0.0005; // sit just on top of the glass
  // seam running along Z (splits X)
  const seamZ = new THREE.Mesh(
    new THREE.BoxGeometry(seamWidth, panelThickness * 0.5, panelD * 0.98),
    seamMat
  );
  seamZ.position.set(0, seamY, 0);
  panelPivot.add(seamZ);
  // seam running along X (splits Z)
  const seamX = new THREE.Mesh(
    new THREE.BoxGeometry(panelW * 0.98, panelThickness * 0.5, seamWidth),
    seamMat
  );
  seamX.position.set(0, seamY, 0);
  panelPivot.add(seamX);

  // --- status light on the frame --------------------------------------------
  const lightMat = materials.glow();
  const light = new THREE.Mesh(
    new THREE.BoxGeometry(cell * 0.06, frameHeight * 1.1, cell * 0.06),
    lightMat
  );
  // mount on a front corner of the frame
  light.position.set((panelW / 2) * 0.85, frameY, (panelD / 2) * 0.92);
  panelPivot.add(light);

  // ==========================================================================
  return {
    object: root,
    setStatus(status: BuildingStatus, pulse: number, env?: KitEnv): void {
      // only the status light brightens at night — the panels themselves stay
      // dark (they're off), and hurt (rust) gets no boost
      const boost = status.alive ? 1 + 0.8 * (env?.night ?? 0) : 1;
      applyGlow(lightMat, statusGlow(status.alive, status.hurt), (0.3 + 0.5 * pulse) * boost);
    },
    dispose(): void {
      disposeObject(root);
    },
  };
};
