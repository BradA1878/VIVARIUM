/* ============================================================================
   The colony's surface — a continuous displaced plane (no checkerboard) with
   instanced boulders scattered past the play grid. Noise + colour ported from
   render.js (fbm / drawTerrain). InstancedMesh for the rock field (doc §1). The
   seeds + palette + rock/monolith tints are per-WORLD (worldlook.ts); the faint
   soil finish adds shading detail without changing the surface or its colors.
   ============================================================================ */
import * as THREE from "three";
import type { World } from "@shared/types";
import { CELL, GridSpace, SCENIC_MARGIN } from "./coords";
import { worldLook, type WorldLook } from "./worldlook";
import { createSurfaceDetail, roughnessWithDetail } from "./surface-detail";
import { applyGroundDetail } from "./ground-shader";
import { greebleRng } from "./kit/contract";
import { buildPebbles } from "./pebbles";

function hash(x: number, y: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const tl = hash(xi, yi), tr = hash(xi + 1, yi), bl = hash(xi, yi + 1), br = hash(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return tl * (1 - u) * (1 - v) + tr * u * (1 - v) + bl * (1 - u) * v + br * u * v;
}
function fbm(x: number, y: number): number {
  let s = 0, a = 0.6, f = 1;
  for (let i = 0; i < 3; i++) { s += a * vnoise(x * f, y * f); f *= 2.1; a *= 0.5; }
  return s;
}

const smooth01 = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

/** Half-extent of the rendered ground, in world units (176 one-unit segments;
 *  the bump map's 8-unit repeat stays whole: 176/8 = 22). At full zoom-out
 *  (CAMERA_MAX_VIEW 22) panned to a grid corner, the four screen corners reach
 *  76.5 units from the origin on a 16:9 screen and 86.2 on an ultrawide 2.4:1
 *  — see terrain.test.ts's screen-coverage test for the full spread across
 *  aspect ratios. The ground fades into the fog color over its last 10 units
 *  (EDGE_HAZE_START below), and scene.ts paints the background the same fog
 *  color, so a screen wide enough to reach past FAR_EDGE sees haze, never an
 *  edge. */
export const FAR_EDGE = 88;

/** World-space distance (from the origin) where the edge haze starts fading
 *  the ground to the fog color, ending at FAR_EDGE. Scenery (rocks, monoliths)
 *  scatters only up to here — placing them further out would be wasted draws
 *  in a band that's rendering as fog anyway. */
export const EDGE_HAZE_START = FAR_EDGE - 10;

/** Test the complete rotated silhouette, including the lean of tall spires.
 *  A center outside the grid is not enough in a narrow scenic border. */
function fitsScenicBorder(bounds: THREE.Box3, half: number, edge: number): boolean {
  const gap = 0.02 * CELL;
  const outsideGrid = bounds.max.x <= -half - gap || bounds.min.x >= half + gap
    || bounds.max.z <= -half - gap || bounds.min.z >= half + gap;
  return outsideGrid && bounds.min.x >= -edge + gap && bounds.max.x <= edge - gap
    && bounds.min.z >= -edge + gap && bounds.max.z <= edge - gap;
}

/** Seeded candidates in the four perimeter strips, independent of grid size. */
function borderPoint(rng: () => number, half: number, edge: number): { x: number; z: number } {
  const side = Math.floor(rng() * 4);
  const along = (rng() * 2 - 1) * edge;
  const across = half + rng() * (edge - half);
  return {
    x: side < 2 ? (side === 0 ? -across : across) : along,
    z: side < 2 ? along : (side === 2 ? -across : across),
  };
}

/** Per-world rock count authored for the old narrow scenic border, scaled up
 *  so the far field reads at the same density instead of thinning out. The
 *  scenic ring now runs half()..EDGE_HAZE_START instead of half()..the old
 *  (narrower) FAR_EDGE, about 19% more area, so ×7 keeps the density of the
 *  originally tuned ×6. */
export function farRockCount(look: WorldLook): number {
  return Math.round(look.rocks.count * 7);
}

export class Terrain {
  readonly group = new THREE.Group();
  readonly surfaceStep = CELL;
  readonly surfaceHalfSpan: number;
  private readonly surfaceHeights: Float32Array;
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  // InstancedMesh's instance-matrix/instance-color buffers are only freed by
  // its own dispose() (r169) — geometry/material dispose alone leaks them.
  private readonly instancedMeshes: THREE.InstancedMesh[] = [];
  /** displaced surface at world (x, z): base noise flattened over the play
   *  grid plus the far ridged relief and broad dune swells — shared by the
   *  plane verts and the rock/monolith scatter so everything sits on the
   *  same ground. */
  private sample: (x: number, z: number) => { h: number; ridge: number; n: number; dune: number };

  constructor(grid: GridSpace, world: World = "mars", margin = SCENIC_MARGIN) {
    const look = worldLook(world);
    // per-world ground palette, minted once (Mars values reproduce RUST_LO/HI,
    // OCHRE, BASALT exactly — see worldlook.ts)
    const groundLo = new THREE.Color(look.ground.lo);
    const groundHi = new THREE.Color(look.ground.hi);
    const accent = new THREE.Color(look.ground.accent);
    const ridgeColor = new THREE.Color(look.ground.ridge);
    const span = 2 * FAR_EDGE;
    const segs = (2 * FAR_EDGE) / CELL;
    const half = grid.half();
    const edge = FAR_EDGE;
    this.surfaceHalfSpan = edge;
    // The terrain lattice only resolves to CELL steps. On an odd grid, half()
    // (e.g. 20.5) falls between vertices, so a heightAt() query exactly on
    // the boundary would bilinearly blend in the neighbor vertex just past
    // it — which is already ramping — and read as a bump right at the edge
    // of the outermost buildings. Snap the ramp's start out to that
    // neighbor's lattice line instead, so every vertex at or inside the
    // boundary stays fully flat.
    const rampStart = Math.ceil(half / CELL) * CELL;

    this.sample = (x, z) => {
      // grid-space sample coords (match render.js scale loosely)
      const gx = x / CELL + grid.N / 2, gy = z / CELL + grid.N / 2;
      const n = fbm(gx * 0.5 + 4, gy * 0.5 + 9);
      const dune = vnoise(gx * look.relief.duneFreq + 20, gy * look.relief.duneFreq + 3);
      // Scenic height starts outside the square construction area, including
      // its corners. Normalize over the actual border, even when it is short;
      // with no border the whole surface keeps its gentle 15% base variation.
      const outside = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - rampStart);
      const ramp = margin > 0 ? smooth01(outside / (margin * CELL)) : 0;
      const flat = 0.15 + 0.85 * ramp;
      const base = ((n - 0.5) * look.relief.noise + (dune - 0.5) * look.relief.dune) * flat;
      // The familiar ridged profile now lives entirely in that scenic border.
      const rn = vnoise(gx * 0.22 + 40, gy * 0.22 + 17);
      const crest = (1 - Math.abs(2 * rn - 1)) ** 2;
      const ridge = crest * look.relief.ridge * ramp;
      // Broad swells past the ridge band so the far field keeps reading as
      // terrain in the haze instead of flattening out. Zero inside the grid
      // and through the start of the ramp, same as the ridge above.
      const farDune = (vnoise(gx * 0.035 + 7, gy * 0.035 + 11) - 0.5) * 2.2 * ramp;
      return { h: base + ridge + farDune, ridge, n, dune };
    };

    // ---- displaced ground plane ----
    const geo = new THREE.PlaneGeometry(span, span, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    this.surfaceHeights = new Float32Array(pos.count);
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const s = this.sample(x, z);
      pos.setY(i, s.h);
      this.surfaceHeights[i] = s.h;
      const c = groundLo.clone().lerp(groundHi, Math.min(1, s.n * 0.72 + s.dune * 0.28));
      c.lerp(accent, s.dune * 0.3);
      // ridge tops/faces fall toward dark shadowed rock so the far relief reads
      // against the fog (the color remains entirely vertex-driven)
      if (s.ridge > 0) c.lerp(ridgeColor, Math.min(0.7, s.ridge * 0.38));
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const detail = createSurfaceDetail("soil", look.rockSeed ^ 0x5011);
    const tileSpan = 8 * CELL;
    detail.texture.repeat.set(span / tileSpan, span / tileSpan);
    // Plane UVs run +X/-Z. Anchor the tile to world zero so changing the grid
    // size or terrain margin keeps each ripple at the same scale and position.
    detail.texture.offset.set(-edge / tileSpan, -edge / tileSpan);
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true, ...roughnessWithDetail(look.mat.rough, detail), metalness: look.mat.metal,
      bumpMap: detail.texture, bumpScale: 0.02 * CELL,
      emissive: new THREE.Color(look.ground.accent), emissiveIntensity: look.mat.emissive, // 0 for mars (no glow); Io's faint lava
      envMapIntensity: look.mat.skyFill,
    });
    // world-space grain, patches and pebble speckle in the soil's shader, plus
    // the edge haze that fades the far field into the fog color
    applyGroundDetail(mat, look.rockSeed, { start: EDGE_HAZE_START, end: FAR_EDGE - 0.5 });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.group.add(ground);
    this.disposables.push(geo, mat, detail.texture);

    // ---- instanced boulders past the play grid ----
    // Scenery stops at EDGE_HAZE_START, short of FAR_EDGE: past that the
    // ground itself is fading to the fog color, so placing rocks/monoliths
    // there would just be draws inside the haze.
    this.scatterRocks(half, EDGE_HAZE_START, look);

    // ---- distant monoliths on the far relief ----
    this.scatterMonoliths(half, EDGE_HAZE_START, look);

    // ---- tiny pebbles over the build area and its border ----
    // Small enough that structures simply cover them; they sit on the rendered
    // triangles (heightAt), so they rebuild with the terrain on a world change.
    const pebbles = buildPebbles((x, z) => this.heightAt(x, z), half + margin * CELL, look);
    this.group.add(pebbles);
    this.disposables.push(pebbles.geometry, pebbles.material as THREE.Material);
    this.instancedMeshes.push(pebbles);
  }

  /** Height on the rendered triangles, not the underlying continuous noise.
   *  Ground decals must share these planes to avoid cutting through the soil. */
  heightAt(x: number, z: number): number {
    const half = this.surfaceHalfSpan;
    const cells = (half * 2) / CELL;
    const gx = Math.max(0, Math.min(cells, (x + half) / CELL));
    const gz = Math.max(0, Math.min(cells, (z + half) / CELL));
    const ix = Math.min(cells - 1, Math.floor(gx));
    const iz = Math.min(cells - 1, Math.floor(gz));
    const fx = gx - ix, fz = gz - iz;
    const row = cells + 1, index = iz * row + ix;
    const h00 = this.surfaceHeights[index];
    const h10 = this.surfaceHeights[index + 1];
    const h01 = this.surfaceHeights[index + row];
    const h11 = this.surfaceHeights[index + row + 1];
    return fx + fz <= 1
      ? h00 + (h10 - h00) * fx + (h01 - h00) * fz
      : h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  private scatterRocks(half: number, edge: number, look: WorldLook): void {
    const rng = greebleRng(look.rockSeed);
    const count = farRockCount(look);
    const rockGeo = new THREE.IcosahedronGeometry(1, look.rocks.detail); // detail 0 = jagged shards, 1+ = rounder
    // rough up the rock a touch
    const rp = rockGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < rp.count; i++) {
      const f = 0.7 + hash(i + 1, 7) * 0.5;
      rp.setXYZ(i, rp.getX(i) * f, rp.getY(i) * f * look.rocks.squash, rp.getZ(i) * f);
    }
    rockGeo.computeVertexNormals();
    rockGeo.computeBoundingBox();
    const rockMat = new THREE.MeshStandardMaterial({ color: look.rockColor, roughness: 0.95, metalness: 0.03 });
    const mesh = new THREE.InstancedMesh(rockGeo, rockMat, count);
    mesh.name = "scenic-rocks";
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const bounds = new THREE.Box3();
    let placed = 0;
    // Aim at the scenic border so enlarging the build area does not empty the
    // rock field. Bound retries: a narrower border may simply fit fewer rocks.
    for (let attempt = 0; attempt < count * 20 && placed < count && edge > half; attempt++) {
      const p = borderPoint(rng, half, edge);
      const s = look.rocks.min + rng() * (look.rocks.max - look.rocks.min);
      dummy.position.set(p.x, this.heightAt(p.x, p.z) + s * 0.4 - 0.1, p.z);
      dummy.rotation.set(rng() * 0.4, rng() * 6.28, rng() * 0.4);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      bounds.copy(rockGeo.boundingBox!).applyMatrix4(dummy.matrix);
      if (!fitsScenicBorder(bounds, half, edge)) continue;
      mesh.setMatrixAt(placed++, dummy.matrix);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.disposables.push(rockGeo, rockMat);
    this.instancedMeshes.push(mesh);
  }

  /** Tapered five-sided basalt monoliths out on the far relief — tall
   *  silhouettes for the fog line. The per-world base count (mars 7) is
   *  tripled for the wider far field. Their rng is a separate seeded stream,
   *  so the boulder field above is untouched by their draws. */
  private scatterMonoliths(half: number, edge: number, look: WorldLook): void {
    const rng = greebleRng(look.monolithSeed);
    const count = look.monoliths.count * 3;
    const geo = new THREE.CylinderGeometry(0.34, 0.62, 1, 5, 1);
    geo.translate(0, 0.5, 0); // base at y = 0 so scale.y sets the height
    geo.computeBoundingBox();
    const mat = new THREE.MeshStandardMaterial({ color: look.monolithColor, roughness: 0.92, metalness: 0.05 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.name = "scenic-monoliths";
    mesh.castShadow = false; // scenic silhouettes need no extra shadow draws
    const dummy = new THREE.Object3D();
    const bounds = new THREE.Box3();
    let placed = 0;
    for (let attempt = 0; attempt < 300 && placed < count && edge > half; attempt++) {
      // Sample the four perimeter strips instead of a fixed-radius ring that
      // would drift into construction cells as the grid grows.
      const { x, z } = borderPoint(rng, half, edge);
      const h = 2.5 + rng() * 2.5;
      dummy.position.set(x, this.heightAt(x, z) - 0.3, z); // base sunk into the ridge
      dummy.rotation.set((rng() - 0.5) * 0.12, rng() * Math.PI * 2, (rng() - 0.5) * 0.12);
      dummy.scale.set(0.7 + rng() * 0.7, h, 0.7 + rng() * 0.7);
      dummy.updateMatrix();
      bounds.copy(geo.boundingBox!).applyMatrix4(dummy.matrix);
      if (!fitsScenicBorder(bounds, half, edge)) continue;
      mesh.setMatrixAt(placed++, dummy.matrix);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.disposables.push(geo, mat);
    this.instancedMeshes.push(mesh);
  }

  /** show or hide the decorative scenery (far rocks, monoliths, pebbles). The
   *  renderer hides it on a software WebGL renderer, where its ~130k instanced
   *  vertices are shaded on the CPU every frame; the ground stays. */
  setScenery(visible: boolean): void {
    for (const mesh of this.instancedMeshes) mesh.visible = visible;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const mesh of this.instancedMeshes) mesh.dispose();
  }
}
