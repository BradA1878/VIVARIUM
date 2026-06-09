# Corridors, Doors & Rotation — Design

## Context
Corridors today are placed one 1×1 cell at a time and the corridor mesh always
faces world-X regardless of its run, so a north–south run reads as a row of
sideways arches (the "coil" in the screenshot). Players want to (1) connect
buildings easily, (2) have corridors snap to building openings, and (3) rotate
buildings to aim the door. Decisions taken: **auto-route A→B**, **one fixed door
per building**, **rotation to aim the door**.

## Scope decision (load-bearing)
Doors are a **routing target + visual anchor only**. The engine's pressure
connectivity stays as-is (any adjacent conduit seals a pressurized building), so
the verified tick/campaign/tests are untouched and existing saves keep working.
The door governs where the auto-route aims and where the airlock renders — not
the sim's seal rule.

## Data model
- `BuildingState.rot: 0|1|2|3` (quarter-turns). Every footprint is square (1×1 or
  2×2), so rotation never changes occupancy — only the door side + mesh facing.
- `BuildingDef.door?: Side` on the four pressure buildings (`hub`, `hab`,
  `electrolysis`, `greenhouse`). `Side = 0|1|2|3` = N/E/S/W with grid deltas
  `0→(0,-1) 1→(1,0) 2→(0,1) 3→(-1,0)`. World door side = `(def.door + rot) % 4`.
- `engine/doors.ts`: `doorExit(def, gx, gy, rot) → { edge:[x,y], exit:[x,y] }`
  (the building's own edge cell at the door, and the exterior cell a corridor
  targets). Used by the router, the ghost predictor, and the renderer.

## Auto-route
- `engine/route.ts`: pure BFS over an abstract `isBlocked(x,y)` + grid `N`, from
  the source building's door `exit` to the target's door `exit`, 4-neighbour,
  through empty-or-corridor cells. Returns the path of cells (or `null` if a door
  is walled in). The worker runs it on its authoritative grid; the main thread
  runs the same function on snapshot-derived occupancy to preview the ghost.
- Worker command `{type:"route", fromUid, toUid}` → computes the path and places
  a corridor on each path cell (authoritative, atomic).

## Interaction
- **Corridor tile → link mode.** Click a door-bearing building = source (it
  highlights + shows its door arrow); click another = route source→target and lay
  the run. Clicking an empty cell hand-lays a single corridor (fallback). Right-
  click / Esc clears the selection / exits.
- **Rotation = `R`.** While placing: cycles the ghost's rotation and the door
  arrow. While hovering a placed building with no tool: rotates that building in
  place (re-aim the seed colony). Worker command `{type:"rotate", gx, gy}`.

## Rendering
- **Building facing:** `meshGroup.rotation.y = -rot · π/2`. A centralized airlock
  ring is added to door-bearing building groups on the `def.door`-local side, so
  group rotation lands it on the world door side ("snap to opening").
- **Corridors orient to neighbours:** the renderer computes a 4-bit neighbour
  mask per corridor — a bit set when the neighbour is another corridor, or a
  door-building whose door `exit` is this cell. The corridor mesh rebuilds as a
  sum of **arms** (one half-tube per set bit, from centre to that edge) plus a
  centre cap; arms toward a door end in an airlock. This yields straight / elbow /
  T / cross / end-cap naturally, and corridors attach only at openings.

## Testing
- Vitest: door `exit` cell per rotation (all 4); rotation keeps `canPlace`/
  footprint valid; router finds a door→door path and returns `null` when blocked.
- Playwright: rotate a hab so its door faces the hub, auto-route a corridor,
  confirm a connected run with airlocks at both ends and the colony seals.

## Build order
1. Data model: `rot` + `door` (shared/types, defs, state, colony, predict).
2. `engine/doors.ts` + `engine/route.ts` + worker `route`/`rotate` commands + bridge.
3. Placement: link mode + `R` rotation + ghost door arrow + path preview.
4. Renderer: building facing + airlock + neighbour-aware corridor arms.
5. Tests + in-browser verification.
