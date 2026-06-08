/* ============================================================================
   SceneManager — the WebGL scene, an isometric-style orthographic camera, the
   day/night sun, and atmosphere. The iso look comes from the camera angle (doc
   §4.6: the renderer is the only layer that changed from the 2D prototype). The
   ambient curve and sky colours are ported from render.js (ambient/drawSky).
   ============================================================================ */
import * as THREE from "three";

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

export class SceneManager {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;

  private sun: THREE.DirectionalLight;
  private ambientLight: THREE.AmbientLight;
  private hemi: THREE.HemisphereLight;
  private viewSize = 9.5;
  /** the iso vantage direction: camera sits at focus + this offset (doc §4.6) */
  private readonly isoOffset = new THREE.Vector3(28, 26, 28);
  private focus = new THREE.Vector3(0, 0, 0);

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
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

    this.resize();
  }

  resize(): void {
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const v = this.viewSize;
    this.camera.left = -v * aspect;
    this.camera.right = v * aspect;
    this.camera.top = v;
    this.camera.bottom = -v;
    this.camera.updateProjectionMatrix();
  }

  /** drive sun/sky/ambient from the time of day + weather (render.js parity) */
  update(tod: number, dust: boolean): void {
    const amb = ambientLevel(tod, dust);

    // sky / fog: dark void at top, rust horizon — collapse to a single fog+bg
    const horizon = lerpColor([16, 12, 13], dust ? [128, 70, 42] : [158, 92, 60], amb);
    const top = lerpColor([8, 10, 14], dust ? [44, 28, 20] : [22, 24, 32], amb);
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
    this.sun.color.copy(lerpColor([90, 70, 60], dust ? [200, 120, 70] : [255, 226, 190], 0.4 + amb * 0.6));

    this.ambientLight.intensity = 0.18 + amb * 0.5;
    this.ambientLight.color.copy(lerpColor([30, 28, 44], [120, 120, 150], amb));
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
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}
