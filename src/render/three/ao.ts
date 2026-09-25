/* ============================================================================
   ColonyAOPass — three's GTAO with a stricter G-buffer. GTAOPass renders the
   scene's depth + normals itself and hides only points and lines while doing
   it; VIVARIUM also draws sprites (reaction bubbles, name tags), additive
   beams and rings, translucent corridor skins, ground decals and the
   placement ghost, all of which would write depth and draw dark halos.
   aoVisible() is the whole rule; the subclass applies it and GTAOPass's own
   restoreVisibility() puts every object back. The denoise noise is seeded so
   the pass renders identically every time it is rebuilt.
   ============================================================================ */
import * as THREE from "three";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { SimplexNoise } from "three/addons/math/SimplexNoise.js";

/** below this opacity a transparent surface is see-through and doesn't occlude */
export const AO_MIN_OPACITY = 0.85;

type Renderable = THREE.Object3D & {
  isPoints?: boolean;
  isLine?: boolean;
  isSprite?: boolean;
  material?: THREE.Material | THREE.Material[];
};

/** true when a single material should occlude (opaque enough, depth-writing) */
function occludes(m: THREE.Material): boolean {
  if (!m.depthWrite) return false;
  if (m.transparent && m.opacity < AO_MIN_OPACITY) return false;
  return true;
}

/** true when the object belongs in the AO depth/normal pre-render. Called once
 *  per scene object every frame from overrideVisibility() while AO is on, so
 *  this stays allocation-free — no wrapping array for the single-material case. */
export function aoVisible(o: THREE.Object3D): boolean {
  const r = o as Renderable;
  if (r.isPoints || r.isLine || r.isSprite) return false;
  if (o.userData.noAO === true) return false;
  const mats = r.material;
  if (!mats) return true;
  if (Array.isArray(mats)) {
    for (const m of mats) if (!occludes(m)) return false;
    return true;
  }
  return occludes(mats);
}

/** mulberry32 in the { random() } shape SimplexNoise accepts */
function seededRandom(seed: number): { random(): number } {
  let s = seed >>> 0;
  return {
    random() {
      let a = (s += 0x6d2b79f5);
      a = Math.imul(a ^ (a >>> 15), 1 | a);
      a ^= a + Math.imul(a ^ (a >>> 7), 61 | a);
      return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export class ColonyAOPass extends GTAOPass {
  constructor(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    super(scene, camera, width, height);
    // world units: an orthographic camera reads the radius in scene units
    this.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1, thickness: 1, distanceFallOff: 1, scale: 1, samples: 16 });
    this.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.blendIntensity = 0.9;
  }

  /** GTAOPass seeds its denoise noise from Math.random; a fixed stream keeps
   *  frames identical across rebuilds (quality toggles, bloom on/off) */
  override generateNoise(size = 64): THREE.DataTexture {
    const simplex = new SimplexNoise(seededRandom(0x5eed_a0));
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) {
        const k = (i * size + j) * 4;
        data[k] = (simplex.noise(i, j) * 0.5 + 0.5) * 255;
        data[k + 1] = (simplex.noise(i + size, j) * 0.5 + 0.5) * 255;
        data[k + 2] = (simplex.noise(i, j + size) * 0.5 + 0.5) * 255;
        data[k + 3] = (simplex.noise(i + size, j + size) * 0.5 + 0.5) * 255;
      }
    }
    const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.needsUpdate = true;
    return texture;
  }

  override overrideVisibility(): void {
    // GTAOPass keeps the pre-override state here and restoreVisibility() replays it
    const cache = (this as unknown as { _visibilityCache: Map<THREE.Object3D, boolean> })._visibilityCache;
    this.scene.traverse((o) => {
      cache.set(o, o.visible);
      if (!aoVisible(o)) o.visible = false;
    });
  }

  override dispose(): void {
    super.dispose();
    // GTAOPass.dispose() leaves these two materials behind
    this.gtaoMaterial.dispose();
    this.blendMaterial.dispose();
  }
}
