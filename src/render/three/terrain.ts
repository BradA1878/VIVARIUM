/* ============================================================================
   The Martian surface — a continuous displaced rust plane (no checkerboard) with
   instanced boulders scattered past the play grid. Noise + colour ported from
   render.js (fbm / drawTerrain). InstancedMesh for the rock field (doc §1).
   ============================================================================ */
import * as THREE from "three";
import { CELL, GridSpace } from "./coords";

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

const RUST_LO = new THREE.Color(54 / 255, 28 / 255, 21 / 255);
const RUST_HI = new THREE.Color(120 / 255, 64 / 255, 42 / 255);
const OCHRE = new THREE.Color(108 / 255, 58 / 255, 34 / 255);

export class Terrain {
  readonly group = new THREE.Group();
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];

  constructor(grid: GridSpace, margin = 7) {
    const span = (grid.N + margin * 2) * CELL;
    const segs = grid.N + margin * 2;

    // ---- displaced ground plane ----
    const geo = new THREE.PlaneGeometry(span, span, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      // grid-space sample coords (match render.js scale loosely)
      const gx = x / CELL + grid.N / 2, gy = z / CELL + grid.N / 2;
      const n = fbm(gx * 0.5 + 4, gy * 0.5 + 9);
      const dune = vnoise(gx * 0.14 + 20, gy * 0.14 + 3);
      const height = (n - 0.5) * 0.5 + (dune - 0.5) * 0.35;
      pos.setY(i, height);
      const c = RUST_LO.clone().lerp(RUST_HI, Math.min(1, n * 0.72 + dune * 0.28));
      c.lerp(OCHRE, dune * 0.3);
      colors.push(c.r, c.g, c.b);
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.97, metalness: 0.02 });
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    this.group.add(ground);
    this.disposables.push(geo, mat);

    // ---- instanced boulders past the play grid ----
    this.scatterRocks(grid, margin);
  }

  private scatterRocks(grid: GridSpace, margin: number): void {
    const rng = mulberry(98213);
    const count = 90;
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    // rough up the rock a touch
    const rp = rockGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < rp.count; i++) {
      const f = 0.7 + hash(i + 1, 7) * 0.5;
      rp.setXYZ(i, rp.getX(i) * f, rp.getY(i) * f * 0.7, rp.getZ(i) * f);
    }
    rockGeo.computeVertexNormals();
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x5a3322, roughness: 0.95, metalness: 0.03 });
    const mesh = new THREE.InstancedMesh(rockGeo, rockMat, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const lo = -margin, hi = grid.N + margin;
    const dummy = new THREE.Object3D();
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const gx = lo + rng() * (hi - lo);
      const gy = lo + rng() * (hi - lo);
      // keep the play field mostly clear
      if (gx > -1 && gx < grid.N && gy > -1 && gy < grid.N && rng() < 0.7) continue;
      const p = grid.cellCenter(gx, gy);
      const s = 0.18 + rng() * 0.6;
      dummy.position.set(p.x, s * 0.4 - 0.1, p.z);
      dummy.rotation.set(rng() * 0.4, rng() * 6.28, rng() * 0.4);
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed++, dummy.matrix);
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.disposables.push(rockGeo, rockMat);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
