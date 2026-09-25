# Lighting Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give VIVARIUM's renderer image-based sky lighting, view-fitted sun shadows, and ambient occlusion on the upper quality steps, so metal/frosted/glass surfaces read correctly and structures sit in the scene with depth.

**Architecture:** Three new render-side units — `environment.ts` (a sky baked into `scene.environment` by PMREM, re-baked only when the sky changes enough), `shadow-fit.ts` (pure math that wraps the sun's shadow map around the visible ground), and `ao.ts` (GTAOPass with a stricter depth/normal visibility rule) — wired into `scene.ts` / `postfx.ts`, with two new levers on the PerfGovernor ladder. Engine, worker, protocol and saves are untouched.

**Tech Stack:** TypeScript, three.js r169 (WebGL2, `EffectComposer`, `GTAOPass`, `PMREMGenerator`), Vitest (node environment), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-lighting-foundation-design.md`

## Global Constraints

- Render layer only: nothing under `src/engine/`, `src/worker/`, `shared/`, `server/`, or `src/net/` changes. No new npm dependencies.
- three.js r169 only (`three@^0.169.0`, `@types/three@^0.169.0`). Import add-ons from `three/addons/...` as `postfx.ts` does.
- `tsconfig`: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride` (subclass overrides need `override`), `useDefineForClassFields`.
- Tests run in Vitest's **node** environment: no WebGL context. Anything needing a real `WebGLRenderer` is verified in the browser, not in unit tests.
- Color convention: `SkyLook` 0..255 triples are treated as **linear/255** (exactly as `scene.ts` `lerpColor` does); packed hex ground colors go through `new THREE.Color(hex)` (sRGB → linear).
- Hot render paths stay allocation-free (reuse scratch objects), matching `renderer.ts`.
- Keep: ACES tone mapping, exposure 1.15, bloom threshold 1.0, flare pulse, fog, emissive rules (rust "hurt" glows get no night boost).
- Verification commands: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.
- Writing style: plain, specific comments and commit messages; no marketing language.

## Review Focus

1. A world switch (PTP hop / colony switch) during dawn — the environment must re-bake immediately with the new world's palette, not wait for the rate limit. → Task 3 test "world change bakes immediately".
2. Hours at 4× speed — bakes stay bounded (≤ 4/s) and every replaced PMREM target is disposed. → Task 3 tests "rate limit" and "disposes the previous target"; Task 7 leak e2e.
3. The AUTO governor stepping up/down mid-game — AO and shadow-size changes rebuild cleanly and release GPU resources. → Task 5 postfx test "AO toggles release targets"; Task 6 `setShadowSize` disposes the old map; Task 7 leak e2e.
4. Extreme sun angles (dawn/dusk grazing light, near-vertical noon) — the shadow fit stays finite and covers the view. → Task 4 tests.
5. Transient FX and UI sprites (bubbles, name tags, UFO beam, placement ghost, corridor skins) must not draw AO halos. → Task 5 `aoVisible` tests.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/render/three/worldlook.ts` | modify | `EnvLook` type + per-world `env` block on `SkyLook` |
| `src/render/three/worldlook.test.ts` | create | palette sanity per world |
| `src/render/perf.ts` | modify | `PerfStep.shadowSize`, `PerfStep.ao`; ladder values |
| `src/render/perf.test.ts` | modify | ladder shape assertions |
| `src/render/three/environment.ts` | create | `skyColors`, `rebakeReason`, `envIntensity`, `SkyEnvironment` |
| `src/render/three/environment.test.ts` | create | pure helpers + `SkyEnvironment` with a fake PMREM |
| `src/render/three/shadow-fit.ts` | create | `lightBasis`, `viewSlabPoints`, `orthoViewOf`, `fitShadow` |
| `src/render/three/shadow-fit.test.ts` | create | coverage, snapping, size steps, degenerate sun |
| `src/render/three/ao.ts` | create | `aoVisible`, `ColonyAOPass` |
| `src/render/three/ao.test.ts` | create | visibility rule + override/restore round trip |
| `src/render/three/postfx.ts` | modify | optional AO pass, `setAO` |
| `src/render/three/postfx.test.ts` | modify | AO pass lifecycle |
| `src/render/three/scene.ts` | modify | environment, fills, fitted shadows, levers (main session) |
| `src/render/renderer.ts` | modify | `syncStep()` applies new levers (main session) |
| `e2e/graphics.spec.ts` | modify | visible-footprint shadow coverage, leak cycle (main session) |
| `docs/rendering.md` | modify | document environment, shadows, AO, ladder (main session) |

Sequencing: Tasks 1–2 (plumbing) → Tasks 3, 4, 5 in parallel (disjoint files) → Task 6 integration + tuning (main session) → Task 7 e2e → Task 8 docs + checkpoint.

---

### Task 1: Per-world environment palette (`worldlook.ts`)

**Files:**
- Modify: `src/render/three/worldlook.ts`
- Test: `src/render/three/worldlook.test.ts` (create)

**Interfaces:**
- Produces: `export interface EnvLook { zenith: { night: RGB; dust: RGB; clear: RGB }; horizon: { night: RGB; dust: RGB; clear: RGB }; bounce: number; lowSunGlow: RGB }` and `SkyLook.env: EnvLook` for all four worlds. Consumed by Task 3 via `worldLook(world).sky.env`.

- [ ] **Step 1: Write the failing test** — `src/render/three/worldlook.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WORLD_LOOKS, type RGB } from "./worldlook";

const lum = (c: RGB) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const valid = (c: RGB) => c.length === 3 && c.every((v) => Number.isInteger(v) && v >= 0 && v <= 255);

describe("world environment palettes", () => {
  for (const [world, look] of Object.entries(WORLD_LOOKS)) {
    it(`${world} defines a complete, ordered sky environment`, () => {
      const env = look.sky.env;
      for (const band of [env.zenith, env.horizon]) {
        expect(valid(band.night) && valid(band.dust) && valid(band.clear)).toBe(true);
        // night is darker than both daylight states
        expect(lum(band.night)).toBeLessThan(lum(band.clear));
        expect(lum(band.night)).toBeLessThan(lum(band.dust));
      }
      expect(valid(env.lowSunGlow)).toBe(true);
      expect(env.bounce).toBeGreaterThan(0);
      expect(env.bounce).toBeLessThanOrEqual(3);
      // the lit sky is brighter than the dark void the fog/background paints at the
      // top of the frame, so upward-facing metal does not reflect black
      expect(lum(env.zenith.clear)).toBeGreaterThan(lum(look.sky.top.clear));
    });
  }
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/render/three/worldlook.test.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'zenith')` (no `env` yet).

- [ ] **Step 3: Implement** — in `worldlook.ts`, add after `SkyLook`'s `ambient` field and before the closing brace of `SkyLook`:

```ts
  /** image-based-lighting sky the environment map is baked from (environment.ts) */
  env: EnvLook;
```

Add this interface directly above `SkyLook`:

```ts
/** the sky that LIGHTS the scene (baked into scene.environment by environment.ts).
 *  Separate from the fog/background endpoints: those paint the far haze; these
 *  are what metal, frosted and glass surfaces reflect and what every standard
 *  material takes its sky/ground fill from. Same 0..255-as-linear convention. */
export interface EnvLook {
  zenith: { night: RGB; dust: RGB; clear: RGB };
  horizon: { night: RGB; dust: RGB; clear: RGB };
  /** albedo factor on the world's mean soil color for the lower hemisphere */
  bounce: number;
  /** near-sun tint while the sun is low (Mars: the blue sunset glow) */
  lowSunGlow: RGB;
}
```

Add an `env` entry inside each world's `sky` object (after `ambient`):

```ts
      // mars
      env: {
        zenith: { night: [10, 13, 22], dust: [118, 82, 60], clear: [128, 112, 108] },
        horizon: { night: [16, 16, 24], dust: [150, 98, 66], clear: [232, 166, 118] },
        bounce: 1.6,
        lowSunGlow: [70, 110, 170],
      },
```

```ts
      // ceres
      env: {
        zenith: { night: [8, 12, 20], dust: [60, 72, 88], clear: [150, 176, 206] },
        horizon: { night: [14, 18, 26], dust: [120, 138, 156], clear: [196, 214, 232] },
        bounce: 1.1,
        lowSunGlow: [200, 214, 235],
      },
```

```ts
      // io
      env: {
        zenith: { night: [12, 10, 8], dust: [110, 88, 36], clear: [120, 104, 70] },
        horizon: { night: [20, 16, 10], dust: [160, 126, 44], clear: [214, 180, 92] },
        bounce: 1.2,
        lowSunGlow: [240, 190, 110],
      },
```

```ts
      // titan
      env: {
        zenith: { night: [30, 24, 14], dust: [100, 78, 40], clear: [140, 110, 62] },
        horizon: { night: [42, 32, 18], dust: [140, 106, 50], clear: [180, 140, 72] },
        bounce: 1.0,
        lowSunGlow: [190, 120, 60],
      },
```

Update the file header sentence "mars is the ANCHOR: every field below is today's hardcoded constant copied verbatim ... pixel-identically to before this table existed." to: "mars is the ANCHOR: its fog/terrain fields are the original hardcoded constants; the `env` block (2026-09 lighting pass) intentionally changes how every world is lit."

- [ ] **Step 4: Run tests** — `npx vitest run src/render/three/worldlook.test.ts` → PASS; `npm run typecheck` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src/render/three/worldlook.ts src/render/three/worldlook.test.ts
git commit -m "feat(render): per-world sky palette for environment lighting"
```

---

### Task 2: Ladder levers for shadow size and AO (`perf.ts`)

**Files:**
- Modify: `src/render/perf.ts` (`PerfStep`, `LADDER`)
- Modify: `src/render/perf.test.ts` (first test, injected-ladder test)

**Interfaces:**
- Produces: `PerfStep.shadowSize: 1024 | 2048` and `PerfStep.ao: boolean`. Consumed by Task 6 (`renderer.syncStep`).

- [ ] **Step 1: Update the test** — replace the body of `it("starts on the HIGH step of the documented ladder", ...)`:

```ts
    const g = new PerfGovernor();
    expect(g.index()).toBe(STEP_HIGH);
    expect(g.step()).toEqual({ fps: 60, ratio: 1.5, bloom: true, shadows: true, shadowSize: 2048, ao: true });
    expect(g.stepChanged).toBe(false);
    expect(LADDER).toEqual([
      { fps: 60, ratio: 1.5, bloom: true, shadows: true, shadowSize: 2048, ao: true },
      { fps: 30, ratio: 1.5, bloom: true, shadows: true, shadowSize: 2048, ao: true },
      { fps: 30, ratio: 1.25, bloom: true, shadows: true, shadowSize: 1024, ao: false },
      { fps: 30, ratio: 1.0, bloom: true, shadows: false, shadowSize: 1024, ao: false },
      { fps: 30, ratio: 1.0, bloom: false, shadows: false, shadowSize: 1024, ao: false },
    ]);
    expect(LADDER[STEP_LOW]).toEqual({ fps: 30, ratio: 1.0, bloom: false, shadows: false, shadowSize: 1024, ao: false });
```

and in `it("honors an injected ladder and tunables", ...)` give both injected steps `shadowSize: 1024, ao: false`.

- [ ] **Step 2: Run** `npx vitest run src/render/perf.test.ts` → FAIL (ladder lacks the fields).

- [ ] **Step 3: Implement** — `PerfStep` gains:

```ts
  /** shadow-map resolution while shadows are on (the view-fitted sun map) */
  shadowSize: 1024 | 2048;
  /** screen-space ambient occlusion (GTAO) */
  ao: boolean;
```

and `LADDER` becomes the five objects in the test above, with the comment updated to say it sheds fps first, then resolution, AO and shadow detail, then shadows and bloom.

- [ ] **Step 4: Run** `npx vitest run src/render/perf.test.ts` → PASS; `npm run typecheck` → the only errors allowed are in `renderer.ts` if it destructures steps (there are none today; expect clean).

- [ ] **Step 5: Commit**

```bash
git add src/render/perf.ts src/render/perf.test.ts
git commit -m "feat(render): ladder levers for shadow-map size and ambient occlusion"
```

---

### Task 3: Sky environment (`environment.ts`)

**Files:**
- Create: `src/render/three/environment.ts`
- Test: `src/render/three/environment.test.ts`

**Interfaces:**
- Consumes: `worldLook(world).sky.env: EnvLook` (Task 1), `worldLook(world).sky.sun`, `worldLook(world).ground`.
- Produces (used by Task 6 `scene.ts`):
  - `interface SkyState { world: World; daylight: number; dust: boolean; sunDir: THREE.Vector3; sunElev: number }`
  - `skyColors(state: SkyState): SkyColors`
  - `rebakeReason(prev: BakeRecord | null, next: SkyState, nowMs: number): RebakeReason | null`
  - `envIntensity(state: SkyState): number`
  - `type PmremLike = Pick<THREE.PMREMGenerator, "fromScene" | "dispose">`
  - `class SkyEnvironment { constructor(pmrem: PmremLike); readonly texture: THREE.Texture | null; readonly bakes: number; update(state: SkyState, nowMs: number): RebakeReason | null; dispose(): void }`

- [ ] **Step 1: Write the failing tests** — `src/render/three/environment.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import {
  DAYLIGHT_STEP, ENV_BASE, MIN_BAKE_GAP_MS, SUN_STEP_RAD, SkyEnvironment,
  envIntensity, rebakeReason, skyColors, type BakeRecord, type PmremLike, type SkyState,
} from "./environment";
import { WORLD_LOOKS } from "./worldlook";
import type { World } from "@shared/types";

const WORLDS = Object.keys(WORLD_LOOKS) as World[];

/** the sun direction scene.ts derives for a time of day (kept in sync by hand) */
function sunFor(tod: number): { dir: THREE.Vector3; elev: number } {
  const ang = (tod - 0.5) * Math.PI * 2;
  const elev = Math.cos(ang);
  const dir = new THREE.Vector3(Math.sin(ang) * 30 + 6, Math.max(-6, elev * 34) + 6, 18).normalize();
  return { dir, elev };
}

function state(over: Partial<SkyState> = {}): SkyState {
  const { dir, elev } = sunFor(0.5);
  return { world: "mars", daylight: 0.97, dust: false, sunDir: dir, sunElev: elev, ...over };
}

function record(s: SkyState, atMs: number): BakeRecord {
  return { world: s.world, dust: s.dust, daylight: s.daylight, sunElev: s.sunElev, sunDir: s.sunDir.clone(), atMs };
}

const isFinite3 = (c: THREE.Color) => [c.r, c.g, c.b].every(Number.isFinite);

describe("skyColors", () => {
  it("gives every world finite colors across the sol, in clear air and dust", () => {
    for (const world of WORLDS) for (const tod of [0.1, 0.25, 0.3, 0.5, 0.75, 0.9]) for (const dust of [false, true]) {
      const { dir, elev } = sunFor(tod);
      const c = skyColors(state({ world, sunDir: dir, sunElev: elev, dust, daylight: elev > 0 ? 0.9 : 0.07 }));
      expect([c.zenith, c.horizon, c.bounce, c.sun].every(isFinite3)).toBe(true);
    }
  });

  it("has no sun glow once the sun is below the horizon", () => {
    const { dir, elev } = sunFor(0.9);
    const c = skyColors(state({ sunDir: dir, sunElev: elev, daylight: 0.07 }));
    expect([c.sun.r, c.sun.g, c.sun.b]).toEqual([0, 0, 0]);
  });

  it("uses the dust endpoints and a wide glow in a storm", () => {
    const env = WORLD_LOOKS.mars.sky.env;
    const c = skyColors(state({ dust: true, daylight: 1 }));
    expect(c.zenith.r).toBeCloseTo(env.zenith.dust[0] / 255, 5);
    expect(c.horizon.g).toBeCloseTo(env.horizon.dust[1] / 255, 5);
    expect(c.glowPower).toBe(4);
    expect(skyColors(state()).glowPower).toBe(8);
  });

  it("tints a low sun toward the world's low-sun glow (Mars: bluer near the horizon)", () => {
    const low = skyColors(state({ sunElev: 0.08 }));
    const high = skyColors(state({ sunElev: 1 }));
    const blueShare = (c: THREE.Color) => c.b / (c.r + c.g + c.b);
    expect(blueShare(low.sun)).toBeGreaterThan(blueShare(high.sun));
  });
});

describe("rebakeReason", () => {
  const base = state();
  it("bakes first, then on world or weather changes regardless of the rate limit", () => {
    expect(rebakeReason(null, base, 0)).toBe("first");
    const prev = record(base, 1000);
    expect(rebakeReason(prev, { ...base, world: "ceres" }, 1001)).toBe("world");
    expect(rebakeReason(prev, { ...base, dust: true }, 1001)).toBe("weather");
  });

  it("re-bakes for a sun move past the step, but not inside the rate limit", () => {
    const prev = record(base, 1000);
    const moved = base.sunDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), SUN_STEP_RAD * 1.2);
    expect(rebakeReason(prev, { ...base, sunDir: moved }, 1000 + MIN_BAKE_GAP_MS - 1)).toBeNull();
    expect(rebakeReason(prev, { ...base, sunDir: moved }, 1000 + MIN_BAKE_GAP_MS)).toBe("sun");
    const small = base.sunDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), SUN_STEP_RAD * 0.5);
    expect(rebakeReason(prev, { ...base, sunDir: small }, 5000)).toBeNull();
  });

  it("re-bakes for a daylight step, not for smaller drifts", () => {
    const prev = record(base, 0);
    expect(rebakeReason(prev, { ...base, daylight: base.daylight - DAYLIGHT_STEP }, 1000)).toBe("daylight");
    expect(rebakeReason(prev, { ...base, daylight: base.daylight - DAYLIGHT_STEP / 2 }, 1000)).toBeNull();
  });

  it("ignores sun movement while the sun is down (there is no glow to update)", () => {
    const night = state({ sunElev: -0.5, daylight: 0.07 });
    const prev = record(night, 0);
    const moved = night.sunDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), SUN_STEP_RAD * 3);
    expect(rebakeReason(prev, { ...night, sunDir: moved, sunElev: -0.45 }, 5000)).toBeNull();
  });
});

describe("envIntensity", () => {
  it("changes smoothly with daylight (no steps between bakes)", () => {
    let prev = envIntensity(state({ daylight: 0.07 }));
    for (let d = 0.071; d <= 0.97; d += 0.001) {
      const next = envIntensity(state({ daylight: d }));
      expect(Math.abs(next - prev)).toBeLessThan(0.01 * ENV_BASE);
      expect(next).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = next;
    }
  });
});

describe("SkyEnvironment", () => {
  function fakePmrem() {
    const targets: { texture: THREE.Texture; dispose: ReturnType<typeof vi.fn> }[] = [];
    const pmrem = {
      fromScene: vi.fn(() => {
        const t = { texture: new THREE.Texture(), dispose: vi.fn() };
        targets.push(t);
        return t as unknown as THREE.WebGLRenderTarget;
      }),
      dispose: vi.fn(),
    };
    return { pmrem: pmrem as unknown as PmremLike & typeof pmrem, targets };
  }

  it("bakes once, reuses the map until the sky moves, and disposes what it replaces", () => {
    const { pmrem, targets } = fakePmrem();
    const env = new SkyEnvironment(pmrem);
    expect(env.texture).toBeNull();
    expect(env.update(state(), 0)).toBe("first");
    expect(env.bakes).toBe(1);
    expect(env.texture).toBe(targets[0].texture);
    expect(env.update(state(), 100)).toBeNull();
    expect(env.bakes).toBe(1);
    expect(env.update(state({ world: "titan" }), 150)).toBe("world");
    expect(env.bakes).toBe(2);
    expect(targets[0].dispose).toHaveBeenCalledTimes(1);
    expect(env.texture).toBe(targets[1].texture);
    env.dispose();
    expect(targets[1].dispose).toHaveBeenCalledTimes(1);
    expect(pmrem.dispose).toHaveBeenCalledTimes(1);
    expect(env.texture).toBeNull();
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/render/three/environment.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/render/three/environment.ts`:

```ts
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
/** global gain on the baked sky, balanced against the sun and exposure */
export const ENV_BASE = 1.0;

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
```

- [ ] **Step 4: Run** `npx vitest run src/render/three/environment.test.ts` → PASS; `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/render/three/environment.ts src/render/three/environment.test.ts
git commit -m "feat(render): sky environment baked for image-based lighting"
```

---

### Task 4: View-fitted shadow math (`shadow-fit.ts`)

**Files:**
- Create: `src/render/three/shadow-fit.ts`
- Test: `src/render/three/shadow-fit.test.ts`

**Interfaces:**
- Produces (used by Task 6 `scene.ts`):
  - constants `SHADOW_CEILING = 5`, `SHADOW_PAD = 1.5`, `SHADOW_SIZE_STEP = 2`, `SHADOW_LIGHT_DISTANCE = 100`
  - `interface OrthoView { position; right; up; forward: THREE.Vector3; left; rightEdge; top; bottom: number }`
  - `interface ShadowFit { center: THREE.Vector3; lightPosition: THREE.Vector3; up: THREE.Vector3; halfSize: number; near: number; far: number; texel: number; lightX: number; lightY: number; lightZ: number }`
  - `emptyOrthoView(): OrthoView`, `emptyShadowFit(): ShadowFit`
  - `orthoViewOf(camera: THREE.OrthographicCamera, out?: OrthoView): OrthoView`
  - `viewSlabPoints(view: OrthoView, ceiling?: number, out?: THREE.Vector3[]): THREE.Vector3[]`
  - `lightBasis(sunDir: THREE.Vector3): { x: THREE.Vector3; y: THREE.Vector3; z: THREE.Vector3; up: THREE.Vector3 }` (allocates; tests/one-offs)
  - `fitShadow(view: OrthoView, sunDir: THREE.Vector3, mapSize: number, out?: ShadowFit, ceiling?: number): ShadowFit` (allocation-free when `out` is given)

- [ ] **Step 1: Write the failing tests** — `src/render/three/shadow-fit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  SHADOW_CEILING, SHADOW_LIGHT_DISTANCE, SHADOW_SIZE_STEP,
  fitShadow, lightBasis, orthoViewOf, viewSlabPoints,
} from "./shadow-fit";

const ISO = new THREE.Vector3(28, 26, 28); // scene.ts isoOffset

/** the camera scene.ts setView builds */
function isoCamera(focus: THREE.Vector3, view: number, aspect = 1.6): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-view * aspect, view * aspect, view, -view, 0.1, 200);
  cam.position.copy(focus).add(ISO);
  cam.lookAt(focus);
  cam.updateMatrixWorld();
  return cam;
}

function sunFor(tod: number): THREE.Vector3 {
  const ang = (tod - 0.5) * Math.PI * 2;
  const elev = Math.cos(ang);
  return new THREE.Vector3(Math.sin(ang) * 30 + 6, Math.max(-6, elev * 34) + 6, 18).normalize();
}

describe("fitShadow", () => {
  const focuses = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-18, 0, -18), new THREE.Vector3(20, 0, -20), new THREE.Vector3(7.5, 0, 19)];
  const views = [3, 6.5, 13, 22];
  const tods = [0.26, 0.3, 0.5, 0.7, 0.74, 0.9];

  it("covers every visible point from the ground to the ceiling, at every pan, zoom and sun angle", () => {
    for (const focus of focuses) for (const view of views) for (const tod of tods) {
      const v = orthoViewOf(isoCamera(focus, view));
      const sun = sunFor(tod);
      const fit = fitShadow(v, sun, 2048);
      const b = lightBasis(sun);
      for (const p of viewSlabPoints(v)) {
        expect(Math.abs(p.dot(b.x) - fit.lightX)).toBeLessThanOrEqual(fit.halfSize);
        expect(Math.abs(p.dot(b.y) - fit.lightY)).toBeLessThanOrEqual(fit.halfSize);
        const depth = SHADOW_LIGHT_DISTANCE - (p.dot(b.z) - fit.lightZ);
        expect(depth).toBeGreaterThanOrEqual(fit.near);
        expect(depth).toBeLessThanOrEqual(fit.far);
      }
    }
  });

  it("puts the light at the center, up the sun direction, and matches three's lookAt frame", () => {
    const sun = sunFor(0.4);
    const fit = fitShadow(orthoViewOf(isoCamera(new THREE.Vector3(), 13)), sun, 2048);
    const toLight = fit.lightPosition.clone().sub(fit.center);
    expect(toLight.length()).toBeCloseTo(SHADOW_LIGHT_DISTANCE, 6);
    expect(toLight.normalize().angleTo(sun)).toBeLessThan(1e-9);
    // a camera placed by the scene the same way sees the center at its origin
    const cam = new THREE.OrthographicCamera();
    cam.up.copy(fit.up);
    cam.position.copy(fit.lightPosition);
    cam.lookAt(fit.center);
    cam.updateMatrixWorld();
    const local = fit.center.clone().applyMatrix4(cam.matrixWorldInverse);
    expect(Math.abs(local.x)).toBeLessThan(1e-6);
    expect(Math.abs(local.y)).toBeLessThan(1e-6);
  });

  it("snaps the box to whole texels and rounds its size to fixed steps", () => {
    const sun = sunFor(0.45);
    const fit = fitShadow(orthoViewOf(isoCamera(new THREE.Vector3(1.234, 0, -3.21), 13)), sun, 2048);
    expect((fit.halfSize * 2) % SHADOW_SIZE_STEP).toBe(0);
    expect(fit.texel).toBeCloseTo((fit.halfSize * 2) / 2048, 12);
    expect(Math.abs(fit.lightX / fit.texel - Math.round(fit.lightX / fit.texel))).toBeLessThan(1e-6);
    expect(Math.abs(fit.lightY / fit.texel - Math.round(fit.lightY / fit.texel))).toBeLessThan(1e-6);
  });

  it("moves in whole texels when the camera pans by less than one", () => {
    const sun = sunFor(0.45);
    const a = fitShadow(orthoViewOf(isoCamera(new THREE.Vector3(0, 0, 0), 13)), sun, 2048);
    const nudge = lightBasis(sun).x.multiplyScalar(a.texel * 0.3);
    const b = fitShadow(orthoViewOf(isoCamera(nudge, 13)), sun, 2048);
    expect(b.halfSize).toBe(a.halfSize);
    const steps = (b.lightX - a.lightX) / a.texel;
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    expect(Math.abs(Math.round(steps))).toBeLessThanOrEqual(1);
  });

  it("is at least twice as sharp as the old whole-terrain map at default zoom", () => {
    const fit = fitShadow(orthoViewOf(isoCamera(new THREE.Vector3(), 13)), sunFor(0.5), 2048);
    const oldTexel = (2 * (22.5 * Math.SQRT2 + 2)) / 1024; // scene.ts's previous fixed frustum
    expect(fit.texel).toBeLessThan(oldTexel / 2);
  });

  it("stays finite for a near-vertical or grazing sun", () => {
    const v = orthoViewOf(isoCamera(new THREE.Vector3(), 13));
    for (const sun of [new THREE.Vector3(0, 1, 1e-5).normalize(), new THREE.Vector3(1, 0, 0.2).normalize()]) {
      const fit = fitShadow(v, sun, 1024);
      for (const n of [fit.halfSize, fit.near, fit.far, fit.texel, fit.lightX, fit.lightY, fit.center.x, fit.center.y, fit.center.z]) {
        expect(Number.isFinite(n)).toBe(true);
      }
      expect(fit.near).toBeGreaterThan(0);
      expect(fit.far).toBeGreaterThan(fit.near);
    }
  });

  it("reuses the output object without allocating a new one", () => {
    const v = orthoViewOf(isoCamera(new THREE.Vector3(), 13));
    const out = fitShadow(v, sunFor(0.5), 2048);
    const again = fitShadow(v, sunFor(0.52), 2048, out);
    expect(again).toBe(out);
    expect(again.center).toBe(out.center);
  });

  it("slab points sit on the ground and at the ceiling", () => {
    const pts = viewSlabPoints(orthoViewOf(isoCamera(new THREE.Vector3(), 13)));
    expect(pts).toHaveLength(8);
    expect(pts.filter((p) => Math.abs(p.y) < 1e-9)).toHaveLength(4);
    expect(pts.filter((p) => Math.abs(p.y - SHADOW_CEILING) < 1e-9)).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/render/three/shadow-fit.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `src/render/three/shadow-fit.ts`:

```ts
/* ============================================================================
   View-fitted sun shadows. The old rig stretched one shadow map over the whole
   terrain (~6.6 cm of ground per texel), so shadows blurred. fitShadow() wraps
   the map around what the orthographic camera can see — the ground and
   everything up to the tallest structure — squared and rounded to fixed size
   steps so zooming doesn't change sharpness, and snapped to whole texels in
   the sun's frame so panning doesn't make edges crawl. Pure math on three's
   vector types (no renderer, no scene), so it is unit-tested directly.
   ============================================================================ */
import * as THREE from "three";

/** tallest thing that casts or receives shadow in view (world units) */
export const SHADOW_CEILING = 5;
/** padding around the visible slab (world units) */
export const SHADOW_PAD = 1.5;
/** the square box side is rounded up to a multiple of this (world units) */
export const SHADOW_SIZE_STEP = 2;
/** how far up the sun direction the light sits from the fitted center */
export const SHADOW_LIGHT_DISTANCE = 100;

/** an orthographic view: position, unit basis, and frustum extents */
export interface OrthoView {
  position: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** unit view direction; y < 0 for a camera looking down at the colony */
  forward: THREE.Vector3;
  left: number;
  rightEdge: number;
  top: number;
  bottom: number;
}

export interface ShadowFit {
  /** world point the light looks at (the box center) */
  center: THREE.Vector3;
  /** world light position: center + sunDir · SHADOW_LIGHT_DISTANCE */
  lightPosition: THREE.Vector3;
  /** up vector the shadow camera needs so its frame matches the snapped basis */
  up: THREE.Vector3;
  /** half the square side: shadow camera left/right/top/bottom = ∓/± this */
  halfSize: number;
  near: number;
  far: number;
  /** world units per shadow texel */
  texel: number;
  /** the center in light-basis coordinates (x/y snapped to whole texels) */
  lightX: number;
  lightY: number;
  lightZ: number;
}

const Y_UP = new THREE.Vector3(0, 1, 0);
const Z_UP = new THREE.Vector3(0, 0, 1);

export function emptyOrthoView(): OrthoView {
  return {
    position: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0), forward: new THREE.Vector3(0, 0, -1),
    left: -1, rightEdge: 1, top: 1, bottom: -1,
  };
}

export function emptyShadowFit(): ShadowFit {
  return {
    center: new THREE.Vector3(), lightPosition: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0),
    halfSize: 1, near: 0.5, far: 1, texel: 1, lightX: 0, lightY: 0, lightZ: 0,
  };
}

/** read an OrthographicCamera's world frame + effective extents (zoom applied) */
export function orthoViewOf(camera: THREE.OrthographicCamera, out: OrthoView = emptyOrthoView()): OrthoView {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  const zoom = camera.zoom || 1;
  const cx = (camera.left + camera.right) / 2;
  const cy = (camera.top + camera.bottom) / 2;
  const hw = (camera.right - camera.left) / (2 * zoom);
  const hh = (camera.top - camera.bottom) / (2 * zoom);
  out.position.setFromMatrixPosition(camera.matrixWorld);
  out.right.set(e[0], e[1], e[2]).normalize();
  out.up.set(e[4], e[5], e[6]).normalize();
  out.forward.set(-e[8], -e[9], -e[10]).normalize();
  out.left = cx - hw;
  out.rightEdge = cx + hw;
  out.top = cy + hh;
  out.bottom = cy - hh;
  return out;
}

/** the view's four corner rays cut at the ground (y = 0) and at the ceiling */
export function viewSlabPoints(
  view: OrthoView,
  ceiling = SHADOW_CEILING,
  out: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3()),
): THREE.Vector3[] {
  const fy = view.forward.y;
  let i = 0;
  for (const sx of [view.left, view.rightEdge]) {
    for (const sy of [view.bottom, view.top]) {
      for (const h of [0, ceiling]) {
        const p = out[i++];
        p.copy(view.position).addScaledVector(view.right, sx).addScaledVector(view.up, sy);
        const t = Math.abs(fy) < 1e-6 ? 0 : (h - p.y) / fy;
        p.addScaledVector(view.forward, t);
      }
    }
  }
  return out;
}

/** writes the frame three's Object3D.lookAt builds for a camera at +z looking
 *  back along it (x = up × z, y = z × x), with a Z-up fallback near vertical */
function basisInto(sunDir: THREE.Vector3, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, up: THREE.Vector3): void {
  z.copy(sunDir).normalize();
  up.copy(Math.abs(z.y) > 0.99 ? Z_UP : Y_UP);
  x.crossVectors(up, z).normalize();
  y.crossVectors(z, x);
}

/** the light basis for a sun direction (allocates — tests and one-offs) */
export function lightBasis(sunDir: THREE.Vector3): { x: THREE.Vector3; y: THREE.Vector3; z: THREE.Vector3; up: THREE.Vector3 } {
  const b = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), up: new THREE.Vector3() };
  basisInto(sunDir, b.x, b.y, b.z, b.up);
  return b;
}

const _pts = Array.from({ length: 8 }, () => new THREE.Vector3());
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/** fit a square, texel-snapped shadow box around the visible slab */
export function fitShadow(
  view: OrthoView,
  sunDir: THREE.Vector3,
  mapSize: number,
  out: ShadowFit = emptyShadowFit(),
  ceiling = SHADOW_CEILING,
): ShadowFit {
  basisInto(sunDir, _x, _y, _z, out.up);
  viewSlabPoints(view, ceiling, _pts);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of _pts) {
    const px = p.dot(_x), py = p.dot(_y), pz = p.dot(_z);
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz;
    if (pz > maxZ) maxZ = pz;
  }
  const side = Math.max(maxX - minX, maxY - minY) + 2 * SHADOW_PAD;
  const size = Math.ceil(side / SHADOW_SIZE_STEP) * SHADOW_SIZE_STEP;
  const texel = size / mapSize;
  out.texel = texel;
  out.halfSize = size / 2;
  out.lightX = Math.round((minX + maxX) / 2 / texel) * texel;
  out.lightY = Math.round((minY + maxY) / 2 / texel) * texel;
  out.lightZ = (minZ + maxZ) / 2;
  out.center.set(0, 0, 0)
    .addScaledVector(_x, out.lightX)
    .addScaledVector(_y, out.lightY)
    .addScaledVector(_z, out.lightZ);
  out.lightPosition.copy(out.center).addScaledVector(_z, SHADOW_LIGHT_DISTANCE);
  // casters up to the ceiling that shadow the view can sit toward the sun, past
  // the slab: a grazing sun reaches ceiling / sin(elevation) sideways
  const towardSun = ceiling / Math.max(0.1, _z.y);
  out.near = Math.max(0.5, SHADOW_LIGHT_DISTANCE - (maxZ - out.lightZ) - towardSun - 2);
  out.far = SHADOW_LIGHT_DISTANCE + (out.lightZ - minZ) + 2;
  return out;
}
```

- [ ] **Step 4: Run** `npx vitest run src/render/three/shadow-fit.test.ts` → PASS; `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/render/three/shadow-fit.ts src/render/three/shadow-fit.test.ts
git commit -m "feat(render): fit the sun shadow map to the visible ground"
```

---

### Task 5: Ambient occlusion pass (`ao.ts` + `postfx.ts`)

**Files:**
- Create: `src/render/three/ao.ts`
- Test: `src/render/three/ao.test.ts`
- Modify: `src/render/three/postfx.ts` (add `setAO`, build/dispose the pass)
- Modify: `src/render/three/postfx.test.ts` (AO lifecycle test)

**Interfaces:**
- Produces: `AO_MIN_OPACITY = 0.85`; `aoVisible(o: THREE.Object3D): boolean`; `class ColonyAOPass extends GTAOPass { constructor(scene: THREE.Scene, camera: THREE.Camera, width: number, height: number) }`; `PostFx.setAO(on: boolean): void` (used by Task 6).

- [ ] **Step 1: Write the failing tests** — `src/render/three/ao.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { AO_MIN_OPACITY, ColonyAOPass, aoVisible } from "./ao";

const mesh = (params: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(params));

describe("aoVisible", () => {
  it("keeps opaque and nearly opaque surfaces, drops see-through and unlit extras", () => {
    expect(aoVisible(mesh())).toBe(true);
    expect(aoVisible(mesh({ transparent: true, opacity: 0.92 }))).toBe(true); // frosted dome
    expect(aoVisible(mesh({ transparent: true, opacity: AO_MIN_OPACITY }))).toBe(true);
    expect(aoVisible(mesh({ transparent: true, opacity: 0.55 }))).toBe(false); // corridor skin
    expect(aoVisible(mesh({ depthWrite: false }))).toBe(false); // decals, FX, ghost
    expect(aoVisible(new THREE.Sprite())).toBe(false); // bubbles, name tags
    expect(aoVisible(new THREE.Points())).toBe(false);
    expect(aoVisible(new THREE.LineSegments())).toBe(false);
    const tagged = mesh();
    tagged.userData.noAO = true;
    expect(aoVisible(tagged)).toBe(false);
    expect(aoVisible(new THREE.Group())).toBe(true);
    const multi = new THREE.Mesh(new THREE.BoxGeometry(), [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 }),
    ]);
    expect(aoVisible(multi)).toBe(false);
  });
});

describe("ColonyAOPass", () => {
  it("hides exactly the non-occluders for the G-buffer and restores every object after", () => {
    const scene = new THREE.Scene();
    const solid = mesh();
    const ghost = mesh({ depthWrite: false });
    const sprite = new THREE.Sprite();
    const hiddenAlready = mesh();
    hiddenAlready.visible = false;
    scene.add(solid, ghost, sprite, hiddenAlready);
    const pass = new ColonyAOPass(scene, new THREE.OrthographicCamera(), 64, 64);
    pass.overrideVisibility();
    expect([solid.visible, ghost.visible, sprite.visible, hiddenAlready.visible]).toEqual([true, false, false, false]);
    pass.restoreVisibility();
    expect([solid.visible, ghost.visible, sprite.visible, hiddenAlready.visible]).toEqual([true, true, true, false]);
    pass.dispose();
  });

  it("builds the same denoise noise every time (deterministic output across rebuilds)", () => {
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera();
    const a = new ColonyAOPass(scene, cam, 32, 32);
    const b = new ColonyAOPass(scene, cam, 32, 32);
    expect(Array.from(a.pdNoiseTexture.image.data as Uint8Array)).toEqual(Array.from(b.pdNoiseTexture.image.data as Uint8Array));
    a.dispose();
    b.dispose();
  });
});
```

Append to `src/render/three/postfx.test.ts` inside `describe("post-processing quality transitions", ...)`:

```ts
  it("adds ambient occlusion only when enabled, sized to the drawing buffer, and releases it on toggle", () => {
    const { fx, dimensions, internals } = fixture();
    const ao = () => internals.composer!.passes.find((p) => p instanceof ColonyAOPass) as ColonyAOPass | undefined;
    fx.render();
    expect(ao()).toBeUndefined();
    fx.setAO(true);
    expect(internals.composer).toBeNull(); // rebuilt lazily, like bloom
    fx.render();
    const pass = ao()!;
    expect(internals.composer!.passes.indexOf(pass)).toBe(1); // right after the scene render
    expect([pass.width, pass.height]).toEqual([1200, 900]);
    dimensions.ratio = 1.25;
    fx.setPixelRatio(1.25);
    expect([pass.width, pass.height]).toEqual([1000, 750]);
    const released = vi.fn();
    pass.gtaoRenderTarget.addEventListener("dispose", released);
    pass.pdRenderTarget.addEventListener("dispose", released);
    fx.setAO(false);
    expect(released).toHaveBeenCalledTimes(2);
    fx.render();
    expect(ao()).toBeUndefined();
    fx.dispose();
  });
```

and add `import { ColonyAOPass } from "./ao";` to the imports of `postfx.test.ts`.

- [ ] **Step 2: Run** `npx vitest run src/render/three/ao.test.ts src/render/three/postfx.test.ts` → FAIL (module not found / `setAO` missing).

- [ ] **Step 3: Implement** — `src/render/three/ao.ts`:

```ts
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

/** true when the object belongs in the AO depth/normal pre-render */
export function aoVisible(o: THREE.Object3D): boolean {
  const r = o as Renderable;
  if (r.isPoints || r.isLine || r.isSprite) return false;
  if (o.userData.noAO === true) return false;
  const mats = r.material;
  if (!mats) return true;
  for (const m of Array.isArray(mats) ? mats : [mats]) {
    if (!m.depthWrite) return false;
    if (m.transparent && m.opacity < AO_MIN_OPACITY) return false;
  }
  return true;
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
```

In `src/render/three/postfx.ts`:
- Update the header's first line to `PostFx — RenderPass → optional GTAO → optional UnrealBloomPass → OutputPass → FXAA.` and add one sentence: "AO, like bloom, is an optional pass: the composer is rebuilt lazily when either toggles."
- `import { ColonyAOPass } from "./ao";`
- Fields: `private aoEnabled = false;` and `private ao: ColonyAOPass | null = null;`
- Method (after `setEnabled`):

```ts
  /** toggle ambient occlusion; like bloom, the chain is rebuilt lazily and the
   *  released pass takes its G-buffer and AO targets with it */
  setAO(on: boolean): void {
    if (on === this.aoEnabled) return;
    this.aoEnabled = on;
    this.disposeComposer();
  }
```

- In `build()`, directly after `this.composer.addPass(this.renderPass);`:

```ts
    if (this.aoEnabled) {
      // addPass sizes it to the drawing buffer (logical size × pixel ratio)
      this.ao = new ColonyAOPass(this.scene, this.camera, size.x, size.y);
      this.composer.addPass(this.ao);
    }
```

- In `disposeComposer()`, add `this.ao?.dispose();` next to `this.bloom?.dispose();` and `this.ao = null;` with the other resets.

- [ ] **Step 4: Run** `npx vitest run src/render/three/ao.test.ts src/render/three/postfx.test.ts` → PASS; `npm run typecheck` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/render/three/ao.ts src/render/three/ao.test.ts src/render/three/postfx.ts src/render/three/postfx.test.ts
git commit -m "feat(render): ambient occlusion pass with a strict occluder rule"
```

---

### Task 6: Scene integration and tuning (main session)

**Files:**
- Modify: `src/render/three/scene.ts`
- Modify: `src/render/renderer.ts` (`syncStep`)

**Interfaces:**
- Consumes: Tasks 2–5 exactly as declared above.
- Produces: `SceneManager.setShadowSize(n: 1024 | 2048)`, `SceneManager.setAO(on: boolean)`, `SceneManager.envBakes` (getter, DEV/QA), `sun` stays a private `DirectionalLight` named `sun` (the e2e reads it through a cast).

- [ ] **Step 1: Environment + fills in `scene.ts`**
  - Construct `this.envMap = new SkyEnvironment(new THREE.PMREMGenerator(this.renderer))` after the renderer.
  - Remove the `HemisphereLight` (field, construction, update line). The `AmbientLight` becomes a floor: `this.ambientLight.intensity = AMBIENT_FLOOR + AMBIENT_DAY * amb` with starting constants `AMBIENT_FLOOR = 0.04`, `AMBIENT_DAY = 0.06`.
  - Keep a `skyState: SkyState` and a unit `sunDir` field. In `update()`: compute `sunDir` from the existing sun-position formula (normalized), store `sunElev = elev`, `daylight = amb`, `dust`, `world` (set in `setWorld`); call `this.envMap.update(this.skyState, performance.now())`; assign `this.scene.environment = this.envMap.texture` and `this.scene.environmentIntensity = envIntensity(this.skyState)`.
  - `setWorld(world)` also sets `this.skyState.world = world`.
  - `dispose()` calls `this.envMap.dispose()`.
- [ ] **Step 2: Fitted shadows in `scene.ts`**
  - Fields: `private shadowSize: 1024 | 2048 = 2048;`, `private readonly view = emptyOrthoView();`, `private readonly fit = emptyShadowFit();`. Constructor: `this.sun.shadow.mapSize.set(2048, 2048)`, bias −0.0002, normalBias 0.02 (tune in Step 4). Delete the fixed whole-terrain frustum; `groundHalfExtent` stays as the constructor parameter only if still used (otherwise remove it and update the `renderer.ts` call).
  - `render()`: when `this.renderer.shadowMap.enabled`, call `fitShadows()` before `postfx.render()`: `orthoViewOf(this.camera, this.view)`, `fitShadow(this.view, this.sunDir, this.shadowSize, this.fit)`, then set `sun.position = fit.lightPosition`, `sun.target.position = fit.center`, shadow camera `left/right/top/bottom = ∓/± fit.halfSize`, `near/far`, `up.copy(fit.up)`, `updateProjectionMatrix()`. When shadows are off, place the sun at `sunDir × SHADOW_LIGHT_DISTANCE` with the target at the origin (direction is all that matters).
  - `setShadowSize(n)`: no-op when unchanged; else set `mapSize`, `sun.shadow.map?.dispose()`, `sun.shadow.map = null`.
  - `setAO(on)`: `this.postfx.setAO(on)`.
- [ ] **Step 3: `renderer.ts` `syncStep()`** — after `setShadows(s.shadows)`: `this.scene.setShadowSize(s.shadowSize); this.scene.setAO(s.ao);`
- [ ] **Step 4: Tune in the browser** with `.playwright-mcp/visual-review/capture.js` (reference colony, all worlds/times, HIGH/LOW): `ENV_BASE`, sun intensity curve, ambient floor, each world's `env` palette, AO radius/intensity, shadow bias/normalBias. Targets are the spec's acceptance criteria 1–4. Record final values in the code, not in comments about tuning history.
- [ ] **Step 5: Verify** — `npm run typecheck && npm test && npm run build`; read `git diff`; commit:

```bash
git add src/render/three/scene.ts src/render/renderer.ts src/render/three/worldlook.ts src/render/three/environment.ts src/render/three/ao.ts
git commit -m "feat(render): light the colony with its sky, fitted shadows and AO"
```

---

### Task 7: Browser tests (main session)

**Files:**
- Modify: `e2e/graphics.spec.ts`

- [ ] **Step 1: Shadow coverage** — in "construction reaches all four expanded edges through the canvas", replace the `shadowCoverage` block with a check that, at each of the four panned edge positions and for tods `[0.26, 0.3, 0.5, 0.7, 0.74]`, after `r.scene.update(tod, false); r.scene.render();` and `sun.shadow.updateMatrices(sun)`, the eight visible slab points — the four NDC corners `(±1, ±1)` unprojected with the scene camera and intersected with `y = 0` and `y = 5` — project into `sun.shadow.camera` with every NDC component in `(-1, 1)`. The pinned HIGH step reports `mapSize` `[2048, 2048]`.
- [ ] **Step 2: Resource cycle** — new test: start a colony; `renderer.setQuality("high")`; record `scene.renderer.info.memory` after one full world cycle (`mars → ceres → io → titan → mars` via `bridge.save()` + `state.world` + `bridge.load()`); then run two more cycles plus `setQuality("low")`/`("high")` toggles and 150 sim-seconds at speed 30 (`bridge.setSpeed(30)`, unpaused); assert geometries/textures equal the recorded counts and the console had no `WebGL` errors; assert `scene.envBakes` increased during the sol.
- [ ] **Step 3: Run** `npm run test:e2e` → all pass (mobile projects skip architect tests as today).
- [ ] **Step 4: Commit**

```bash
git add e2e/graphics.spec.ts
git commit -m "test(render): visible-ground shadow coverage and GPU resource cycle"
```

---

### Task 8: Documentation, checkpoint, review (main session)

- [ ] **Step 1:** `docs/rendering.md` — new "Environment lighting" section (sky model, re-bake rules, intensity, fills); rewrite the shadow paragraph in "Ground contact and night definition" for view-fitted shadows; add AO to "PostFx and the quality switch"; add `shadowSize`/`ao` to the ladder description.
- [ ] **Step 2:** Full verification: `npm run typecheck && npm test && npm run build && npm run test:e2e`.
- [ ] **Step 3:** Capture the after-matrix (`window.__captureLabel = "after-p1"`), build the comparison page, measure HIGH/LOW frame-body cost on the reference colony (same method as the baseline: 2.97 ms HIGH / 3.38 ms LOW mean).
- [ ] **Step 4:** Independent review of the part-1 diff against the spec (fresh reviewer); confirm each finding in code before acting.
- [ ] **Step 5:** Commit docs:

```bash
git add docs/rendering.md
git commit -m "docs(render): environment lighting, fitted shadows, AO"
```
