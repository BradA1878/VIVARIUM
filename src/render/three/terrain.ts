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

const smooth01 = (t: number): number => {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
};

const RUST_LO = new THREE.Color(54 / 255, 28 / 255, 21 / 255);
const RUST_HI = new THREE.Color(120 / 255, 64 / 255, 42 / 255);
const OCHRE = new THREE.Color(108 / 255, 58 / 255, 34 / 255);
const BASALT = new THREE.Color(24 / 255, 13 / 255, 11 / 255);

export class Terrain {
  readonly group = new THREE.Group();
  private disposables: (THREE.BufferGeometry | THREE.Material)[] = [];
  /** displaced surface at world (x, z): base noise flattened over the play
   *  grid plus the far ridged relief — shared by the plane verts and the
   *  rock/monolith scatter so everything sits on the same ground. */
  private sample: (x: number, z: number) => { h: number; ridge: number; n: number; dune: number };

  constructor(grid: GridSpace, margin = 10) {
    const span = (grid.N + margin * 2) * CELL;
    const segs = grid.N + margin * 2;
    const half = grid.half();
    const edge = span / 2;

    this.sample = (x, z) => {
      // grid-space sample coords (match render.js scale loosely)
      const gx = x / CELL + grid.N / 2, gy = z / CELL + grid.N / 2;
      const n = fbm(gx * 0.5 + 4, gy * 0.5 + 9);
      const dune = vnoise(gx * 0.14 + 20, gy * 0.14 + 3);
      // flatten the play field so placement stays readable: 0.15 of the
      // displacement inside the grid + half a cell, full again ~3 cells out
      const d = Math.max(Math.abs(x), Math.abs(z));
      const flat = 0.15 + 0.85 * smooth01((d - (half + 0.5 * CELL)) / (3 * CELL));
      const base = ((n - 0.5) * 0.5 + (dune - 0.5) * 0.35) * flat;
      // far relief: a ridged band past ~N/2 + 4 cells, ramping toward the fog
      const rn = vnoise(gx * 0.22 + 40, gy * 0.22 + 17);
      const crest = (1 - Math.abs(2 * rn - 1)) ** 2;
      const ramp = smooth01((Math.hypot(x, z) - (half + 4 * CELL)) / (edge - half - 4 * CELL));
      const ridge = crest * 1.8 * ramp;
      return { h: base + ridge, ridge, n, dune };
    };

    // ---- displaced ground plane ----
    const geo = new THREE.PlaneGeometry(span, span, segs, segs);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const colors: number[] = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), z = pos.getZ(i);
      const s = this.sample(x, z);
      pos.setY(i, s.h);
      const c = RUST_LO.clone().lerp(RUST_HI, Math.min(1, s.n * 0.72 + s.dune * 0.28));
      c.lerp(OCHRE, s.dune * 0.3);
      // ridge tops/faces fall toward dark basalt so the far relief reads as
      // shadowed rock against the fog (vertex colours only — no textures)
      if (s.ridge > 0) c.lerp(BASALT, Math.min(0.7, s.ridge * 0.38));
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

    // ---- distant monoliths on the far relief ----
    this.scatterMonoliths(edge);
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
      // the play field is ALWAYS kept clear now — but still consume the legacy
      // keep-roll (+ transform draws when it "survived") so the rng stream and
      // therefore the rest of the field keep their exact layout
      if (gx > -1 && gx < grid.N && gy > -1 && gy < grid.N) {
        if (rng() >= 0.7) { rng(); rng(); rng(); rng(); }
        continue;
      }
      const p = grid.cellCenter(gx, gy);
      const s = 0.18 + rng() * 0.6;
      dummy.position.set(p.x, this.sample(p.x, p.z).h + s * 0.4 - 0.1, p.z);
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

  /** ~7 tapered five-sided basalt monoliths out on the far relief — tall
   *  silhouettes for the fog line. Their rng is a separate seeded stream, so
   *  the boulder field above is untouched by their draws. */
  private scatterMonoliths(edge: number): void {
    const rng = mulberry(0x77aa);
    const count = 7;
    const geo = new THREE.CylinderGeometry(0.34, 0.62, 1, 5, 1);
    geo.translate(0, 0.5, 0); // base at y = 0 so scale.y sets the height
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a1a16, roughness: 0.92, metalness: 0.05 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.castShadow = false; // far outside the shadow camera — never pay for it
    const dummy = new THREE.Object3D();
    let placed = 0;
    for (let attempt = 0; attempt < 300 && placed < count; attempt++) {
      const a = rng() * Math.PI * 2;
      const r = 18 + rng() * 12;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      // the 18–30 ring only overlaps the plane at its corners — keep them on it
      if (Math.max(Math.abs(x), Math.abs(z)) > edge - 1) continue;
      const h = 2.5 + rng() * 2.5;
      dummy.position.set(x, this.sample(x, z).h - 0.3, z); // base sunk into the ridge
      dummy.rotation.set((rng() - 0.5) * 0.12, rng() * Math.PI * 2, (rng() - 0.5) * 0.12);
      dummy.scale.set(0.7 + rng() * 0.7, h, 0.7 + rng() * 0.7);
      dummy.updateMatrix();
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
