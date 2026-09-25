# Graphics overhaul, part 1: lighting foundation — design

- **Date:** 2026-09-25
- **Status:** design approved in brainstorm (direction, scope, approach, all three sections); Brad directed "build it, test it, ship it", so the written-spec and plan review gates are waived.
- **Origin:** a visual review of the running game (M4 Pro, High quality, Mars, fresh start and a built 54-building colony, day/dusk/night/storm). Screenshots live in `.playwright-mcp/visual-review/` (gitignored).
- **Direction:** keep the current look (quiet, dusty, industrial; rust ground; cyan operational signals; warm windows) and make it read properly. Brad is the only player, so the target is his Mac; the PerfGovernor ladder stays as the safety net for other devices (e.g. a phone joining co-op).
- **Scope:** render layer only. No engine, worker protocol, save, balance, or UI changes. No new dependencies.

## The overhaul, in four parts

| Part | Contents | Files (primary) |
|---|---|---|
| **1. Lighting foundation** (this spec) | sky environment lighting, fill rebalance, view-fitted shadows, ambient occlusion, ladder levers | `scene.ts`, `postfx.ts`, `perf.ts`, `worldlook.ts`, new `environment.ts`, `shadow-fit.ts`, `ao.ts` |
| 2. Materials and buildings | MaterialLib retune under IBL, solar cell faces, quieter airlocks, per-kit finish fixes, night floodlight pools | `materials.ts`, `kit/*.ts`, `renderer.ts` doors/airlocks, `ground-details.ts` |
| 3. Terrain and surroundings | ground extends past the view at every zoom, visible ground detail/variation, pebbles in the build area kept out from under buildings, per-world treatment | `terrain.ts`, `worldlook.ts` ground fields, new scatter module |
| 4. Atmosphere polish | sky backdrop and sun glow when zoomed out, stars at night, ground haze, storm re-check, final grade | `scene.ts`, `atmosphere.ts`, `stormfx.ts`, `postfx.ts` |

Parts 2 and 3 touch disjoint files and follow part 1; part 4 is last. Each part gets its own spec and plan, grounded in the state the previous part leaves.

## Problem (measured, not guessed)

1. **Metal with nothing to reflect.** Nearly every building material is metallic (`metal()` 0.72, `frostedDome()` 0.35, `panel()` 0.85, trims 0.8–0.85), and nothing sets `scene.environment`. A metallic `MeshStandardMaterial` takes most of its color from reflections, so these surfaces render dark and pick up only the rust-tinted ambient/hemisphere fill. The hub dome (`#787f8a`) renders mauve-brown. An in-browser experiment (PMREM of a plain sky gradient assigned to `scene.environment`, fills lowered) made domes, tanks, greenhouses and the rover bay show their intended colors (`30-built-before.png` vs `31-built-envmap.png`).
2. **Flat fill, soft shadows.** A strong uniform `AmbientLight` (0.18 + 0.5·daylight) and `HemisphereLight` flatten form. One 1024² shadow map covers the whole terrain (≈0.066 world units per texel), so shadows are blurry at default zoom and mushy zoomed in.
3. **No occlusion.** Buildings sit on the ground with only the batched contact decals; crevices, panel undersides, dome rims and tank gaps have no darkening.
4. **Night.** Structures become black shapes; only emissives read.

## Design

### Components

| Unit | Kind | Responsibility |
|---|---|---|
| `render/three/environment.ts` | new | `SkyEnvironment`: a tiny off-screen sky scene + `PMREMGenerator`; bakes the reflection/irradiance map when the sky changes enough; exposes the current texture and a continuous intensity. Pure helpers exported for tests. |
| `render/three/shadow-fit.ts` | new, pure | `fitShadow(view, sunDir, mapSize)` → snapped light-space box + world center. No three renderer, no DOM. |
| `render/three/ao.ts` | new | `ColonyAOPass extends GTAOPass` with a stricter G-buffer visibility filter; `aoVisible(object)` exported pure for tests. |
| `render/three/worldlook.ts` | extend | per-world `env` block on `SkyLook` (see Environment). |
| `render/perf.ts` | extend | `PerfStep` gains `shadowSize` and `ao`. |
| `render/three/scene.ts` | integrate | owns `SkyEnvironment`; rebalanced fills; per-frame shadow fit; `setShadowSize`, `setAO` levers. |
| `render/three/postfx.ts` | integrate | optional AO pass between RenderPass and bloom; lazy build like bloom. |
| `render/renderer.ts` | integrate | `syncStep()` applies the new levers; nothing else. |

Data flow is unchanged: the renderer reads `snap.tod`, `snap.weather`, `snap.world` each frame and calls `scene.update(...)`; everything new hangs off that call. The observer/command wall is untouched.

### Environment lighting (`SkyEnvironment`)

**Sky model** (rendered into the map only; not the visible background):

- Direction `d`, `h = d.y`.
- Above the horizon: `mix(horizon, zenith, pow(h, 0.6))`.
- Below: `mix(horizon · 0.6, bounce, pow(-h, 0.4))`, where `bounce` = the world's mean ground color (from `ground.lo/hi/accent`) × `env.bounce` × current sun strength. Rust ground warms undersides on Mars; pale ice cools them on Ceres.
- Sun glow: `sunTint · (0.9 · pow(s, 8) + 0.25 · pow(s, 2))`, `s = max(dot(d, sunDir), 0)`, where `sunTint` = the scene's sun color scaled by sun strength and blended toward the world's `env.lowSunGlow` as the sun nears the horizon (Mars: a faint blue near-sun glow at dusk, as seen from the real surface). Deliberately broad and soft: sharp highlights stay the directional light's job, glints stay under the bloom threshold, and the map tolerates ~5° of sun movement between bakes.
- Night (sun below the horizon): zero sun glow; zenith/horizon from the night endpoints (a dim cool starlight).
- Dust: zenith and horizon converge on the dust endpoints; the glow widens (exponent 8 → 4) and weakens.

**Colors:** a new `env` block per world in `SkyLook`:

```ts
env: {
  zenith:  { night: RGB; dust: RGB; clear: RGB };
  horizon: { night: RGB; dust: RGB; clear: RGB };
  bounce: number;       // ground-bounce albedo factor
  lowSunGlow: RGB;      // near-sun tint at low elevation
}
```

Interpolated with the same daylight curve (`ambientLevel`) scene.ts already uses. Initial values are derived from each world's existing sky/ground palette and then tuned against screenshots; the table remains the single place a world's look is defined. The comment calling Mars "pixel-identical to before" is updated — Mars changes on purpose.

**Brightness vs. hue.** The bake is normalized by the horizon luminance of the colors it was baked from; `scene.environmentIntensity = ENV_BASE · luminance(current, unquantized colors)`, set every frame. Brightness therefore follows the continuous daylight curve; only hue and sun direction are baked.

**Re-bake policy** (pure `rebakeReason(prev, next, sinceLastMs)` → reason or null):

- world changed or weather changed → bake now (ignores the rate limit);
- sun direction moved > 5°, or quantized daylight moved ≥ 0.04 → bake if ≥ 250 ms since the last bake;
- otherwise nothing.

At 1× a sol is 150 s (≈2.4°/s of sun), so this is roughly one bake per 2 s through most of the sol and more during dawn/dusk hue shifts, bounded at 4/s. Bakes use `PMREMGenerator.fromScene`, which renders a 256² cube in r169 (fixed size); the sky is a single sphere, so a bake is cheap. The previous render target is disposed after the new one is assigned. The PMREM blur shader compiles when the generator is constructed and the first bake happens on the first frame, behind the boot screen, so neither hitches mid-game.

**Fill rebalance.** With IBL supplying sky and ground fill: the `HemisphereLight` is removed; the `AmbientLight` drops to a small floor (starting value `0.04 + 0.06 · daylight`, tuned). The directional sun keeps its direction, color curve, and shadows; its intensity and `ENV_BASE` are retuned together so daylight exposure matches today's overall brightness (ACES, exposure 1.15, and the bloom threshold 1.0 are unchanged).

**Unchanged semantics:** emissive rules (rust "hurt" glows get no night boost), bloom threshold 1.0, flare exposure pulse, fog, background color.

### View-fitted shadows (`shadow-fit.ts`)

Input: the orthographic camera's world position, orientation (right/up/forward), frustum extents (`left/right/top/bottom`), the unit direction toward the sun, the shadow map size, and `ceiling` (tallest structure height, 4 world units).

1. Cast the four frustum-corner rays (parallel, along the camera's forward) and intersect each with `y = 0` and `y = ceiling` → 8 world points (the visible slab).
2. Build a light basis from the sun direction (up = world +Y, falling back to +Z when the sun is near vertical). Project the 8 points onto the basis → light-space AABB (x, y).
3. Pad by 1.5 world units. Take the square side `S = max(w, h)`, rounded up to a multiple of 2 units (size stays stable through small zooms).
4. Snap the box center to the texel grid (`S / mapSize`) in the light basis (edges do not crawl while panning).
5. Output: world-space center, half-size, and the light-basis coordinates (for tests).

Scene integration: every frame, after `setView`, `scene.ts` places the sun at `center + sunDir · 60` with its target at `center`, sets the shadow camera to `±S/2`, keeps `near/far` generous (`60 ∓ (S·0.75 + 12)`), and updates the projection. Casters outside the view that shadow into it are covered because a receiver and its caster share light-space XY; the depth range covers everything between them and the light.

Map size is a ladder lever: 2048² on the top two steps, 1024² below. Changing it disposes `sun.shadow.map` so it is reallocated. Bias and normal bias are retuned for the finer texels (start: bias −0.0002, normalBias 0.02; tuned for acne vs. peter-panning).

At default zoom the fitted box is ≈50 units square → ≈0.025 units/texel at 2048 (≈2.6× today); at the closest zoom ≈10× today.

### Ambient occlusion (`ao.ts`)

- `ColonyAOPass extends GTAOPass` (three r169; orthographic cameras supported via its `PERSPECTIVE_CAMERA` define).
- G-buffer visibility: in addition to GTAOPass's own Points/Line hiding, also hide `isSprite` objects (bubbles, name tags), materials with `depthWrite === false`, transparent materials with `opacity < 0.85` (corridor skins, beams, placement ghost, FX rings, greenhouse interior glow), and anything with `userData.noAO === true`. Frosted domes (0.92), carried cubes and ice shards (0.9) still occlude. `aoVisible(object)` is the pure predicate; the subclass's override applies it and `restoreVisibility()` restores exactly the cached state.
- Chain: RenderPass → AO → (bloom) → Output → FXAA. The composer is built lazily and rebuilt on an AO toggle, exactly as for bloom; toggling releases the pass's targets.
- Parameters are tuned by screenshot: radius ≈0.5 world units, modest thickness, blend intensity ≈0.9 — target: darker building bases, tank gaps, panel undersides and dome rims, with no dark outline around silhouettes against the sky/ground.
- If High's measured frame-body cost exceeds the budget below, AO renders at half resolution (override `setSize` in the subclass).

### Quality ladder (`perf.ts`)

`PerfStep` gains `shadowSize: 1024 | 2048` and `ao: boolean`:

| step | fps | ratio | bloom | shadows | shadowSize | ao |
|---|---|---|---|---|---|---|
| 0 HIGH / AUTO start | 60 | 1.5 | ✓ | ✓ | 2048 | ✓ |
| 1 | 30 | 1.5 | ✓ | ✓ | 2048 | ✓ |
| 2 | 30 | 1.25 | ✓ | ✓ | 1024 | – |
| 3 | 30 | 1.0 | ✓ | – | 1024 | – |
| 4 LOW | 30 | 1.0 | – | – | 1024 | – |

Environment lighting is on at every step. `renderer.syncStep()` applies `setShadowSize` and `setAO` alongside the existing levers.

## Error handling and resources

- A failed or unsupported bake (e.g. context loss) leaves the previous environment in place; the game never depends on it (the ambient floor keeps the scene visible).
- `SkyEnvironment.dispose()` releases the PMREM generator, the current target, and the sky scene's geometry/material; `SceneManager.dispose()` calls it. World switches do not recreate it (colors change through the bake).
- GPU resource counts must return to baseline across world switches, quality toggles, and a full sol (see Testing).

## Testing

**Unit (Vitest):**
- `environment.ts`: sky colors per world/daylight/weather (night has zero sun glow, dust converges zenith and horizon, low sun blends toward `lowSunGlow`); `rebakeReason` (world/weather → immediate; sub-threshold moves → null; the 250 ms limit); normalized-luminance intensity is continuous across a daylight sweep.
- `shadow-fit.ts`: all 8 slab points inside the box for a sweep of zooms, pans and sun angles; a sub-texel pan keeps the snapped phase; small zoom changes keep `S`; the near-vertical sun uses the fallback basis without NaNs.
- `perf.ts`: ladder shape updated; existing governor behavior tests unchanged.
- `postfx.ts`: AO pass present only when enabled; follows DPR and resize; its targets are released on toggle and dispose.
- `ao.ts`: `aoVisible` over sprite / points / line / depthWrite-false / translucent / 0.92 dome / `noAO`; override-then-restore returns every object's original visibility.

**Browser (Playwright, `e2e/graphics.spec.ts`):**
- Shadow coverage now asserts that the **visible** ground (the 8 slab points at each of the four panned edges, five times of day) lies inside the shadow camera, and that the map size follows the pinned step.
- "High and Low grade the same frozen scene without bloom" keeps passing with AO held constant across both captures.
- New: after 3 world switches, HIGH↔LOW toggles and one full sol at 30×, `renderer.info.memory` geometries/textures return to their baseline, with no WebGL errors.

**Visual QA:** fixed seed and camera, paused: 4 worlds × {dawn 0.26, noon 0.5, dusk 0.78, night 0.93, storm noon} × {HIGH, LOW}, before and after, collected on one comparison page.

**Performance:** the reference built colony, same camera, pinned HIGH and pinned LOW, the governor's frame-body EMA over 20 s, before vs. after. Record the bake count and mean bake cost across one sol at 1× and 4×.

## Acceptance criteria

1. In daylight on all four worlds, grey metal and frosted surfaces show their own hue — no brown cast (`#787f8a` reads grey).
2. Shadows are visibly sharper at default and close zoom; the automated coverage test passes at every pan/zoom/time it samples.
3. AO darkens contacts and crevices on HIGH, is absent on LOW, and produces no halos around bubbles, name tags, beams, or the placement ghost.
4. Night stays dark, but buildings read as separate shapes against the ground; rust warnings and the bloom set are unchanged.
5. LOW's frame-body cost is within ~10% of today's on the reference colony; HIGH stays under the governor's demote threshold on the M4 Pro (70% of 16.7 ms ≈ 11.7 ms).
6. Engine, worker, protocol, and saves untouched; `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e` pass; `docs/rendering.md` documents the environment, shadow fitting, AO, and the new ladder levers.
