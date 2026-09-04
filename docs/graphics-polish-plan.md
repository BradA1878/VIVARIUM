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

Acceptance: clean thin edges; matching High/Low color treatment; subtle night
body definition; ground contact visible on Low; no per-building real lights,
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
  Integrate using `KitEnv.dt`; stop while paused/offline and at a completed
  stalled fabrication cycle. Keep the existing status lights/progress gauge.

Acceptance: surfaces retain their palette at overview zoom; machinery motion
stays inside its housing, is frame-rate independent, and follows operating
state. No changes to other kits or gameplay required.

## Verification and review

Root reads the actual diff and runs `npm run build`, `npm test`, and
`npm run typecheck` at checkpoints, then commits each phase. Compare seeded
browser captures at identical camera/time/quality for day, night, storm,
and every world. Inspect machinery active/paused/offline and check resource
counts through quality/world changes. Measure frame pacing on the same
browser workload before/after. Independent reviewers check the final diff
against this brief; root confirms findings and performs the final audit.
