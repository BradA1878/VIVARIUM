# Graphics refinement

Preserve the fixed isometric camera, procedural silhouettes, existing world
palettes, cyan operational signals, warm windows, and quiet industrial mood.
All work is render-side: no engine, worker protocol, balance, save, UI, or
dependency changes.

## Phase 1 — rendering foundations

- `three/scene.ts`: modest night silhouette fill using existing lighting;
  refine sun shadow precision without increasing its map resolution.
- `three/terrain.ts`: expose the actual triangulated ground height for
  surface details; do not alter terrain geometry or world-generation draws.
- New `three/ground-details.ts`: batch subtle contact shadows, base dust,
  and healthy night door/window spill onto the terrain. Rotate with buildings,
  follow moves/removals/world changes, and dispose owned GPU resources.
- `renderer.ts` / `kit/contract.ts`: wire ground details and optional paused
  context; retain the observer/command wall and existing kit compatibility.

Acceptance: subtle night body definition; ground contact visible on Low;
no per-building real lights,
no ground clipping, no stale details after scene changes.

## Phase 2 — disjoint rendering and asset work

- `three/postfx.ts`: antialias the HDR render path while retaining the same
  ACES/exposure/output ordering at every quality level. Compare scene MSAA
  with post-process AA before choosing the cheaper acceptable method. Low
  releases bloom resources. Keep resizing, DPR changes, flare cues, and
  disposal correct.
- Materials/terrain: `materials.ts`, `terrain.ts`, new `surface-detail.ts`.
  Small seeded roughness maps keep existing average roughness/base colors;
  restrained world-scaled soil bump adds no geometry or obstacles. MaterialLib
  owns shared maps and exposes `dispose()`; renderer disposes it after kits.
- Machinery: `kit/facility.ts`. Small functional motion for printer,
  robotics bay/reclaimer gantry, and fabricator within current silhouettes.
  Integrate using `KitEnv.dt`; stop while paused/offline. Hold the fabricator
  at completion/lineage cap and Robotics Bay at the fleet cap. Keep the
  existing status lights/progress gauge.

Acceptance: clean thin edges and matching High/Low color treatment; surfaces
retain their palette at overview zoom; machinery motion stays inside its
housing, is frame-rate independent, and follows operating state. No changes
to other kits or gameplay required.

## Verification and review

Root reads the actual diff and runs `npm run build`, `npm test`, and
`npm run typecheck` at checkpoints, then commits each phase. Compare seeded
browser captures at identical camera/time/quality for day, night, storm,
and every world. Inspect machinery active/paused/offline and check resource
counts through quality/world changes. Measure frame pacing on the same
browser workload before/after. Independent reviewers check the final diff
against this brief; root confirms findings and performs the final audit.

## Implementation and validation

- FXAA follows the shared ACES/sRGB output pass. It was cheaper than scene
  MSAA and SMAA in the same headless browser workload. The final pipeline uses
  one HDR scene target, one depthless 8-bit output target, and no canvas MSAA.
  These comparative timings do not establish native-device frame rates.
- A GPU browser regression verifies byte-identical High/Low color treatment
  with bloom strength zero at the same resolution. Another regression proves
  moved building meshes follow the authoritative footprint; that pre-existing
  bug was fixed in its own commit.
- Production build, typecheck, and all 652 unit tests pass. The full Playwright
  suite passes 16 tests; 16 are intentionally skipped for the opposite device
  class. Browser fixtures cover all four worlds, day/night/storm, active and
  paused/offline machinery, and fleet/lineage holds without WebGL errors.
- Three complete world/quality cycles return to the same geometry and texture
  counts (252/19 in the test colony). A final viewport/DPR change keeps FXAA
  resolution matched to the drawing buffer. Night spill was softened in the
  final visual pass to preserve the dark, quiet setting.
