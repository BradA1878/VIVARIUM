# Larger construction area

Expand usable terrain from 25×25 to 41×41 cells (625 → 1,681). Retain the
45×45 terrain footprint by reducing the scenic margin to two cells. Keep the
camera's default zoom, building scale, world palettes, and procedural style.

## Implementation brief

- Engine: `tuning.ts` defines `GRID_N = 41` and `FOUNDING_GRID_N = 25`.
  `colony.ts` seeds on the established 25-cell opening, then uses the existing
  pure `migrateGrid` to grow it before exposing a snapshot. Constructor/reset
  share this path. This preserves opening resources and RNG states. Existing
  smaller saves use the same load migration; no protocol or save schema change.
- Render extent: `coords.ts` exports `SCENIC_MARGIN = 2`. Terrain, weather,
  and camera bounds use it consistently. Keep the existing terrain vertex
  count at the current grid size. Scene shadows cover the full landscape while
  keeping the existing light direction and shadow-map resolution.
- Terrain: normalize scenic relief over distance outside the square build
  area, including short margins. Keep all buildable corners shallow and finite.
  Place the full silhouettes of decorative rocks/monoliths outside construction
  cells and inside the terrain. Keep world-specific colors and seeded variation.
- Tests: expand migration coverage to every spatial entity, immutable load
  inputs, preserved RNG/IDs/cargo, and continued deterministic save/resume.
  Adapt tests of the opening layout to the translated colony without weakening
  their assertions. Verify far-edge placement and pathfinding and derive browser
  coordinate expectations from snapshot size.

Implement shared constants and founding first, then delegate disjoint terrain
and test work. Main owns renderer integration, browser checks, and synthesis.
Review the combined diff, run build/typecheck/full tests, and commit the complete
feature after independent adversarial review. No new dependencies, mechanics,
economy tuning, or UI controls. Future resources and spatial hazards naturally
use the expanded grid; the opening remains the established one.

## Acceptance

- Fresh games and loaded 25-cell colonies expose 41×41 buildable cells.
- Existing layouts and resources retain their relative/world-space positions.
- Construction works beyond all four old boundaries, up to the new boundary;
  footprints outside the new grid are rejected.
- No decorative geometry or scenic hills intrude into construction cells.
- Default framing stays familiar; pan/zoom and shadows support the new edges.
- Same-seed runs and save/resume remain deterministic, with no new RNG/clock.

## Compatibility limitation

The renderer is initialized with the local build's grid size. Existing 25-cell
saves migrate safely to 41 cells. Saves made by future versions with larger
grids, and co-op peers running different grid-size versions, need a separate
renderer rebuild path; tracked beside `ThreeRenderer.grid`.

## Validation

- Production build/typecheck and all 672 unit tests pass.
- Playwright: 19 checks pass, with 19 skips for the other device profile.
  Includes real canvas placement at every expanded edge, dawn/noon/dusk shadow
  coverage, touch confirmation, camera controls and colony resource markers.
- Browser-loaded a save captured before expansion: all buildings and resource
  sites retain their world positions, and both RNG states remain unchanged.
- Visually checked Mars, Ceres, Io and Titan, plus edge construction at day/night
  and storm warning gusts. All worlds retain the 45-cell terrain span and 2,116
  terrain vertices; no browser or shader errors were observed.

Separate fixes discovered during validation: mouse clicks now resolve their own
cell before the next render frame; reused deposit/vent/aquifer IDs follow the
incoming colony's coordinates, with changed deposit kinds replacing their mesh.
Previously ineffective brownout and water-reclaimer test setups were repaired.
