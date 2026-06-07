/* ============================================================================
   Atmosphere — wind-blown Martian dust. A constant particle field that sits
   faint in clear weather and thickens, speeds up, and reddens during a dust
   storm (prototype drawDust / drawStormVeil, ported to a 3D Points system). The
   solar gutting itself lives in the engine; this is the visible weather.
   ============================================================================ */
import * as THREE from "three";
import { GridSpace } from "./coords";

const COUNT = 600;

export class Atmosphere {
  readonly points: THREE.Points;
  private positions: Float32Array;
  private speeds: Float32Array;
  private material: THREE.PointsMaterial;
  private geo: THREE.BufferGeometry;
  private spanX: number;
  private spanZ: number;
  private storm = 0; // smoothed 0..1

  constructor(grid: GridSpace) {
    const half = grid.half() + 8;
    this.spanX = half * 2;
    this.spanZ = half * 2;
    this.positions = new Float32Array(COUNT * 3);
    this.speeds = new Float32Array(COUNT);

    // deterministic scatter (avoid Math.random for reproducibility)
    let s = 0x1234abcd;
    const rnd = () => {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    for (let i = 0; i < COUNT; i++) {
      this.positions[i * 3] = (rnd() - 0.5) * this.spanX;
      this.positions[i * 3 + 1] = rnd() * 7 + 0.2;
      this.positions[i * 3 + 2] = (rnd() - 0.5) * this.spanZ;
      this.speeds[i] = 0.4 + rnd() * 1.2;
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.material = new THREE.PointsMaterial({
      color: new THREE.Color("#9a785e"),
      size: 0.06,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
  }

  /** drift the dust; thicken + redden + speed up toward `dust` weather */
  update(dt: number, dust: boolean): void {
    // ease the storm factor so weather changes ramp rather than snap
    const target = dust ? 1 : 0;
    this.storm += (target - this.storm) * Math.min(1, dt * 1.5);

    const wind = (0.6 + this.storm * 2.4) * dt;
    const halfX = this.spanX / 2;
    for (let i = 0; i < COUNT; i++) {
      const xi = i * 3;
      this.positions[xi] += this.speeds[i] * wind;
      if (this.positions[xi] > halfX) {
        this.positions[xi] = -halfX;
        this.positions[xi + 2] = (this.fract(this.positions[xi + 2] * 13.13 + i) - 0.5) * this.spanZ;
      }
    }
    this.geo.attributes.position.needsUpdate = true;

    this.material.opacity = 0.1 + this.storm * 0.5;
    this.material.size = 0.05 + this.storm * 0.05;
    this.material.color.setRGB(
      0.6 + this.storm * 0.2,
      0.47 + this.storm * 0.09,
      0.37,
    );
  }

  private fract(n: number): number {
    return n - Math.floor(n);
  }

  dispose(): void {
    this.geo.dispose();
    this.material.dispose();
  }
}
