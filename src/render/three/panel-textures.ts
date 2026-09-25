/** Procedural maps for the PV cell grid (solar panels) and the dome cap's
 *  paneled shell. Same integer-hash approach as surface-detail.ts: pure
 *  functions of (coords, seed), no DOM/Math.random, so panel dressing is
 *  reproducible across a save/reload. */
import * as THREE from "three";

/** Integer hash → [0,1), same mixing as surface-detail.ts's sampleCell. */
function hash(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 0x1f123bb5) ^ Math.imul(y, 0x5f356495) ^ seed;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Cells per side of the PV grid. */
export const PV_CELLS = 6;

const SILICON: readonly [number, number, number] = [26, 42, 70];
const BUS_BAR: readonly [number, number, number] = [120, 128, 138];
const GRID_LINE: readonly [number, number, number] = [150, 158, 168];

/** A seeded sRGB albedo map of dark blue-black silicon cells: two vertical
 *  bus bars per cell and light grid lines at the cell edges, each cell tinted
 *  a little differently so the array doesn't look printed. */
export function createPvCellTexture(seed: number, size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const cellPx = size / PV_CELLS;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = Math.floor(x / cellPx);
      const cy = Math.floor(y / cellPx);
      const localX = x - cx * cellPx;
      const localY = y - cy * cellPx;
      const fx = localX / cellPx;
      const edgeDist = Math.min(localX, cellPx - localX, localY, cellPx - localY);
      const busDist = Math.min(Math.abs(fx - 1 / 3), Math.abs(fx - 2 / 3)) * cellPx;
      let r: number, g: number, b: number;
      if (edgeDist < 1.2) {
        [r, g, b] = GRID_LINE;
      } else if (busDist < 0.8) {
        [r, g, b] = BUS_BAR;
      } else {
        const tint = 0.94 + 0.12 * hash(cx, cy, seed);
        r = Math.round(SILICON[0] * tint);
        g = Math.round(SILICON[1] * tint);
        b = Math.round(SILICON[2] * tint);
      }
      const i = (y * size + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.name = "pv-cell";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Meridian seam count around the dome. */
export const DOME_MERIDIANS = 16;
/** v-fraction (equator = 0, apex = 1) of each ring seam, apex-most last. */
export const DOME_RINGS: readonly number[] = [0.32, 0.62, 0.86];

export interface PanelMap {
  texture: THREE.DataTexture;
  /** Mean of the stored roughness (green) channel, after byte quantization. */
  roughnessMean: number;
}

/** A linear bump+roughness map for the dome's paneled shell: grooved seams at
 *  each meridian and ring, flat panels between them, and a per-panel
 *  roughness variation seeded by `seed`. R = bump height (low at a seam,
 *  high across a panel), G = roughness multiplier. UVs follow
 *  SphereGeometry's hemisphere convention: v = 0 at the equator, v = 1 at the
 *  apex. Meridians stop short of the top ring, where they'd converge to a
 *  point. */
export function createDomePanelTexture(seed: number, width = 256, height = 128): PanelMap {
  const data = new Uint8Array(width * height * 4);
  const topRing = DOME_RINGS[DOME_RINGS.length - 1];
  let roughnessTotal = 0;
  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    let band = 0;
    for (const ring of DOME_RINGS) if (v >= ring) band++;
    let ringDist = Infinity;
    for (const ring of DOME_RINGS) ringDist = Math.min(ringDist, Math.abs(v - ring) * height);
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const uM = u * DOME_MERIDIANS;
      const meridianDist = v < topRing ? Math.abs(uM - Math.round(uM)) * (width / DOME_MERIDIANS) : Infinity;
      const seam = Math.min(meridianDist, ringDist);
      const groove = seam < 1 ? 0 : seam < 2 ? 0.5 : 1;
      const panelId = Math.floor(uM) + DOME_MERIDIANS * band;
      const g = Math.round(255 * (0.85 + 0.15 * hash(panelId, 0, seed)));
      const i = (y * width + x) * 4;
      data[i] = Math.round(255 * (0.55 + 0.45 * groove));
      data[i + 1] = g;
      data[i + 2] = 255;
      data[i + 3] = 255;
      roughnessTotal += g;
    }
  }
  const texture = new THREE.DataTexture(data, width, height);
  texture.name = "dome-panel";
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return { texture, roughnessMean: roughnessTotal / (width * height * 255) };
}
