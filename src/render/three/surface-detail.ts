/** Small repeating data maps: surface finish only, with no albedo changes or
 *  displaced vertices. Mipmaps let the detail settle away at overview scale. */
import * as THREE from "three";

export interface SurfaceDetail {
  texture: THREE.DataTexture;
  /** Mean of the stored green channel, after byte quantization. */
  roughnessMean: number;
}

function sampleCell(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Wrapped lattice noise keeps both the value and slope continuous at a tile
 *  boundary. The seed is render-local; it never consumes a world-gen stream. */
function tileNoise(u: number, v: number, cells: number, seed: number): number {
  const x = u * cells, y = v * cells;
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = sampleCell(ix % cells, iy % cells, seed);
  const b = sampleCell((ix + 1) % cells, iy % cells, seed);
  const c = sampleCell(ix % cells, (iy + 1) % cells, seed);
  const d = sampleCell((ix + 1) % cells, (iy + 1) % cells, seed);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

export function createSurfaceDetail(kind: "metal" | "soil", seed: number): SurfaceDetail {
  const size = kind === "metal" ? 64 : 128;
  const data = new Uint8Array(size * size * 4);
  let roughnessTotal = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = (x + 0.5) / size, v = (y + 0.5) / size;
    const broad = tileNoise(u, v, 4, seed);
    const fine = tileNoise(u, v, 16, seed ^ 0x77aa);
    const grain = 0.65 * broad + 0.35 * fine;
    const i = (y * size + x) * 4;
    if (kind === "soil") {
      // Twelve soft crests per tile, bent by a seamless slow crosswind.
      const ripple = Math.sin(Math.PI * 2 * (12 * v + 0.35 * Math.sin(Math.PI * 4 * u) + 0.25 * broad));
      data[i] = Math.round(128 + 20 * ripple + 12 * (fine * 2 - 1));
      data[i + 1] = Math.round(251 + 4 * grain);
    } else {
      data[i] = 128;
      data[i + 1] = Math.round(245 + 10 * grain);
    }
    data[i + 2] = data[i + 3] = 255;
    roughnessTotal += data[i + 1];
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.name = `${kind}-surface-detail`;
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return { texture, roughnessMean: roughnessTotal / (size * size * 255) };
}

/** StandardMaterial multiplies roughness by the map's green channel. Divide
 *  by its actual mean so adding detail does not make the whole material glossy.
 *  Near perfectly matte, retain the original finish instead of exceeding 1. */
export function roughnessWithDetail(roughness: number, detail: SurfaceDetail): Pick<THREE.MeshStandardMaterialParameters, "roughness" | "roughnessMap"> {
  const compensated = roughness / detail.roughnessMean;
  return compensated <= 1
    ? { roughness: compensated, roughnessMap: detail.texture }
    : { roughness };
}
