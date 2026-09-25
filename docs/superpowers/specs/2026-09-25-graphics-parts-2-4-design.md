# Graphics overhaul, parts 2–4: materials, terrain, atmosphere — design

- **Date:** 2026-09-25
- **Status:** directions approved in the brainstorm (all four parts in scope, "same look, done right"); Brad directed "build it, test it, ship it", so review gates are waived. Designed on top of part 1 (`2026-09-25-lighting-foundation-design.md`), from screenshots of the reference colony with part 1's lighting in place.
- **Scope:** render layer only. No engine, protocol, save, balance, or UI changes. No new dependencies. Brad is the only player; the PerfGovernor ladder stays as the safety net.

## What part 1 left visible

Close-ups at noon and night with part 1's lighting (`.playwright-mcp/visual-review/p2-plan/`):

1. Solar panels read as dull brown-grey slabs with two seams; nothing says photovoltaic.
2. Airlock tori are the brightest objects on screen, day and night — cyan hooks hanging off every corridor joint.
3. Comms dishes (hub mast, dish greeble) use the dark PV material and read as dark blobs.
4. Domes are smooth, uniformly shiny shells — "plastic" rather than built.
5. The robotics bay and printer frames (tan `#8c8470`, violet `#8a7f94`) read as wood.
6. The corridor skin is 55% transparent: a ghost tube, and invisible to AO.
7. The ground has no detail at play zoom; at overview zoom the terrain's diamond edge shows against the background, with the far corner reading as a mountain.
8. Night: shapes read, but only the emissives carry the colony; ground light pools are faint.
9. Storm: dust devils are hard-edged translucent cones.

## Part 2 — materials and buildings

| Change | Where | Design |
|---|---|---|
| **PV glass with cells** | `materials.ts` `panel()`, `kit/solar.ts` | `panel()` becomes dark blue glass: base `#0f1c2e`, metalness 0.1, roughness 0.18 (reflections come from the sky environment, Fresnel brightens grazing angles), a small seeded **cell texture** (`pv-cells`, 256² DataTexture: 6×4 cells per panel face, thin silver grid lines, two bus bars per cell, faint per-cell tint variation) applied as `map` on a dedicated face plane sitting on the panel's top. The two seam boxes go (the texture draws the grid). |
| **Dishes** | `kit/dome.ts` | Hub and greeble dishes switch to a light brushed-metal material (`#b8bec6`, rough 0.35, metal 0.6, `side: DoubleSide`) so the bowl reads from any angle. |
| **Airlocks** | `renderer.ts` airlock geometry/materials | A metal collar ring (`Torus(0.2, 0.055)`, hull metal `#8a929c`) carries a thin inset signal ring (`Torus(0.205, 0.014)`, emissive cyan `0.35 + 0.6·night`, healthy path only). Both are shared singletons, as today. Cyan stays a small signal, not a shape. |
| **Corridor skin** | `kit/corridor.ts` | Opacity 0.55 → 0.9, color matched to the dome shell; ribs darker (`#5a626c`). The tube reads as pressurized hull and joins AO. |
| **Dome panels** | `materials.ts` (new `domePanels` map), `kit/dome.ts` | A shared seeded DataTexture (256×128, equirect over the hemisphere's UVs): 16 meridian seams, 3 latitude rings, slight per-panel roughness variation. Used as `bumpMap` (scale 0.01) and a roughness modulation on the dome cap only. Greenhouse keeps its tint. |
| **Shared finish** | `materials.ts` | `frostedDome()` metalness 0.35 → 0.2, roughness 0.4 → 0.5 (a composite shell, not chrome); `metal()` default metalness 0.72 → 0.6. Explicit trim values stay. |
| **Facility frames** | `kit/facility.ts` `specFor` | Robotics bay `#8c8470` → steel `#7f8790` with a safety-yellow `#c9a23a` trim strip on the gantry beam; printer `#8a7f94` → `#838a96`. Rover bay and fabricator keep their colors. |
| **Night pools** | `ground-details.ts` | Spill opacity `0.065·night` → `0.11·night`; radii unchanged. Still no real lights. |

## Part 3 — terrain and surroundings

| Change | Where | Design |
|---|---|---|
| **Far field** | `terrain.ts` | A second, coarser mesh (**skirt**) continues the landscape from the current 45×45 terrain edge out to ±150 units, so no pan/zoom shows an edge. It is a ring (hole = the existing terrain square), 3-unit cells, built from the same `sample()` height/color functions extended with far-field dunes and craters; its inner edge sits 0.03 below the terrain edge to avoid a visible seam. The existing 45×45 mesh, `heightAt`, ground details, and rock placement are unchanged (their tests keep passing). |
| **Far scenery** | `terrain.ts` | Mesas and boulder fields scattered on the skirt (instanced, seeded from the world's rock seed, outside the 45×45 square); silhouettes fade into the fog. |
| **Ground detail** | `terrain.ts` material `onBeforeCompile` | World-space procedural albedo variation in the terrain shader: three octaves of value noise (≈0.4, 3, 14 units) for grain, patches and regional tone; a sparse dark "pebble" speckle; everything multiplied into the vertex color within ±12%, so the world palettes hold. Applies to the main terrain and the skirt. No extra draw calls. |
| **Pebbles** | new `three/pebbles.ts` | ~1,500 tiny instanced rocks (0.03–0.09 units, one `InstancedMesh`, no shadow casting) scattered over the build area and its border from a seeded stream, tinted per world. They sit on `heightAt`. Structures cover them; nothing else changes. |
| **Background** | `scene.ts` | The background color becomes the fog/horizon color, so anything beyond the far field blends into the haze. |

## Part 4 — atmosphere polish

| Change | Where | Design |
|---|---|---|
| **Grade** | `postfx.ts` new `GradeShader` pass after OutputPass (both quality paths) | Subtle lift of shadows toward the world's night tint, highlight warmth, saturation 1.05, and a soft vignette (0.18). Applied identically on High and Low, so the "same grade without bloom" test holds. |
| **Dust devils** | `stormfx.ts` | The hard cones become soft, swirling columns: a custom shader on the existing shells (height fade top and bottom, rim fade by view angle, scrolling spiral noise). Same pooling, counts, and timing. |
| **Storm haze** | `scene.ts` | During dust, fog near/far pull in (38/86 → 34/78 after tuning; the orthographic camera keeps the colony a fixed 47.5 units away, so deeper values fogged the colony itself) so the storm closes the view; eased with the storm factor. |
| **Haze near the ground** | `terrain.ts` shader (from part 3) | A faint distance-based lift toward the horizon color on far terrain, so the far field reads as atmosphere. |

## Constraints and verification

- Each part keeps the High/Low color identity (the grade is on both paths), the GPU resource cycle test, and all existing tests. New unit tests cover the pure pieces: PV cell texture (dimensions, grid lines present, deterministic), dome panel texture, skirt geometry (hole matches the terrain square, finite heights, seam below the edge), pebble scatter (count, bounds, determinism), grade shader uniforms per world.
- Visual QA: the same capture matrix (4 worlds × 5 conditions × zoom levels, High and Low) before/after each part; performance measured on the reference colony against part 1's numbers (HIGH ≤ 11.7 ms body; LOW within ~10% of the pre-overhaul 3.38 ms).
- `docs/rendering.md` updated per part.
