/* ============================================================================
   SceneManager — the WebGL scene, an isometric-style orthographic camera, the
   day/night sun, and atmosphere. The iso look comes from the camera angle (doc
   §4.6: the renderer is the only layer that changed from the 2D prototype). The
   ambient curve and sky colours are ported from render.js (ambient/drawSky).
   The world's sky is baked into scene.environment (environment.ts) for
   reflections and sky/ground fill, and the sun's shadow map is fitted to the
   visible ground every frame (shadow-fit.ts).
   ============================================================================ */
import * as THREE from "three";
import type { World } from "@shared/types";
import { CAMERA_ISO_OFFSET } from "./camera-controls";
import { PostFx } from "./postfx";
import { worldLook, type RGB, type SkyLook } from "./worldlook";
import type { Grade } from "./grade-fxaa";
import { SkyEnvironment, envIntensity, type SkyState } from "./environment";
import { SHADOW_LIGHT_DISTANCE, emptyOrthoView, emptyShadowFit, fitShadow, orthoViewOf } from "./shadow-fit";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpColor(a: RGB, b: RGB, t: number, target: THREE.Color): THREE.Color {
  return target.setRGB(
    lerp(a[0], b[0], t) / 255,
    lerp(a[1], b[1], t) / 255,
    lerp(a[2], b[2], t) / 255,
    THREE.LinearSRGBColorSpace,
  );
}

/** the flat fill left under the sky environment: enough to keep corners the
 *  environment cannot reach off pure black, no more */
const AMBIENT_FLOOR = 0.04;
const AMBIENT_DAY = 0.06;
/** the sun's gain over the original curve, balanced with the sky environment's
 *  ENV_BASE so shadows read against the fill */
const SUN_GAIN = 1.5;
/** fog distances from the camera: clear air, and a dust storm closing in */
const FOG_NEAR = 38;
const FOG_FAR = 86;
// three's fog is a smoothstep between near and far, not linear: the colony
// sits ~47.5 units from the camera at every zoom (orthographic), which comes
// to about 10% fogged in clear air (38/86 above) and about 22% fogged once
// the storm values below close the distance in
const FOG_NEAR_DUST = 34;
const FOG_FAR_DUST = 78;
/** storm haze eases in and out over roughly two seconds */
const FOG_EASE = 0.6;

/** ported from render.js ambient(): brightness 0.07..1 across the sol */
export function ambientLevel(tod: number, dust: boolean): number {
  let l: number;
  if (tod < 0.2) l = 0.07;
  else if (tod < 0.3) l = ((tod - 0.2) / 0.1) * 0.9 + 0.07;
  else if (tod < 0.74) l = 0.97;
  else if (tod < 0.85) l = 0.97 - ((tod - 0.74) / 0.11) * 0.9;
  else l = 0.07;
  if (dust) l *= 0.55;
  return Math.max(0.07, Math.min(1, l));
}

/** how deep into night the scene sits: 0 = full day → 1 = deep night. Derived
 *  from the ambient curve, so a dust storm reads as partial night too — the
 *  kit window/status glows ramp off this. */
export function nightLevel(tod: number, dust: boolean): number {
  return Math.max(0, Math.min(1, (0.97 - ambientLevel(tod, dust)) / 0.9));
}

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly postfx: PostFx;

  private sun: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private skyEnv: SkyEnvironment;
  /** what the environment bake reads; its sunDir is also the sun's direction */
  private readonly skyState: SkyState = {
    world: "mars", daylight: 1, dust: false, sunDir: new THREE.Vector3(0, 1, 0), sunElev: 1,
  };
  private shadowSize: 1024 | 2048 = 2048;
  private readonly shadowView = emptyOrthoView();
  private readonly shadowFit = emptyShadowFit();
  private viewSize = 13;
  /** the iso vantage direction: camera sits at focus + this offset (doc §4.6) */
  private readonly isoOffset = new THREE.Vector3(...CAMERA_ISO_OFFSET);
  private focus = new THREE.Vector3(0, 0, 0);
  /** the active world's sky/sun/ambient tint endpoints update() lerps between —
   *  the mars anchor by default (today's exact constants); re-themed by setWorld */
  private sky: SkyLook = worldLook("mars").sky;
  // per-frame scratch for update() (the render hot path stays allocation-free)
  private readonly horizon = new THREE.Color();
  private readonly background = new THREE.Color();
  /** the active world's final grade, pushed into PostFx on a world change */
  private readonly grade: Grade = { lift: new THREE.Color(), gain: new THREE.Color(1, 1, 1), saturation: 1, vignette: 0 };
  /** 0..1 eased storm haze factor (fog pulls in during dust) */
  private stormHaze = 0;
  private lastUpdateMs: number | null = null;
  /** a restored WebGL context comes back without the baked sky map, so the
   *  next update() re-bakes it */
  private readonly onContextRestored = (): void => this.skyEnv.invalidate();

  constructor(canvas: HTMLCanvasElement) {
    // Every quality tier antialiases in PostFx; multisampling the final
    // fullscreen canvas would add cost without smoothing the scene edges.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    // cap the device pixel ratio at 1.5: on a Retina display 2.0 renders 4× the
    // pixels of 1×, a big GPU/battery cost for low-poly iso art that reads fine
    // at 1.5 (≈2.25× pixels). Saves ~45% of fill vs 2.0.
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
    // classic dimetric/iso vantage: look down the (1, 0.85, 1) diagonal
    this.camera.position.copy(this.isoOffset);
    this.camera.lookAt(0, 0, 0);

    this.scene.fog = new THREE.Fog(0x0b0e12, FOG_NEAR, FOG_FAR);
    this.scene.background = this.background;

    // The sun keeps its established direction; render() wraps its shadow map
    // around whatever the camera can see (shadow-fit.ts), so the frustum and
    // normal bias here are only placeholders until the first frame.
    this.sun = new THREE.DirectionalLight(0xffe6c8, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(this.shadowSize, this.shadowSize);
    this.sun.shadow.bias = -0.0002;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ambientLight = new THREE.AmbientLight(0x4a4660, AMBIENT_FLOOR);
    this.scene.add(this.ambientLight);

    this.skyEnv = new SkyEnvironment(
      new THREE.PMREMGenerator(this.renderer),
      (camera, scene) => camera.update(this.renderer, scene),
    );
    this.renderer.domElement.addEventListener("webglcontextrestored", this.onContextRestored);

    this.postfx = new PostFx(this.renderer, this.scene, this.camera);
    this.setWorld("mars");

    this.resize();
  }

  // ---- graphics levers (the perf governor's ladder drives these one by one;
  // each is a no-op when the value already holds, so steps never churn) -------

  /** pixel-ratio CAP — the device ratio still floors it (see the constructor
   *  note on why 1.5 is the ceiling) */
  setPixelRatio(cap: number): void {
    const r = Math.min(cap, window.devicePixelRatio || 1);
    if (r === this.renderer.getPixelRatio()) return;
    this.renderer.setPixelRatio(r);
    this.postfx.setPixelRatio(r); // live post-processing targets resize to match
    this.resize(); // re-applies the drawing-buffer size at the new pixel ratio
  }

  /** shadow maps on/off — the toggle only takes hold after the materials recompile */
  setShadows(on: boolean): void {
    if (on === this.renderer.shadowMap.enabled) return;
    this.renderer.shadowMap.enabled = on;
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) for (const m of mat) m.needsUpdate = true;
      else if (mat) mat.needsUpdate = true;
    });
  }

  /** shadow-map resolution; the old map is released and reallocated at the new
   *  size on the next shadow render */
  setShadowSize(size: 1024 | 2048): void {
    if (size === this.shadowSize) return;
    this.shadowSize = size;
    this.sun.shadow.mapSize.set(size, size);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
  }

  /** optional bloom; color grading stays consistent across quality tiers */
  setBloom(on: boolean): void {
    this.postfx.setEnabled(on);
  }

  /** optional ambient occlusion (the top ladder steps) */
  setAO(on: boolean): void {
    this.postfx.setAO(on);
  }

  /** environment bakes so far — DEV/QA observability (window.__viv) */
  get envBakes(): number {
    return this.skyEnv.bakes;
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.postfx.setSize(w, h);
    const aspect = w / h;
    const v = this.viewSize;
    this.camera.left = -v * aspect;
    this.camera.right = v * aspect;
    this.camera.top = v;
    this.camera.bottom = -v;
    this.camera.updateProjectionMatrix();
  }

  /** re-theme the sky/sun/ambient tint for a world. Only changes the colour
   *  endpoints update() lerps between; the day/night curve is shared across
   *  worlds. The renderer calls this when snapshot.world changes. */
  setWorld(world: World): void {
    const look = worldLook(world);
    this.sky = look.sky;
    this.skyState.world = world;
    const g = look.grade;
    this.grade.lift.setRGB(g.lift[0] / 255, g.lift[1] / 255, g.lift[2] / 255, THREE.LinearSRGBColorSpace);
    this.grade.gain.setRGB(g.gain[0] / 255, g.gain[1] / 255, g.gain[2] / 255, THREE.LinearSRGBColorSpace);
    this.grade.saturation = g.saturation;
    this.grade.vignette = g.vignette;
    this.postfx.setGrade(this.grade);
  }

  /** Drive sun/sky/ambient from time of day and weather: the fog and background
   *  tint, the sun's direction and strength, and the baked sky environment. */
  update(tod: number, dust: boolean): void {
    const amb = ambientLevel(tod, dust);
    const sk = this.sky;

    // fog and background share the horizon tint: the ground runs out to a far
    // field that fades fully into the fog, so whatever lies past it is haze too
    lerpColor(sk.horizon.night, dust ? sk.horizon.dust : sk.horizon.clear, amb, this.horizon);
    this.background.copy(this.horizon);
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(this.horizon);
    // a dust storm pulls the haze in; eased so weather changes don't snap
    const now = performance.now();
    const dt = this.lastUpdateMs === null ? 0 : Math.min(0.25, (now - this.lastUpdateMs) / 1000);
    this.lastUpdateMs = now;
    this.stormHaze += ((dust ? 1 : 0) - this.stormHaze) * Math.min(1, dt * FOG_EASE);
    fog.near = lerp(FOG_NEAR, FOG_NEAR_DUST, this.stormHaze);
    fog.far = lerp(FOG_FAR, FOG_FAR_DUST, this.stormHaze);

    // sun arcs across the sky with tod; below horizon at night. render() moves
    // the light with the fitted shadow box, keeping this direction.
    const ang = (tod - 0.5) * Math.PI * 2; // noon at top
    const elev = Math.cos(ang);            // 1 at noon, negative at night
    const sx = Math.sin(ang);
    const sunDir = this.skyState.sunDir.set(sx * 30 + 6, Math.max(-6, elev * 34) + 6, 18).normalize();
    this.sun.position.copy(sunDir).multiplyScalar(SHADOW_LIGHT_DISTANCE);
    this.sun.target.position.set(0, 0, 0);
    const sunStrength = Math.max(0, elev);
    this.sun.intensity = SUN_GAIN * (dust ? 0.35 : 1.0) * (0.15 + sunStrength * 1.35);
    lerpColor(sk.sun.low, dust ? sk.sun.dust : sk.sun.clear, 0.4 + amb * 0.6, this.sun.color);

    this.ambientLight.intensity = AMBIENT_FLOOR + AMBIENT_DAY * amb;
    lerpColor(sk.ambient.low, sk.ambient.high, amb, this.ambientLight.color);

    // the sky environment: re-baked only when it moved enough to notice;
    // brightness follows daylight every frame
    const s = this.skyState;
    s.daylight = amb;
    s.dust = dust;
    s.sunElev = elev;
    this.skyEnv.update(s, now);
    this.scene.environment = this.skyEnv.texture;
    this.scene.environmentIntensity = envIntensity(s);
  }

  /** point the iso camera at `focus` (world space) with the given ortho extent.
   *  Keeps the fixed iso direction — only the focus point and zoom change. The
   *  renderer lerps focus + viewSize each frame and calls this for a follow-cam.
   *  resize() reads the stored viewSize, so aspect stays correct. */
  setView(focus: THREE.Vector3, viewSize: number): void {
    this.focus.copy(focus);
    this.viewSize = viewSize;
    this.camera.position.copy(focus).add(this.isoOffset);
    this.camera.lookAt(focus);
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    const aspect = w / h;
    this.camera.left = -viewSize * aspect;
    this.camera.right = viewSize * aspect;
    this.camera.top = viewSize;
    this.camera.bottom = -viewSize;
    this.camera.updateProjectionMatrix();
  }

  render(): void {
    if (this.renderer.shadowMap.enabled) this.fitShadows();
    this.postfx.render();
  }

  /** wrap the sun's shadow map around what the camera can see this frame */
  private fitShadows(): void {
    const fit = fitShadow(orthoViewOf(this.camera, this.shadowView), this.skyState.sunDir, this.shadowSize, this.shadowFit);
    this.sun.position.copy(fit.lightPosition);
    this.sun.target.position.copy(fit.center);
    const cam = this.sun.shadow.camera;
    cam.left = -fit.halfSize;
    cam.right = fit.halfSize;
    cam.top = fit.halfSize;
    cam.bottom = -fit.halfSize;
    cam.near = fit.near;
    cam.far = fit.far;
    cam.up.copy(fit.up);
    cam.updateProjectionMatrix();
    // the normal offset scales with the texel it has to clear: under 0.01
    // units zoomed in on a 2048² map, about 0.1 zoomed out on 1024²
    this.sun.shadow.normalBias = THREE.MathUtils.clamp(1.2 * fit.texel, 0.01, 0.12);
  }

  dispose(): void {
    this.renderer.domElement.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.skyEnv.dispose();
    this.postfx.dispose();
    this.renderer.dispose();
  }
}
