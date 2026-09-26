# Pressure network: auto-connect, docking, and clear feedback — design

- **Date:** 2026-09-26
- **Status:** design approved section by section in the brainstorm (auto-lay the corridor on placement; every hub a root and touching sealed buildings dock; ghost preview, fault badges, HUD alert, and network overlay).
- **Scope:** engine connectivity rule and the `place` command; placement preview, network overlay, fault badges, and HUD alert on the main thread; the narrator's failure reasons; hints and docs. No change to power, staffing order, balance, or saves' shape beyond one optional field.

## The problem

Brad (the only player) reports two things: connecting corridors after every new building is tedious, and he cannot tell whether a building is connected. While playing he also mistook an unstaffed oxygen shortage for a connection problem, because the game shows one rust status light for every reason a building is off.

What the code does today:

- `engine/connectivity.ts` floods the seal from the **first** hub only, through hub and corridor cells; a sealed building is connected if one of its cells touches a reached cell. Sealed buildings do not pass the seal to each other, and a second hub is not a root. Neither rule is visible in the game.
- Corridors are laid with the Corridor tool: click a building, click another, and `route.ts` `planRoute` lays the shortest path between them. Placing a building never lays a corridor.
- While aiming, the ghost says only placeable (cyan) or blocked (rust). Nothing says whether the building will be connected.
- Once placed, `renderer.ts` `buildingStatus` shows the same rust light for no seal, no crew, no input, and no power. A one-time hint explains corridors once.
- The narrator's world model (`agent/worldmodel/graph.ts` `reasonFor`) guesses a failure reason from flags and pools in a different order than the engine checks them, and never reports damage.

Sealed buildings (`requiresPressure: true`): hab, reclaimer, electrolysis, greenhouse (Hydroponics), medbay. Everything else is a surface building and neither needs nor passes the seal. A corridor costs 2 materials per cell.

## Goals

1. Placing a sealed building leaves it connected, or says why not before the click.
2. At any time the player can see which buildings are on the network and why any building is not running.
3. The rules are easier to reason about: hubs pressurize, docked modules share the seal, corridors bridge gaps.

## Non-goals

- Crew assignment order (crew is still handed out in build order, so life support is not staffed first). The new NO CREW badge makes this visible; changing it is a separate balance decision.
- Auto-connecting on `move`. A moved building that loses its seal shows a badge and an alert.
- Simulating pressure flow. Connectivity stays a boolean gate.
- Corridor aesthetics (preferring straight runs). The manual Corridor tool remains for custom routes.

## 1. The connection rule (engine)

A new pure module `src/engine/seal.ts` owns the flood so the engine and the main-thread preview share one implementation.

- `sealNetwork(N, buildings)` → `{ cells: Set<number>, connected: Set<number> }` (cell index `y * N + x`, building uids). It builds its own occupancy from the building footprints, so it runs on `ColonyState.buildings` and on `Snapshot.buildings` alike.
- **Roots:** every cell of every hub.
- **What passes the seal:** cells of hubs, conduits (corridors), and sealed buildings. The flood moves 4-neighbour through passing cells.
- **Connected:** a building whose cells the flood reaches. That is every hub, every corridor that traces back to a hub, and every sealed building that touches such a corridor, a hub, or another connected sealed building (docking).
- **Surface buildings** never pass the seal and are never marked connected (nothing reads `connected` for them: the pressure gate, the renderer, the alerts, and the world model all check `requiresPressure` first).
- **No hub:** nothing is connected, as today.

`recomputeConnectivity(s)` becomes a thin wrapper: run `sealNetwork`, write `b.connected` for every building. It is still called once per tick, and now also from `place` (below). The flood uses a uid → building map instead of `buildings.find` per cell.

Saves: existing colonies pick up the rule on load. Some buildings that were unsealed become sealed. Nothing in the save format changes.

## 2. Auto-connect on placement (engine)

The planner lives in `seal.ts` beside the flood.

`planSealRoute(N, buildings, network, footprint)` → one of:

- `{ kind: "touching" }` — a footprint cell is 4-adjacent to a network cell. No corridor.
- `{ kind: "corridor", path, newCells, cost }` — the shortest corridor from the building to the network.
- `{ kind: "no-route" }` — no network exists or no path reaches it.

Search: breadth-first from the building's free perimeter cells (in-bounds cells 4-adjacent to the footprint, not in it, not occupied by a non-corridor building), in footprint scan order with the fixed neighbour order `[1,0], [-1,0], [0,1], [0,-1]`. Passable cells are empty cells and corridor cells that are not in the network (a dangling corridor is reused for free). The goal is the first passable cell 4-adjacent to a network cell. `path` runs source → goal inclusive; `newCells` are the empty cells on it; `cost = newCells.length × corridor matCost`. The footprint itself is treated as occupied (in the worker the building is not inserted until the plan is accepted). Fixed ordering makes the result deterministic; there is no RNG and no clock.

The `place` command gains an optional flag:

```ts
| { type: "place"; defId: string; gx: number; gy: number; rot?: number; connect?: boolean }
```

`Colony.place(defId, gx, gy, rot, connect = false)`:

1. `canPlace` as today (lock, footprint, terrain, the building's own materials).
2. If `connect` and the def is sealed: `recomputeConnectivity(s)` so flags reflect earlier commands this batch, then `sealNetwork` and `planSealRoute` with the footprint.
   - `corridor` and `def.matCost + cost > materials` → return false. **Nothing is placed.**
   - `corridor` and affordable → insert the building, then `place("corridor", x, y)` for each of `newCells` (each charges 2 and emits a `build` event, as `route` already does).
   - `touching` or `no-route` → insert the building only. A `no-route` building is placed unsealed; the ghost warned first.
3. `recomputeConnectivity(s)` again, so the next command and the next snapshot see the new network.

`connect` defaults to false so existing command logs and callers keep their meaning. The placement controller sends `connect: true`; the flag is ignored for surface buildings. `worker/host.ts` passes it through; `worker/bridge.ts` `place(defId, gx, gy, rot, connect?)` sends it. Co-op needs no change: the architect's `place` goes straight from the host's own bridge to the worker, and `net/hostRelay.ts` only forwards guests' astronaut commands (`moveIntent`, `interact`) and drops build commands.

The manual Corridor tool (two-click route and hand-laid cells) is unchanged.

## 3. Ghost preview while placing (main thread)

Only when the tool is a sealed building.

- `BridgeCore.previewSeal(defId, gx, gy, rot)` runs `sealNetwork` on `latest.buildings` (memoized per snapshot) and `planSealRoute` with the ghost's footprint, and returns the plan plus `total = def.matCost + cost` and `affordable = total <= materials`.
- `PlacementController`, on each hover or rotation change in place mode, draws the plan's `path` as ghost tiles with the existing tile pool: cyan when affordable, rust when not. When not affordable the footprint ghost turns rust too (blocked). It reports the preview through a callback the store keeps (`placePreview`), like hover today.
- `Inspector.vue`'s placing strip ("PLACING HABITAT · click to place …") shows one status line from a pure function `sealPreviewText(preview, materials)`:
  - `touching` → "connects to the network"
  - `corridor`, affordable → "lays N corridor cells · 2N mat (T total)"
  - `corridor`, not affordable → "needs T mat, have M" (rust)
  - `no-route` → "no route to the network · will be unsealed" (rust)
  - surface building → no line
- Touch keeps the two-tap contract: the first tap aims (and previews), the repeat tap commits.

The preview and the worker run the same functions on the same data, so they agree unless a snapshot is stale for a frame.

## 4. Network overlay (render)

`src/render/three/network-overlay.ts` — one `InstancedMesh` of flat cell tiles on the ground, colored per instance:

- dim cyan under every cell of the connected network (hubs, corridors, connected sealed buildings);
- rust under every cell of a sealed building that is not connected;
- nothing under surface buildings.

Visible while any build tool is active (place, Corridor, Demolish); hidden otherwise. It reads the snapshot's `connected` flags (the engine's truth) and rebuilds only when a key built from the building list and connected set changes. Tiles sit just above the ground, like the placement tiles.

## 5. Why a building is off: the engine's `offReason` (engine)

`BuildingState` gains:

```ts
export type OffReason = "power" | "damaged" | "faulted" | "seal" | "crew" | "water" | "oxygen" | "food";
offReason?: OffReason;
```

(Named `offReason` rather than `fault` because `BuildingState.faulted` already exists: the solar-flare electronics-fault timer.)

The production pass in `tick.ts` already checks gates in a fixed order. It now records the first that fails: not online after the power pass (`"power"`), `!buildingFunctional` (`"faulted"` while the flare-fault timer runs, else `"damaged"`), sealed and not connected (`"seal"`), no labor (`"crew"`), a missing non-power input (that resource). `offReason` is cleared at the start of each building's pass and stays undefined when the building runs or has nothing to run. It is derived state written every tick, so it is deterministic; it rides snapshots and saves with the other flags, and a save from before this change fills it on the next tick.

The world model's `reasonFor` reads `b.offReason` when present (`seal` → unsealed, `crew` → unstaffed, `power` → unpowered, an input → starved with `starvedOf`, and `damaged`/`faulted` → a new `damaged` reason with prose "is damaged"), and falls back to today's derivation for snapshots that lack it. The badge, the alert, and the narrator then give the same reason.

## 6. Fault badges (render)

`src/render/three/badges.ts` `FaultBadgeSystem`, built like `nametags.ts`: pooled `THREE.Sprite` billboards with a `CanvasTexture` cached per label, unlit, no depth test, canvas work only inside methods (node-test safe).

- A small dark pill above the roof of any building with an `offReason`: NO POWER, DAMAGED, FLARE FAULT, NO SEAL, NO CREW, NO WATER (NO OXYGEN / NO FOOD for completeness).
- Corridors are excluded, so a brownout does not badge every corridor cell.
- Updated when a snapshot changes; nothing per frame. The anchor height comes from the building mesh's bounds, taken once when the mesh is built.
- The existing rust status light stays; the badge says why.
- A pure `badgeFaults(snapshot)` → `{ uid, label }[]` is unit-tested.

## 7. HUD alert (UI)

A pure `faultAlerts(buildings)` in `ui/components/alerts.ts` adds one line per kind when its count is above zero, each carrying the uids:

- "N UNSEALED · no corridor to a hub"
- "N UNSTAFFED · no free crew"
- "N DAMAGED · offline until repaired" and "N FLARE FAULT · electronics recovering"
- "N NO WATER · input empty" (and oxygen/food if they ever occur)

Power faults are left to the existing BROWNOUT alert (the badges still name them per building). Lines are severity 2, listed after hazards.

Fault lines render as buttons. Clicking one calls a store action that asks the renderer to `focusBuilding(uid)` for the next uid of that kind: the camera pans to the building (the camera rig offset the e2e already uses) and the existing ring-pulse effect marks it. Repeated clicks step through the list.

## 8. Words the player reads

- `ui/hints.ts` corridor hint: sealed buildings lay their own corridor when placed; a NO SEAL badge means there was no route, so clear a path or build closer to the base.
- `ui/components/guide.ts` greenhouse copy: place it touching the base or anywhere with a clear path; it connects itself.
- Docs: `docs/gameplay.md` (building the colony, doors and corridors), `docs/engine.md` (pressure and connectivity), `docs/rendering.md` (overlay and badges), and `CLAUDE.md`'s "Doors / rotation / corridors" entry, which currently says the pressure-seal rule is unchanged.

## Data flow

```
place tool (main) ── previewSeal(snapshot) ──▶ ghost tiles + placing strip
      │ click
      ▼
Command { place, connect: true } ──▶ worker: Colony.place → plan → building + corridors
                                                   │ tick: sealNetwork → connected; production → offReason
                                                   ▼
snapshot ──▶ overlay (connected) · badges (offReason) · alerts (offReason) · narrator (offReason)
```

## Testing

- **Engine (Vitest):**
  - `seal.test.ts` — the rule: two hubs each root a network; a sealed chain docks; a surface building between two sealed buildings breaks the chain; corridors off an isolated second hub connect to it; no hub → nothing connected.
  - `seal.test.ts` — the planner: touching → no corridor; shortest path length; a blocked building → `no-route`; a dangling corridor is reused for free; the same inputs give the same path.
  - Placement: an affordable connect places building and corridors and charges `matCost + 2 × cells`; an unaffordable one places nothing; `no-route` places the building unsealed; `connect` omitted keeps today's behavior.
  - Off reasons: each kind is set by the gate that fails first and cleared when the building runs.
  - Existing tests that encode the old rule are rewritten: `engine.test.ts` "a sealed unit cut off from the hub goes offline" (docking now keeps the seed electrolysis sealed through the habs, so the test isolates a unit that touches nothing sealed) and the brownout test's comment that habs do not extend a seal.
  - The determinism and replay tests keep passing (the new rule is a pure function of state).
- **Main thread (Vitest, node):** `sealPreviewText`, `badgeFaults`, `faultAlerts`, the overlay's cell and color sets, and the world model's fault mapping.
- **e2e (Playwright):** place a hab away from the network through the canvas and see it connected with corridor cells laid; see the placing strip's corridor status while aiming; see the overlay while the tool is active; remove a corridor to unseal a building and see its NO SEAL badge and the UNSEALED alert. Specs stay off HIGH and freeze the render loop around canvas clicks (CI renders on SwiftShader).
- `npm run typecheck`, `npm test`, `npm run build`, and the full e2e suite pass locally and on CI.

## Acceptance criteria

1. A sealed building placed touching the base is connected with no corridor laid.
2. A sealed building placed away from the base lays the shortest corridor and is connected on the next snapshot; materials drop by the building's cost plus 2 per new cell.
3. When building plus corridor cost more than the materials on hand, nothing is placed, and the ghost said so in rust before the click.
4. When no route exists, the building is placed unsealed, the ghost warned before the click, and afterwards it shows NO SEAL and counts in the UNSEALED alert.
5. Every hub pressurizes its own network; docked sealed buildings share the seal; surface buildings neither need nor pass it.
6. While any build tool is active, the overlay marks the connected network in cyan and unconnected sealed buildings in rust.
7. A building that is not running shows a badge naming the engine's first failing gate, and the narrator's diagnosis gives the same reason.
8. The HUD alert counts unsealed, unstaffed, damaged, flare-faulted, and starved buildings; clicking a line pans to them in turn and marks each with a ring pulse.
9. The engine stays deterministic; all unit tests, typecheck, build, and e2e pass locally and on CI.
