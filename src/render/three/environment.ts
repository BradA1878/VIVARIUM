/* ============================================================================
   SkyEnvironment — image-based lighting for the colony. A tiny off-screen sky
   (zenith → horizon gradient, the world's soil bounce below, a broad sun glow)
   is baked by PMREMGenerator into scene.environment, so metal, frosted and
   glass surfaces have something to reflect and every standard material gets a
   sky/ground fill. The bake follows world, weather, daylight and sun angle but
   only re-renders when the sky moved enough to notice; brightness follows the
   continuous daylight curve every frame through envIntensity(). Render-side
   only: it reads the same tod/weather/world scene.ts already does.
   ============================================================================ */
import * as THREE from "three";
import type { World } from "@shared/types";
import { worldLook, type RGB } from "./worldlook";

/** everything a bake depends on — scene.ts refreshes one of these per frame */
export interface SkyState {
  world: World;
  /** ambientLevel(tod, dust): 0.07 at night … 0.97 by day (×0.55 in dust) */
  daylight: number;
  dust: boolean;
  /** unit vector from the ground toward the sun (the directional light's direction) */
  sunDir: THREE.Vector3;
  /** cos of the sun's hour angle: 1 at noon, ≤ 0 once it is below the horizon */
  sunElev: number;
}

/** linear colors a bake renders from */
export interface SkyColors {
  zenith: THREE.Color;
  horizon: THREE.Color;
  bounce: THREE.Color;
  /** sun-glow tint × strength; black once the sun is down */
  sun: THREE.Color;
  /** glow falloff exponent: tight in clear air, wide in dust */
  glowPower: number;
}

/** the state the current map was baked from */
export interface BakeRecord {
  world: World;
  dust: boolean;
  daylight: number;
  sunElev: number;
  sunDir: THREE.Vector3;
  atMs: number;
}

export type RebakeReason = "first" | "world" | "weather" | "sun" | "daylight";

/** re-bake when the sun has moved this far… */
export const SUN_STEP_RAD = (5 * Math.PI) / 180;
/** …or daylight has moved this much… */
export const DAYLIGHT_STEP = 0.04;
/** …but no more often than this (world/weather changes ignore the limit) */
export const MIN_BAKE_GAP_MS = 250;
/** global gain on the baked sky, balanced against the sun (scene.ts SUN_GAIN)
 *  so direct light stays roughly three times the sky fill and shadows read */
export const ENV_BASE = 0.8;

/** the PMREMGenerator surface SkyEnvironment uses (injectable for tests) */
export type PmremLike = Pick<THREE.PMREMGenerator, "fromScene" | "dispose">;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** SkyLook triples are linear/255 — the convention scene.ts lerpColor uses */
function mixInto(target: THREE.Color, a: RGB, b: RGB, t: number): THREE.Color {
  return target.setRGB(
    lerp(a[0], b[0], t) / 255,
    lerp(a[1], b[1], t) / 255,
    lerp(a[2], b[2], t) / 255,
    THREE.LinearSRGBColorSpace,
  );
}

/** Rec. 709 luminance of a linear color */
export function luminance(c: THREE.Color): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

const groundMeans = new Map<World, THREE.Color>();
/** the world's mean soil color (hex palette is sRGB → linear), memoized */
function groundMean(world: World): THREE.Color {
  let c = groundMeans.get(world);
  if (!c) {
    const g = worldLook(world).ground;
    c = new THREE.Color(g.lo).add(new THREE.Color(g.hi)).add(new THREE.Color(g.accent)).multiplyScalar(1 / 3);
    groundMeans.set(world, c);
  }
  return c;
}

/** the colors a state bakes to (allocates — call per bake, never per frame) */
export function skyColors(state: SkyState): SkyColors {
  const look = worldLook(state.world).sky;
  const env = look.env;
  const t = clamp01(state.daylight);
  const zenith = mixInto(new THREE.Color(), env.zenith.night, state.dust ? env.zenith.dust : env.zenith.clear, t);
  const horizon = mixInto(new THREE.Color(), env.horizon.night, state.dust ? env.horizon.dust : env.horizon.clear, t);
  const bounce = groundMean(state.world).clone().multiplyScalar(env.bounce * (0.2 + 0.8 * t));
  // the glow fades in as the sun clears the horizon and carries the low-sun
  // tint near it; dust smothers it
  const strength = clamp01(state.sunElev * 4) * (state.dust ? 0.35 : 1);
  const high = state.dust ? look.sun.dust : look.sun.clear;
  const sun = mixInto(new THREE.Color(), env.lowSunGlow, high, clamp01(state.sunElev * 3)).multiplyScalar(strength);
  return { zenith, horizon, bounce, sun, glowPower: state.dust ? 4 : 8 };
}

/** why the map should re-bake for `next`, or null to keep the current one */
export function rebakeReason(prev: BakeRecord | null, next: SkyState, nowMs: number): RebakeReason | null {
  if (!prev) return "first";
  if (prev.world !== next.world) return "world";
  if (prev.dust !== next.dust) return "weather";
  if (nowMs - prev.atMs < MIN_BAKE_GAP_MS) return null;
  const glowVisible = prev.sunElev > 0 || next.sunElev > 0;
  if (glowVisible && prev.sunDir.angleTo(next.sunDir) > SUN_STEP_RAD) return "sun";
  if (Math.abs(prev.daylight - next.daylight) >= DAYLIGHT_STEP) return "daylight";
  return null;
}

const scratchHorizon = new THREE.Color();
/** scene.environmentIntensity for a state — continuous in daylight, no allocation.
 *  Bakes are normalized to unit horizon luminance, so this carries the brightness. */
export function envIntensity(state: SkyState): number {
  const env = worldLook(state.world).sky.env;
  mixInto(scratchHorizon, env.horizon.night, state.dust ? env.horizon.dust : env.horizon.clear, clamp01(state.daylight));
  return ENV_BASE * luminance(scratchHorizon);
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 bounce;
uniform vec3 sunColor;
uniform vec3 sunDir;
uniform float glowPower;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 c = h >= 0.0
    ? mix(horizon, zenith, pow(h, 0.6))
    : mix(horizon * 0.6, bounce, pow(-h, 0.4));
  float s = max(dot(d, sunDir), 0.0);
  c += sunColor * (0.9 * pow(s, glowPower) + 0.25 * s * s);
  gl_FragColor = vec4(c, 1.0);
}`;

export class SkyEnvironment {
  private readonly pmrem: PmremLike;
  private readonly skyScene = new THREE.Scene();
  private readonly skyMesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private target: THREE.WebGLRenderTarget | null = null;
  private last: BakeRecord | null = null;
  private bakeCount = 0;

  constructor(pmrem: PmremLike) {
    this.pmrem = pmrem;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        zenith: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        bounce: { value: new THREE.Color() },
        sunColor: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        glowPower: { value: 8 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
    this.skyScene.add(this.skyMesh);
  }

  /** the current environment map (null before the first bake) */
  get texture(): THREE.Texture | null {
    return this.target?.texture ?? null;
  }

  /** bakes performed so far — DEV/QA observability */
  get bakes(): number {
    return this.bakeCount;
  }

  /** bake when the sky moved enough; returns why it baked, or null when reused */
  update(state: SkyState, nowMs: number): RebakeReason | null {
    const reason = rebakeReason(this.last, state, nowMs);
    if (!reason) return null;
    this.bake(state);
    this.last = {
      world: state.world, dust: state.dust, daylight: state.daylight,
      sunElev: state.sunElev, sunDir: state.sunDir.clone(), atMs: nowMs,
    };
    return reason;
  }

  /** forget the last bake so the next update() bakes again (reason "first"):
   *  a restored WebGL context comes back without the baked map's contents */
  invalidate(): void {
    this.last = null;
  }

  private bake(state: SkyState): void {
    const c = skyColors(state);
    // normalized to unit horizon luminance; envIntensity() restores brightness
    const norm = 1 / Math.max(1e-4, luminance(c.horizon));
    const u = this.skyMesh.material.uniforms;
    (u.zenith.value as THREE.Color).copy(c.zenith).multiplyScalar(norm);
    (u.horizon.value as THREE.Color).copy(c.horizon).multiplyScalar(norm);
    (u.bounce.value as THREE.Color).copy(c.bounce).multiplyScalar(norm);
    (u.sunColor.value as THREE.Color).copy(c.sun).multiplyScalar(norm);
    (u.sunDir.value as THREE.Vector3).copy(state.sunDir);
    u.glowPower.value = c.glowPower;
    const next = this.pmrem.fromScene(this.skyScene, 0, 0.1, 10);
    const prev = this.target;
    this.target = next;
    prev?.dispose();
    this.bakeCount++;
  }

  dispose(): void {
    this.target?.dispose();
    this.target = null;
    this.last = null;
    this.pmrem.dispose();
    this.skyMesh.geometry.dispose();
    this.skyMesh.material.dispose();
  }
}
