/* ============================================================================
   SceneManager — the WebGL scene, an isometric-style orthographic camera, the
   day/night sun, and atmosphere. The iso look comes from the camera angle (doc
   §4.6: the renderer is the only layer that changed from the 2D prototype). The
   ambient curve and sky colours are ported from render.js (ambient/drawSky).
   ============================================================================ */
import * as THREE from "three";
import type { World } from "@shared/types";
import { PostFx } from "./postfx";
import { worldLook, type SkyLook } from "./worldlook";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpColor(a: number[], b: number[], t: number): THREE.Color {
  return new THREE.Color(
    lerp(a[0], b[0], t) / 255,
    lerp(a[1], b[1], t) / 255,
    lerp(a[2], b[2], t) / 255,
  );
}

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
  private hemi: THREE.HemisphereLight;
  private viewSize = 13;
  /** the iso vantage direction: camera sits at focus + this offset (doc §4.6) */
  private readonly isoOffset = new THREE.Vector3(28, 26, 28);
  private focus = new THREE.Vector3(0, 0, 0);
  /** the active world's sky/sun/ambient tint endpoints update() lerps between —
   *  the mars anchor by default (today's exact constants); re-themed by setWorld */
  private sky: SkyLook = worldLook("mars").sky;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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

    this.scene.fog = new THREE.Fog(0x0b0e12, 38, 86);

    this.sun = new THREE.DirectionalLight(0xffe6c8, 1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 120;
    const sc = this.sun.shadow.camera as THREE.OrthographicCamera;
    sc.left = -20; sc.right = 20; sc.top = 20; sc.bottom = -20;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ambientLight = new THREE.AmbientLight(0x4a4660, 0.5);
    this.scene.add(this.ambientLight);

    this.hemi = new THREE.HemisphereLight(0xb0744a, 0x10100c, 0.4);
    this.scene.add(this.hemi);

    this.postfx = new PostFx(this.renderer, this.scene, this.camera);

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
    this.postfx.setPixelRatio(r); // a LIVE bloom chain re-targets to match
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

  /** bloom + ACES as one switch (PostFx dedupes and frees its targets when off) */
  setBloom(on: boolean): void {
    this.postfx.setEnabled(on);
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
   *  endpoints update() lerps between — the day/night CURVE (and mars's exact
   *  values) are unchanged. The renderer calls this when snapshot.world changes. */
  setWorld(world: World): void {
    this.sky = worldLook(world).sky;
  }

  /** drive sun/sky/ambient from the time of day + weather (render.js parity).
   *  The tint endpoints are the active world's (this.sky) — mars reproduces the
   *  original hardcoded constants exactly. */
  update(tod: number, dust: boolean): void {
    const amb = ambientLevel(tod, dust);
    const sk = this.sky;

    // sky / fog: dark void at top, tinted horizon — collapse to a single fog+bg
    const horizon = lerpColor(sk.horizon.night, dust ? sk.horizon.dust : sk.horizon.clear, amb);
    const top = lerpColor(sk.top.night, dust ? sk.top.dust : sk.top.clear, amb);
    const sky = top.clone().lerp(horizon, 0.5);
    this.scene.background = sky;
    (this.scene.fog as THREE.Fog).color.copy(horizon);

    // sun arcs across the sky with tod; below horizon at night
    const ang = (tod - 0.5) * Math.PI * 2; // noon at top
    const elev = Math.cos(ang);            // 1 at noon, negative at night
    const sx = Math.sin(ang);
    this.sun.position.set(sx * 30 + 6, Math.max(-6, elev * 34) + 6, 18);
    this.sun.target.position.set(0, 0, 0);
    const sunStrength = Math.max(0, elev);
    this.sun.intensity = (dust ? 0.35 : 1.0) * (0.15 + sunStrength * 1.35);
    this.sun.color.copy(lerpColor(sk.sun.low, dust ? sk.sun.dust : sk.sun.clear, 0.4 + amb * 0.6));

    this.ambientLight.intensity = 0.18 + amb * 0.5;
    this.ambientLight.color.copy(lerpColor(sk.ambient.low, sk.ambient.high, amb));
    this.hemi.intensity = 0.2 + amb * 0.45;
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
    this.postfx.render();
  }

  dispose(): void {
    this.postfx.dispose();
    this.renderer.dispose();
  }
}
