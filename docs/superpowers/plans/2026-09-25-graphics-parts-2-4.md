# Graphics Parts 2–4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the graphics overhaul on top of part 1's lighting: readable PV panels, quiet airlocks, built-looking domes, a landscape that never shows its edge and has detail at play zoom, a final grade, and soft storm columns.

**Architecture:** Pure texture/geometry builders in new focused modules (`panel-textures.ts`, `ground-shader.ts`, `pebbles.ts`, `grade-fxaa.ts`), small changes in the kits and `materials.ts`, the terrain widened to a far field, and the storm's devil shells moved to a shader. Integration and tuning happen in the main session.

**Tech Stack:** TypeScript, three.js r169 (WebGL2), Vitest (node environment), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-graphics-parts-2-4-design.md` (part 1: `docs/superpowers/specs/2026-09-25-lighting-foundation-design.md`)

## Global Constraints

- Render layer only: nothing under `src/engine/`, `src/worker/`, `shared/`, `server/`, `src/net/` changes. No new npm dependencies.
- three.js r169 only; add-ons from `three/addons/...`.
- `tsconfig`: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noImplicitOverride`, `useDefineForClassFields`.
- Vitest runs in **node** (no WebGL). GPU behavior is verified in the browser by the main session.
- Hot render paths stay allocation-free (reuse scratch objects).
- Post-processing invariant (part 1): an **even number of `needsSwap` passes per frame**, so the scene pass always renders into the HDR target that has a depth buffer. Never add a swapping pass without a matching change; `postfx.test.ts` enforces it.
- Keep: ACES exposure 1.15, bloom threshold 1.0, emissive rules (rust "hurt" glows get no night boost), the High/Low identical-grade property (anything color-changing applies on both paths).
- Deterministic visuals: seeded RNG for anything procedural (no `Math.random`).
- Writing style: plain, specific comments and commit messages.
- Verification commands: `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e`.

## Review Focus

1. World hops (PTP / colony switch) rebuild terrain: the far field, pebbles and ground shader must rebuild and dispose with it, with no GPU growth. → Task 4 test "disposes everything it built"; main-session leak e2e.
2. The far field must not change the construction area: `heightAt` values inside the grid, the 41×41 flatness limit, and decorative clearance of construction cells. → Task 4 tests.
3. The grade must apply identically with bloom on and off (e2e "same grade without bloom"). → Task 7 test (grade uniforms shared by both composer builds).
4. Airlocks at night must stay a small signal; rust warning semantics unchanged. → Task 3 test (intensity ramp bounded).
5. Storm devils must still fade in/out with the existing lifetime logic (no pop). → Task 8 test (opacity uniform follows the fade).

---

## File Structure

| File | Status | Task |
|---|---|---|
| `src/render/three/panel-textures.ts` (+ test) | create | 1 |
| `src/render/three/materials.ts` (+ new `materials.test.ts`) | modify | 1 |
| `src/render/three/kit/solar.ts`, `kit/dome.ts`, `kit/corridor.ts`, `kit/facility.ts` | modify | 2 |
| `src/render/renderer.ts` (airlocks), `src/render/three/ground-details.ts` (spill) | modify | 3 |
| `src/render/three/terrain.ts` (+ `terrain.test.ts`) | modify | 4 |
| `src/render/three/ground-shader.ts` (+ test) | create | 5 |
| `src/render/three/pebbles.ts` (+ test) | create | 6 |
| `src/render/three/grade-fxaa.ts` (+ test), `postfx.ts`, `postfx.test.ts` | create/modify | 7 |
| `src/render/three/stormfx.ts` (+ new `stormfx.test.ts`) | modify | 8 |
| `scene.ts`, wiring in `terrain.ts`, `docs/rendering.md`, e2e | modify | 9 (main session) |

Waves: Tasks 1, 3, 4, 5, 6, 7, 8 in parallel (disjoint files, each in its own worktree from the same base) → Task 2 (needs Task 1's `MaterialLib`) → Task 9 integration and tuning.

---

### Task 1: PV cell and dome panel textures; MaterialLib finish

**Files:** create `src/render/three/panel-textures.ts`, `src/render/three/panel-textures.test.ts`, `src/render/three/materials.test.ts`; modify `src/render/three/materials.ts`.

**Interfaces (produced):**
- `export const PV_CELLS = 6;` `export function createPvCellTexture(seed: number, size = 256): THREE.DataTexture` — sRGB albedo.
- `export const DOME_MERIDIANS = 16;` `export const DOME_RINGS: readonly number[] = [0.32, 0.62, 0.86];` `export interface PanelMap { texture: THREE.DataTexture; roughnessMean: number }` `export function createDomePanelTexture(seed: number, width = 256, height = 128): PanelMap` — linear data: R = bump height, G = roughness multiplier.
- `MaterialLib` gains `domeShell(base?: THREE.ColorRepresentation): THREE.MeshStandardMaterial`; `panel()` becomes PV glass; `metal()` default metalness 0.6; `frostedDome()` roughness 0.5, metalness 0.2.

- [ ] **Step 1: Write the failing tests.** `panel-textures.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DOME_MERIDIANS, PV_CELLS, createDomePanelTexture, createPvCellTexture } from "./panel-textures";

const px = (t: THREE.DataTexture, x: number, y: number) => {
  const { data, width } = t.image as { data: Uint8Array; width: number };
  const i = (y * width + x) * 4;
  return [data[i], data[i + 1], data[i + 2], data[i + 3]];
};
const lum = (p: number[]) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];

describe("PV cell texture", () => {
  it("is a seeded sRGB grid of dark blue cells with light lines", () => {
    const a = createPvCellTexture(7), b = createPvCellTexture(7);
    expect(a.image.width).toBe(256);
    expect(a.colorSpace).toBe(THREE.SRGBColorSpace);
    expect(Array.from(a.image.data as Uint8Array)).toEqual(Array.from(b.image.data as Uint8Array));
    const cell = 256 / PV_CELLS;
    const center = px(a, Math.floor(cell * 0.5 + cell * 0.1), Math.floor(cell * 0.5)); // inside a cell, off the bus bars
    const line = px(a, Math.floor(cell), Math.floor(cell * 0.5)); // on a vertical grid line
    expect(center[2]).toBeGreaterThan(center[0]); // blue silicon
    expect(lum(line)).toBeGreaterThan(lum(center) + 40);
    expect(Array.from(createPvCellTexture(8).image.data as Uint8Array)).not.toEqual(Array.from(a.image.data as Uint8Array));
    a.dispose(); b.dispose();
  });
});

describe("dome panel texture", () => {
  it("has meridian and ring seams as grooves and a roughness channel with a known mean", () => {
    const { texture, roughnessMean } = createDomePanelTexture(3);
    expect([texture.image.width, texture.image.height]).toEqual([256, 128]);
    expect(texture.colorSpace).toBe(THREE.NoColorSpace);
    const seamX = Math.round(256 / DOME_MERIDIANS) ; // first meridian after u = 0
    const panelX = Math.round(256 / DOME_MERIDIANS / 2);
    const y = Math.round(128 * 0.15); // below the first ring
    expect(px(texture, seamX, y)[0]).toBeLessThan(px(texture, panelX, y)[0]);
    expect(px(texture, panelX, Math.round(128 * 0.32))[0]).toBeLessThan(px(texture, panelX, y)[0]); // ring groove
    expect(roughnessMean).toBeGreaterThan(0.7);
    expect(roughnessMean).toBeLessThanOrEqual(1);
    texture.dispose();
  });
});
```

`materials.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createMaterials } from "./materials";

describe("MaterialLib", () => {
  it("shares one PV map and one dome panel map, and releases them on dispose", () => {
    const lib = createMaterials();
    const a = lib.panel(), b = lib.panel();
    expect(a.map).toBeTruthy();
    expect(a.map).toBe(b.map);
    expect(a.roughness).toBeLessThan(0.3);
    expect(a.metalness).toBeLessThanOrEqual(0.2);
    const shell = lib.domeShell();
    expect(shell.bumpMap).toBeTruthy();
    expect(shell.roughnessMap).toBe(shell.bumpMap);
    expect(shell.transparent).toBe(true);
    expect(shell.opacity).toBeCloseTo(0.92);
    expect(lib.metal().metalness).toBeCloseTo(0.6);
    expect(lib.frostedDome().metalness).toBeCloseTo(0.2);
    const released = vi.fn();
    a.map!.addEventListener("dispose", released);
    shell.bumpMap!.addEventListener("dispose", released);
    lib.dispose();
    expect(released).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run** `npx vitest run src/render/three/panel-textures.test.ts src/render/three/materials.test.ts` → FAIL (module missing / no `domeShell`).

- [ ] **Step 3: Implement `panel-textures.ts`.** Use the hash style from `surface-detail.ts` (`sampleCell`-like integer hash → [0,1)). PV texture: for each texel compute the cell (cx, cy) and fractional position (fx, fy) within it; base silicon sRGB `(26, 42, 70)` × a per-cell tint `0.94 + 0.12·hash(cx, cy, seed)`; two vertical bus bars at fx = 1/3 and 2/3 (within 0.8 px) colored `(120, 128, 138)`; grid lines where the distance to the cell edge is under 1.2 px colored `(150, 158, 168)`; alpha 255. `colorSpace = SRGBColorSpace`, linear mag, mipmapped min, `anisotropy = 4`, `needsUpdate`. Dome texture: `u = (x+0.5)/w`, `v = (y+0.5)/h` (v = 0 at the equator, 1 at the apex — SphereGeometry's hemisphere UVs); meridian distance in px = `|u·M − round(u·M)|·(w/M)` counted only below the top ring (`v < 0.86`), ring distance in px = min over `DOME_RINGS` of `|v − r|·h`; `seam = min(...)`; groove = `seam < 1 ? 0 : seam < 2 ? 0.5 : 1`; `R = round(255·(0.55 + 0.45·groove))`; panel id = `floor(u·M) + 16·(ring band index)` → `G = round(255·(0.85 + 0.15·hash(id)))`; B = 255, A = 255; accumulate G/255 for `roughnessMean`. `colorSpace = NoColorSpace`, `wrapS = RepeatWrapping`, `wrapT = ClampToEdgeWrapping`, mipmapped.

- [ ] **Step 4: Implement `materials.ts` changes.** Create `const pv = createPvCellTexture(0x5e11)` and `const dome = createDomePanelTexture(0xd0e5)` beside the existing `detail`. `metal()`: default metalness 0.6. `frostedDome()`: `roughnessWithDetail(0.5, detail)`, metalness 0.2 (opacity stays 0.92). New `domeShell(base = "#787f8a")`: `new MeshStandardMaterial({ color, roughness: Math.min(1, 0.5 / dome.roughnessMean), roughnessMap: dome.texture, bumpMap: dome.texture, bumpScale: 1.5, metalness: 0.2, transparent: true, opacity: 0.92 })`. `panel()`: `new MeshStandardMaterial({ color: 0xffffff, map: pv, roughness: 0.18, metalness: 0.1, emissive: 0x050b14, emissiveIntensity: 0.3 })`. `dispose()` disposes `detail.texture`, `pv`, `dome.texture`. Update the interface doc comments (panel: "PV glass with the shared cell map"; domeShell: "a dome cap's shell with shared panel seams").

- [ ] **Step 5: Run** the two test files → PASS; `npm run typecheck` → clean; `npm test` → all pass.

- [ ] **Step 6: Commit** `git add src/render/three/panel-textures.ts src/render/three/panel-textures.test.ts src/render/three/materials.ts src/render/three/materials.test.ts && git commit -m "feat(render): PV cell and dome panel maps in the material library"`

---

### Task 2: Kits use the new finish (after Task 1)

**Files:** modify `src/render/three/kit/solar.ts`, `kit/dome.ts`, `kit/corridor.ts`, `kit/facility.ts`. Tests: existing `kit/facility.test.ts` must pass; add assertions to a new `src/render/three/kit/kits-finish.test.ts`.

**Interfaces (consumed):** `MaterialLib.panel()` (PV glass with `map`), `MaterialLib.domeShell(base)`, `MaterialLib.metal(base, { rough, metal })`.

- [ ] **Step 1: Write the failing test** `kit/kits-finish.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFS } from "@/engine";
import { createMaterials } from "../materials";
import { buildKitMesh } from "./index";

function materialsOf(obj: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) if ((x as THREE.MeshStandardMaterial).isMeshStandardMaterial) out.push(x as THREE.MeshStandardMaterial);
  });
  return out;
}

describe("kit finish", () => {
  const lib = createMaterials();
  it("solar arrays show the PV cell map and no separate seam strips", () => {
    const mesh = buildKitMesh(DEFS.solar, 1, lib);
    const mats = materialsOf(mesh.object);
    expect(mats.some((m) => m.map)).toBe(true);
    expect(mats.some((m) => m.color.getHex() === 0x0b1019)).toBe(false);
    mesh.dispose();
  });
  it("domes use the paneled shell and light double-sided dishes", () => {
    for (const id of ["hub", "hab", "greenhouse"] as const) {
      for (let uid = 1; uid <= 12; uid++) {
        const mesh = buildKitMesh(DEFS[id], uid, lib);
        const mats = materialsOf(mesh.object);
        expect(mats.some((m) => m.bumpMap && m.transparent)).toBe(true);
        expect(mats.some((m) => m.map)).toBe(false); // no PV map on domes
        mesh.dispose();
      }
    }
  });
  it("corridor skins are nearly opaque so they read as hull and occlude AO", () => {
    const mesh = buildKitMesh(DEFS.corridor, 3, lib);
    mesh.setNeighbors!(0b0101);
    const skins = materialsOf(mesh.object).filter((m) => m.transparent);
    expect(skins.length).toBeGreaterThan(0);
    for (const m of skins) expect(m.opacity).toBeGreaterThanOrEqual(0.85);
    mesh.dispose();
  });
  it("the robotics bay and printer read as steel, with a safety-yellow trim on the gantry", () => {
    const bay = materialsOf(buildKitMesh(DEFS.roboticsbay, 4, lib).object);
    expect(bay.some((m) => m.color.getHexString() === "8c8470")).toBe(false);
    expect(bay.some((m) => m.color.getHexString() === "c9a23a")).toBe(true);
    const printer = materialsOf(buildKitMesh(DEFS.printer, 5, lib).object);
    expect(printer.some((m) => m.color.getHexString() === "8a7f94")).toBe(false);
  });
});
```

(Colors compare with `getHexString()` on the working-space color; `new THREE.Color("#8c8470")` round-trips through sRGB→linear→sRGB to the same hex.)

- [ ] **Step 2: Run** it → FAIL.
- [ ] **Step 3: Implement.** `solar.ts`: keep `materials.panel()` on the panel box (its top face UVs span the cell map once) and delete the seam material and both seam meshes. `dome.ts`: the dome cap uses `materials.domeShell(domeTint)`; both dish meshes use `const dishMat = materials.metal("#b8bec6", { rough: 0.35, metal: 0.6 }); dishMat.side = THREE.DoubleSide;` (one material per building, shared by its dish mesh). `corridor.ts`: `skinMat.opacity = 0.9` (keep DoubleSide); `ribMat = ctx.materials.metal("#5a626c", { rough: 0.5, metal: 0.8 })`. `facility.ts`: `specFor` roboticsbay (and default) metal `#7f8790`, printer `#838a96`; in the robotics bay branch add a thin box strip along the gantry crossbeam with `materials.metal("#c9a23a", { rough: 0.55, metal: 0.3 })`, parented to whatever moves the beam so it travels with it, sized to the beam length × 30% of its height, offset to the beam's outward face.
- [ ] **Step 4: Run** `npx vitest run src/render/three/kit` → PASS; `npm run typecheck`; `npm test`.
- [ ] **Step 5: Commit** `git commit -m "feat(render): PV glass panels, paneled domes, metal dishes, hull corridors"` (explicit file list).

---

### Task 3: Quieter airlocks, warmer night pools

**Files:** modify `src/render/renderer.ts` (airlock fields, `updateAirlocks`, the night ramp in `frame()`, disposal), `src/render/three/ground-details.ts` (spill opacity). Test: new `src/render/three/airlock-look.test.ts` testing an exported helper.

**Interfaces (produced):** in `renderer.ts` a small exported pure helper `airlockSignalIntensity(night: number): number` returning `0.35 + 0.6·clamp(night, 0, 1)`.

- [ ] **Step 1: Test** (`airlock-look.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { airlockSignalIntensity } from "../renderer";

describe("airlock signal", () => {
  it("stays a small signal: dim by day, below the bloom threshold at night", () => {
    expect(airlockSignalIntensity(0)).toBeCloseTo(0.35);
    expect(airlockSignalIntensity(1)).toBeCloseTo(0.95);
    expect(airlockSignalIntensity(2)).toBeCloseTo(0.95);
    expect(airlockSignalIntensity(-1)).toBeCloseTo(0.35);
  });
});
```

(If importing `renderer.ts` into a node test pulls in modules that need the DOM at import time, move the helper to `src/render/three/airlock.ts` and import it from both places.)

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Replace `airlockGeo`/`airlockMat` with a collar (`TorusGeometry(0.2, 0.055, 8, 20)`, `MeshStandardMaterial({ color: 0x8a929c, roughness: 0.45, metalness: 0.6 })`) and a signal ring (`TorusGeometry(0.205, 0.014, 6, 28)`, `MeshStandardMaterial({ color: 0x10202a, emissive: 0x7fd4e8, emissiveIntensity: 0.35, roughness: 0.5 })`), both shared. `airlocks` becomes `Map<string, THREE.Group>`; each group holds one collar mesh and one ring mesh (ring at local z = +0.02, toward the corridor); position/orientation logic unchanged (set on the group). In `frame()`, replace the airlock line with `this.airlockSignalMat.emissiveIntensity = airlockSignalIntensity(this.env.night);`. Dispose the two geometries and two materials wherever the old airlock geometry/material were disposed (add disposal in `dispose()` if they were not). `ground-details.ts`: spill opacity `0.065 * night` → `0.11 * night`.
- [ ] **Step 4: Run** the new test, `npx vitest run src/render`, `npm run typecheck`.
- [ ] **Step 5: Commit** `git commit -m "feat(render): airlock collars with a thin signal ring; warmer night pools"`.

---

### Task 4: Terrain far field

**Files:** modify `src/render/three/terrain.ts`, `src/render/three/terrain.test.ts`.

**Interfaces (produced):** `export const FAR_EDGE = 72;` (world units, half-extent of the rendered ground). `Terrain` constructor signature unchanged (`grid, world, margin`); `surfaceHalfSpan` becomes `FAR_EDGE` (ground details and `heightAt` keep working because they read `surfaceStep`/`surfaceHalfSpan`). `SCENIC_MARGIN` keeps meaning "width of the ridge ramp outside the grid".

Why 72: at the widest zoom (`CAMERA_MAX_VIEW` 22) with the camera panned to a grid corner, the near half of the view reaches about 66 units from the origin; the far side beyond that is fully fogged (fog far 86 from a camera 47.5 away), and the background will be the fog color (Task 9), so nothing shows an edge.

- [ ] **Step 1: Update tests first.** In `terrain.test.ts`: the first test becomes "keeps a 1-unit mesh out to the far field while exposing 41×41 cells": `terrain.surfaceHalfSpan === FAR_EDGE`, vertex count `(2·FAR_EDGE/CELL + 1)²`, index count `(2·FAR_EDGE/CELL)²·6`, children length 3 (ground, rocks, monoliths). The flatness test keeps its interior limit for every vertex inside the grid, for margins `[0, 1, SCENIC_MARGIN, 4]`, and `heightAt` at the nine sample points. The scenery clearance test keeps `assertSceneryClear` (now bounds are `±FAR_EDGE`) and repeatability; replace the exact rock-count expectation with: rocks `count === farRockCount(look)` where `export function farRockCount(look: WorldLook): number` is exported from `terrain.ts` (see Step 3), monoliths `count === look.monoliths.count · 3`. Add: "ridged relief continues across the far field" — max terrain height beyond `grid.half() + SCENIC_MARGIN + 1` is at least `0.6·look.relief.ridge`; "disposes everything it built" — spy on `dispose` of each child geometry/material and assert every one fires once.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Plane span `2·FAR_EDGE`, segments `2·FAR_EDGE/CELL`; `this.surfaceHalfSpan = FAR_EDGE`; `edge = FAR_EDGE` for placement; the ridge ramp still normalizes over `margin` cells outside the grid (unchanged `sample()` logic, which already continues the ridged relief beyond the ramp). Add far-field dunes: beyond `half + margin`, add `farDune = (vnoise(gx·0.035 + 7, gy·0.035 + 11) − 0.5)·2.2·ramp` to `h` (broad swells that read in the haze). Vertex colors unchanged in formula. `farRockCount(look) = Math.round(look.rocks.count · 6)`; the rock scatter uses it and samples its strips over the whole far field (the existing `borderPoint` already spans `half..edge`); keep the placement fit test. Monoliths: `look.monoliths.count · 3`, sampled the same way. `dispose()` unchanged in shape (it already disposes what it pushed).
- [ ] **Step 4: Run** `npx vitest run src/render/three/terrain.test.ts src/render/three/ground-details.test.ts` → PASS; `npm run typecheck`; `npm test`.
- [ ] **Step 5: Commit** `git commit -m "feat(render): widen the ground to a far field so the edge never shows"`.

---

### Task 5: Ground detail shader

**Files:** create `src/render/three/ground-shader.ts`, `src/render/three/ground-shader.test.ts`. (The one-line hook in `terrain.ts` is added in Task 9.)

**Interfaces (produced):** `export function applyGroundDetail(material: THREE.MeshStandardMaterial, seed: number): void` — installs `onBeforeCompile` + `customProgramCacheKey`; `export const GROUND_DETAIL_KEY = "viv-ground-detail-1";` `export function groundDetailChunks(): { vertexPars: string; vertexMain: string; fragmentPars: string; fragmentMain: string }` (for tests).

- [ ] **Step 1: Test:**

```ts
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GROUND_DETAIL_KEY, applyGroundDetail } from "./ground-shader";

describe("ground detail shader", () => {
  it("injects world-space detail into the standard shader at real r169 anchors", () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyGroundDetail(mat, 42);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain("vGroundWorld = (modelMatrix * vec4( transformed, 1.0 )).xyz;");
    expect(shader.fragmentShader).toContain("varying vec3 vGroundWorld;");
    expect(shader.fragmentShader).toMatch(/#include <color_fragment>\s*[\s\S]*diffuseColor\.rgb \*= /);
    expect((shader.uniforms.uGroundSeed.value as THREE.Vector2).x).not.toBe(0);
    expect(mat.customProgramCacheKey()).toBe(GROUND_DETAIL_KEY);
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `uGroundSeed = new Vector2(((seed * 0.6180339887) % 1) * 1000, ((seed * 0.4142135) % 1) * 1000)`. Vertex: after `#include <common>` add `varying vec3 vGroundWorld;`; after `#include <begin_vertex>` add `vGroundWorld = (modelMatrix * vec4( transformed, 1.0 )).xyz;`. Fragment: after `#include <common>` add the varying, `uniform vec2 uGroundSeed;`, a value-noise `gNoise(vec2)` built on `gHash(vec2) = fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453)`. After `#include <color_fragment>`:

```glsl
vec2 gp = vGroundWorld.xz + uGroundSeed;
float fw = fwidth(gp.x);                         // world units per pixel
float grain = (gNoise(gp * 2.5) - 0.5) * (1.0 - smoothstep(0.08, 0.3, fw));
float patchy = gNoise(gp * 0.33) - 0.5;
float region = gNoise(gp * 0.07) - 0.5;
float speck = step(0.94, gHash(floor(gp * 6.0))) * (1.0 - smoothstep(0.05, 0.16, fw));
float tone = grain * 0.10 + patchy * 0.14 + region * 0.18 - speck * 0.12;
diffuseColor.rgb *= clamp(1.0 + tone, 0.8, 1.2);
```

Set `material.customProgramCacheKey = () => GROUND_DETAIL_KEY` and keep any existing `onBeforeCompile` behavior out (the terrain material has none).
- [ ] **Step 4: Run** → PASS; typecheck; `npm test`.
- [ ] **Step 5: Commit** `git commit -m "feat(render): world-space ground detail shader"`.

---

### Task 6: Pebble field

**Files:** create `src/render/three/pebbles.ts`, `src/render/three/pebbles.test.ts`. (Wiring into `Terrain` is Task 9.)

**Interfaces (produced):** `export const PEBBLE_COUNT = 1500;` `export function buildPebbles(heightAt: (x: number, z: number) => number, extent: number, look: { rockSeed: number; rockColor: number }, count = PEBBLE_COUNT): THREE.InstancedMesh` — name `"pebbles"`, `castShadow = false`, `receiveShadow = true`, geometry and material owned by the mesh (caller disposes both).

- [ ] **Step 1: Test:**

```ts
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PEBBLE_COUNT, buildPebbles } from "./pebbles";

const flat = (x: number, z: number) => 0.01 * Math.sin(x) * Math.cos(z);
const look = { rockSeed: 98213, rockColor: 0x5a3322 };

describe("pebble field", () => {
  it("scatters small seeded pebbles on the ground inside the extent", () => {
    const a = buildPebbles(flat, 23.5, look), b = buildPebbles(flat, 23.5, look);
    expect(a.count).toBe(PEBBLE_COUNT);
    expect(a.castShadow).toBe(false);
    expect(Array.from(a.instanceMatrix.array)).toEqual(Array.from(b.instanceMatrix.array));
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < a.count; i++) {
      a.getMatrixAt(i, m);
      m.decompose(p, q, s);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(23.5);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(23.5);
      expect(Math.max(s.x, s.z)).toBeLessThanOrEqual(0.09 + 1e-9);
      expect(Math.min(s.x, s.z)).toBeGreaterThanOrEqual(0.03 - 1e-9);
      expect(Math.abs(p.y - flat(p.x, p.z))).toBeLessThan(0.05);
    }
    expect(a.instanceColor).toBeTruthy();
    a.geometry.dispose(); (a.material as THREE.Material).dispose();
    b.geometry.dispose(); (b.material as THREE.Material).dispose();
  });
});
```

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** mulberry32 seeded with `look.rockSeed ^ 0x9eb1`; geometry `IcosahedronGeometry(1, 0)` squashed to y·0.6; material `MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 })` with per-instance `setColorAt` = `look.rockColor` scaled by `0.8 + 0.4·r` (lighter and darker pebbles); scale `s = 0.03 + 0.06·r³` with small per-axis jitter (x, z within [0.03, 0.09]); position `x, z` uniform in `[-extent, extent]`, `y = heightAt(x, z) + 0.2·s·0.6`; random yaw and slight tilt. `instanceMatrix.needsUpdate = true`, `instanceColor.needsUpdate = true`.
- [ ] **Step 4: Run** → PASS; typecheck; `npm test`.
- [ ] **Step 5: Commit** `git commit -m "feat(render): seeded pebble field for the build area"`.

---

### Task 7: Final grade folded into the antialiasing pass

**Files:** create `src/render/three/grade-fxaa.ts`, `src/render/three/grade-fxaa.test.ts`; modify `src/render/three/postfx.ts`, `src/render/three/postfx.test.ts`.

**Interfaces (produced):** `export interface Grade { lift: THREE.Color; gain: THREE.Color; saturation: number; vignette: number }` `export const NEUTRAL_GRADE: Grade` (lift 0, gain 1, saturation 1, vignette 0) `export function createGradedFxaaShader(): { uniforms: Record<string, THREE.IUniform>; vertexShader: string; fragmentShader: string }` — FXAAShader plus `lift`, `gain`, `saturation`, `vignette` uniforms and a grade applied to FXAA's output in the same pass. `PostFx.setGrade(g: Grade): void` (kept across composer rebuilds).

- [ ] **Step 1: Tests.** `grade-fxaa.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { createGradedFxaaShader } from "./grade-fxaa";

describe("graded FXAA shader", () => {
  it("keeps FXAA intact and grades its output in the same pass", () => {
    const s = createGradedFxaaShader();
    expect(Object.keys(s.uniforms).sort()).toEqual(["gain", "lift", "resolution", "saturation", "tDiffuse", "vignette"]);
    expect(s.vertexShader).toBe(FXAAShader.vertexShader);
    expect(s.fragmentShader).toContain("gl_FragColor = FxaaPixelShader(");
    expect(s.fragmentShader).toMatch(/gl_FragColor = FxaaPixelShader\([\s\S]*?\);\s*gl_FragColor\.rgb = vivGrade\( gl_FragColor\.rgb, vUv \);/);
    expect(s.fragmentShader).toContain("uniform vec3 lift;");
    expect(createGradedFxaaShader().uniforms.gain).not.toBe(s.uniforms.gain); // fresh uniforms per call
  });
});
```

In `postfx.test.ts` add: after `fx.setGrade({ lift, gain, saturation: 1.05, vignette: 0.2 })`, the last pass's uniforms hold those values on the high chain, and still hold them after `setEnabled(false)` rebuilds the low chain; the existing even-swap test must keep passing unchanged (the grade adds no pass).

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** `createGradedFxaaShader()`: clone `FXAAShader.uniforms` with `UniformsUtils.clone`, add `lift: { value: new Color(0, 0, 0) }`, `gain: { value: new Color(1, 1, 1) }`, `saturation: { value: 1 }`, `vignette: { value: 0 }`. Fragment = FXAA's with (a) after `uniform vec2 resolution;` the four uniform declarations and

```glsl
vec3 vivGrade( vec3 c, vec2 uv ) {
  c = c * gain + lift * ( 1.0 - c );
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = mix( vec3( l ), c, saturation );
  float r = length( uv - 0.5 ) * 1.25;
  c *= 1.0 - vignette * smoothstep( 0.35, 0.85, r );
  return clamp( c, 0.0, 1.0 );
}
```

and (b) `gl_FragColor.rgb = vivGrade( gl_FragColor.rgb, vUv );` inserted right after the `gl_FragColor = FxaaPixelShader( ... );` statement (regex on that statement; throw if the anchor is missing so a three upgrade fails loudly). In `postfx.ts`: build the antialias pass from `createGradedFxaaShader()` instead of `FXAAShader`; keep a `private grade: Grade = { ...NEUTRAL_GRADE copies }`; `setGrade(g)` copies into it and into the live pass's uniforms if built; `build()` writes the stored grade into the new pass. The pass count and `needsSwap` flags are unchanged.
- [ ] **Step 4: Run** the grade and postfx tests → PASS; typecheck; `npm test`.
- [ ] **Step 5: Commit** `git commit -m "feat(render): final grade folded into the FXAA pass"`.

---

### Task 8: Soft storm columns

**Files:** modify `src/render/three/stormfx.ts`; create `src/render/three/stormfx.test.ts`.

**Interfaces:** unchanged public API (`StormFx`, `update`, `debugDevil`, `dispose`). Internally `makeDustMat(opacity)` returns a `ShaderMaterial` with uniforms `opacity`, `time`, `spin`, `color` plus fog (`UniformsLib.fog`, `fog: true`), `transparent`, `depthWrite: false`, `side: DoubleSide`.

- [ ] **Step 1: Test** (`stormfx.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { StormFx } from "./stormfx";
import { GridSpace } from "./coords";

describe("storm devils", () => {
  it("use a soft shader whose opacity uniform follows the lifetime fade", () => {
    const fx = new StormFx(new GridSpace(41));
    fx.debugDevil();
    fx.update(0.5, null);
    const shells: THREE.ShaderMaterial[] = [];
    fx.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (m && (m as THREE.ShaderMaterial).isShaderMaterial) shells.push(m);
    });
    expect(shells.length).toBeGreaterThanOrEqual(3);
    const live = shells.filter((m) => m.uniforms.opacity.value > 0);
    expect(live.length).toBeGreaterThan(0);
    for (const m of shells) {
      expect(m.fog).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.uniforms.opacity.value).toBeLessThanOrEqual(1);
    }
    const t0 = live[0].uniforms.time.value;
    fx.update(0.25, null);
    expect(live[0].uniforms.time.value).toBeGreaterThan(t0);
    fx.dispose();
  });
});
```

(If `debugDevil` + `update(…, null)` retires the forced devil immediately because no storm is active, drive `update` with a minimal snapshot `{ weather: "dust", hazards: [{ kind: "dust", phase: "active", intensity: 0.8, remaining: 30 }] }` cast to `Snapshot`.)

- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** Vertex: pass `vUv` and a view-space normal/view vector; include fog chunks (`#include <fog_pars_vertex>`, `#include <fog_vertex>` after computing `mvPosition`). Fragment: `float h = smoothstep(0.0, 0.18, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));` `float rim = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewV))), 1.5);` (soft edges, denser toward the silhouette) `float swirl = 0.55 + 0.45 * noise(vec2(vUv.x * 7.0 + time * spin, vUv.y * 3.0 - time * 0.8));` `gl_FragColor = vec4(color, opacity * h * mix(0.35, 1.0, rim) * swirl);` then `#include <fog_fragment>`. Everywhere the class writes `material.opacity`, write `material.uniforms.opacity.value`; advance `time` for active devils in `updateDevils` (`+= dt`); `spin` from the devil's spin. Keep geometry, pooling, counts, lifetimes, and wind streaks unchanged.
- [ ] **Step 4: Run** → PASS; typecheck; `npm test`.
- [ ] **Step 5: Commit** `git commit -m "feat(render): soft swirling dust-devil columns"`.

---

### Task 9: Integration, tuning, verification (main session)

- [ ] Cherry-pick Tasks 1, 3–8, then run Task 2.
- [ ] `terrain.ts`: call `applyGroundDetail(mat, look.rockSeed)`; build pebbles with `buildPebbles(this.heightAt.bind(this), grid.half() + SCENIC_MARGIN, look)` into `this.group` and the disposables.
- [ ] `scene.ts`: background color = the horizon (fog) color; dust pulls fog near/far toward 22/70 with the storm factor eased over ~2 s; per-world grade (`worldlook.ts` gains `grade: { lift: RGB; gain: RGB; saturation: number; vignette: number }`, applied through `postfx.setGrade` on `setWorld`).
- [ ] Tune in the browser with the capture matrix (all worlds × dawn/noon/dusk/night/storm × High/Low, overview and close zoom): PV glass reads blue with a visible cell grid, airlocks read as collars, domes show panels, the ground has visible detail at close zoom without noise at overview, no terrain edge at max zoom-out and max pan, grade subtle, devils soft.
- [ ] Measure frame cost (HIGH/LOW) against part 1's numbers; run the full suite and e2e; update `docs/rendering.md`; commit per logical unit; independent review of the whole branch; final audit.
