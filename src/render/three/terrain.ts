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
function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    let a = (s += 0x6d2b79f5);
    a = Math.imul(a ^ (a >>> 15), 1 | a);
    a ^= a + Math.imul(a ^ (a >>> 7), 61 | a);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}

const smooth01 = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

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

export class Terrain {
  readonly group = new THREE.Group();
  readonly surfaceStep = CELL;
  readonly surfaceHalfSpan: number;
  private readonly surfaceHeights: Float32Array;
  private disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];
  /** displaced surface at world (x, z): base noise flattened over the play
   *  grid plus the far ridged relief — shared by the plane verts and the
   *  rock/monolith scatter so everything sits on the same ground. */
  private sample: (x: number, z: number) => { h: number; ridge: number; n: number; dune: number };

  constructor(grid: GridSpace, world: World = "mars", margin = SCENIC_MARGIN) {
    const look = worldLook(world);
    // per-world ground palette, minted once (Mars values reproduce RUST_LO/HI,
    // OCHRE, BASALT exactly — see worldlook.ts)
    const groundLo = new THREE.Color(look.ground.lo);
    const groundHi = new THREE.Color(look.ground.hi);
    const accent = new THREE.Color(look.ground.accent);
    const ridgeColor = new THREE.Color(look.ground.ridge);
    const span = (grid.N + margin * 2) * CELL;
    const segs = grid.N + margin * 2;
    const half = grid.half();
    const edge = span / 2;
    this.surfaceHalfSpan = edge;

    this.sample = (x, z) => {
      // grid-space sample coords (match render.js scale loosely)
      const gx = x / CELL + grid.N / 2, gy = z / CELL + grid.N / 2;
      const n = fbm(gx * 0.5 + 4, gy * 0.5 + 9);
      const dune = vnoise(gx * look.relief.duneFreq + 20, gy * look.relief.duneFreq + 3);
      // Scenic height starts outside the square construction area, including
      // its corners. Normalize over the actual border, even when it is short;
      // with no border the whole surface keeps its gentle 15% base variation.
      const outside = Math.max(0, Math.max(Math.abs(x), Math.abs(z)) - half);
      const ramp = margin > 0 ? smooth01(outside / (margin * CELL)) : 0;
      const flat = 0.15 + 0.85 * ramp;
      const base = ((n - 0.5) * look.relief.noise + (dune - 0.5) * look.relief.dune) * flat;
      // The familiar ridged profile now lives entirely in that scenic border.
      const rn = vnoise(gx * 0.22 + 40, gy * 0.22 + 17);
      const crest = (1 - Math.abs(2 * rn - 1)) ** 2;
      const ridge = crest * look.relief.ridge * ramp;
      return { h: base + ridge, ridge, n, dune };
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
    });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.group.add(ground);
    this.disposables.push(geo, mat, detail.texture);

    // ---- instanced boulders past the play grid ----
    this.scatterRocks(half, edge, look);

    // ---- distant monoliths on the far relief ----
    this.scatterMonoliths(half, edge, look);
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
    const rng = mulberry(look.rockSeed);
    // The authored count was a whole-plane candidate budget. Keep that area
    // density when concentrating candidates into the remaining scenic strips.
    const count = Math.round(look.rocks.count * (1 - (half / edge) ** 2));
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
  }

  /** ~7 tapered five-sided basalt monoliths out on the far relief — tall
   *  silhouettes for the fog line. Their rng is a separate seeded stream, so
   *  the boulder field above is untouched by their draws. */
  private scatterMonoliths(half: number, edge: number, look: WorldLook): void {
    const rng = mulberry(look.monolithSeed);
    const count = look.monoliths.count;
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
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
