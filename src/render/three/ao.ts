/* ============================================================================
   ColonyAOPass — three's GTAO with a stricter G-buffer. GTAOPass renders the
   scene's depth + normals itself and hides only points and lines while doing
   it; VIVARIUM also draws sprites (reaction bubbles, name tags), additive
   beams and rings, translucent corridor skins, ground decals and the
   placement ghost, all of which would write depth and draw dark halos.
   aoVisible() is the whole rule; the subclass hides what it rejects and shows
   exactly those objects again afterwards. The denoise noise is seeded so the
   pass renders identically every time it is rebuilt.

   Two corrections to three r169's GTAO: its shader takes the view direction
   from the fragment's view position, which holds only for a perspective
   camera (the colony camera is orthographic, where the direction is
   constant), and its G-buffer render goes through renderer.render(), which
   would draw the sun's shadow map a second time each frame.

   The pass multiplies its occlusion straight onto the scene target and never
   swaps the composer's buffers: PostFx relies on an even number of swaps per
   frame so the scene always renders into the HDR target that has a depth
   buffer (see postfx.ts).
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

/** three r169 GTAOShader's view direction: toward the eye, right only for a
 *  perspective camera (the eye sits at the view-space origin) */
const PERSPECTIVE_VIEW_DIR = "vec3 viewDir = normalize(-viewPos.xyz);";
/** an orthographic camera looks down -Z everywhere, so toward the eye is +Z */
const ORTHOGRAPHIC_VIEW_DIR = "vec3 viewDir = vec3( 0.0, 0.0, 1.0 );";

export class ColonyAOPass extends GTAOPass {
  /** what overrideVisibility() hid for this frame's G-buffer; restoreVisibility()
   *  shows exactly these again. Undefined only while GTAOPass's constructor
   *  runs (it calls overridden methods before subclass fields exist), so the
   *  array is created in the constructor body, after super(). */
  private hidden: THREE.Object3D[] | undefined;
  /** the traverse callback, built once so the per-frame hide allocates nothing */
  private readonly hideNonOccluder: (o: THREE.Object3D) => void;

  constructor(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) {
    super(scene, camera, width, height);
    const hidden: THREE.Object3D[] = [];
    this.hidden = hidden;
    this.hideNonOccluder = (o) => {
      if (o.visible && !aoVisible(o)) {
        o.visible = false;
        hidden.push(o);
      }
    };
    if (!(camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      const shader = this.gtaoMaterial.fragmentShader;
      if (!shader.includes(PERSPECTIVE_VIEW_DIR)) {
        // a three upgrade changed the shader: fail here, not with wrong AO
        throw new Error(`ColonyAOPass: GTAOShader no longer contains "${PERSPECTIVE_VIEW_DIR}"; update the orthographic view-direction patch`);
      }
      this.gtaoMaterial.fragmentShader = shader.replace(PERSPECTIVE_VIEW_DIR, ORTHOGRAPHIC_VIEW_DIR);
      this.gtaoMaterial.needsUpdate = true;
    }
    // world units: an orthographic camera reads the radius in scene units
    this.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1, thickness: 1, distanceFallOff: 1, scale: 1, samples: 16 });
    this.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    this.blendIntensity = 0.9;
    // GTAOPass still computes the G-buffer, AO and denoise with output Off; it
    // just draws nothing. render() then blends the result in place.
    this.output = GTAOPass.OUTPUT.Off;
    this.needsSwap = false;
  }

  /** compute AO as GTAOPass does, then multiply it onto the scene target in
   *  place (the blend material is a DstColor × src multiply with no depth test) */
  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    // the G-buffer render calls renderer.render(), which redraws every shadow
    // map while autoUpdate is on; the scene pass already drew this frame's
    const shadowMap = renderer.shadowMap;
    const autoUpdate = shadowMap.autoUpdate;
    shadowMap.autoUpdate = false;
    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      shadowMap.autoUpdate = autoUpdate;
    }
    this.blendMaterial.uniforms.intensity.value = this.blendIntensity;
    this.blendMaterial.uniforms.tDiffuse.value = this.pdRenderTarget.texture;
    this.renderPass(renderer, this.blendMaterial, readBuffer);
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

  /** hide every visible non-occluder for the G-buffer render, remembering
   *  only those (GTAOPass would record every object in a Map each frame) */
  override overrideVisibility(): void {
    const hidden = this.hidden;
    if (!hidden) return; // GTAOPass's constructor is still running: nothing to track
    hidden.length = 0;
    this.scene.traverse(this.hideNonOccluder);
  }

  /** show exactly what overrideVisibility() hid; anything the app had hidden
   *  itself was never touched */
  override restoreVisibility(): void {
    const hidden = this.hidden;
    if (!hidden) return;
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
    hidden.length = 0;
  }

  override dispose(): void {
    super.dispose();
    // GTAOPass.dispose() leaves these two materials behind
    this.gtaoMaterial.dispose();
    this.blendMaterial.dispose();
  }
}
