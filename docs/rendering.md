# Rendering

The renderer lives entirely on the main thread (`src/render/`) and is a pure
consumer of the worker's output. It reconciles a three.js scene against each
`Snapshot` and never talks to the engine except through `SimBridge`. (See
[architecture.md](architecture.md).)

## Snapshot reconciliation

`render/renderer.ts` is the reconciler. Each frame it diffs the latest snapshot
against the meshes it already has and adds, removes, or updates buildings to match —
the same model-as-data approach as the engine. It holds no authority over
simulation state; if a building exists in the scene, it's because the snapshot said
so.

## The procedural building kit

The design doc calls for a Blender → glTF kit. This environment can't run Blender,
so `render/three/kit/` reproduces the prototype silhouettes as **procedural three.js
meshes** (`dome.ts`, `drum.ts`, `solar.ts`, `tank.ts`, `corridor.ts`, plus
`astronaut.ts`, `deposit.ts`, `alienship.ts`). The kit goes through a `contract.ts`
seam and keeps a `GLTFLoader` path, so real `.glb` assets can drop in later with no
changes at the call sites.

Corridors are special: rather than a fixed mesh, they render as **neighbour-aware
arms** (`kit/corridor.ts`) that connect to adjacent corridors, hub, and habs, so a
routed run reads as one continuous pressurized link.

## Camera

- An **isometric** camera framed on the colony (the buildable area is 15×15).
- WASD input in the HUD is **camera-aligned**: `App.vue` rotates the player's intent
  into the iso basis so "up" is up on screen regardless of camera angle.
- When you possess a colonist, the renderer runs a **follow-cam** off
  `snapshot.possessed`, interpolating the colonist's continuous position between
  snapshots so movement stays smooth at the snapshot rate.

## Terrain, atmosphere, and hazards

- `terrain.ts` builds the Mars ground plane the colony sits on.
- `atmosphere.ts` handles sky/lighting and the day-night feel as the sol turns.
- `hazardfx.ts` renders hazard state — most visibly the dust storm that dims the
  scene as it guts solar output.
- `coords.ts` converts between engine grid cells and world space; `placement.ts`
  drives the build ghost and its valid/blocked tint (mirroring engine rules via the
  prediction seam).

## Performance

The renderer is deliberately frugal because this is a background Easter egg, not a
foreground app:

- render is **capped at 30 fps** and uses a **reduced pixel ratio** to spare the
  battery;
- the entire three.js bundle is **lazy-loaded** behind the Easter-egg trigger
  (`index.html` / `src/main.ts`), so the heavy renderer never lands on the host
  page until the colony view is opened.

## See also

- [architecture.md](architecture.md) — the snapshot/command wall the renderer sits behind
- [gameplay.md](gameplay.md) — the camera and controls from the player's side
- [development.md](development.md) — the `window.__viv` hook for driving the renderer in tests
