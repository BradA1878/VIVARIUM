# VIVARIUM — Embodied Colony (astronauts, possession, gathering, traders)

Status: approved 2026-06-07. One pass, single commit, subagents in parallel.

## Goal

Extend VIVARIUM from a god-view SimCity-style manager into a hybrid colony-survival
game: real colonist astronauts move on the surface, you can **possess** one and
control it directly (WASD) to **search for and gather resources**, gathering feeds
**both** a materials build-economy and the survival pools, and **alien traders**
periodically arrive to swap resources.

Every new mechanic lives inside the hard wall (doc §0): the engine stays
deterministic and synchronous in the worker. Player control is expressed as
**Commands applied at tick boundaries** (`moveIntent`, `interact`, `possess`,
`respondTrade`) so replay / save / determinism tests still hold.

## 1. Colonists & possession (engine)

- `ColonistState { id, x, y, facing, state, carrying: {res,amount}|null, workUid, homeUid, possessed }`
  in `ColonyState`; surfaced as `snapshot.colonists: ColonistView[]`. Count == population;
  a casualty removes one.
- New ordered tick pass `stepColonists` (after staffing is resolved): assign each
  colonist to a building the engine already decided is staffed (deterministic sort),
  then move:
  - unpossessed → auto state machine (`toWork → working → toHome`, `sheltering` during
    an active hazard → nearest sealed building), fixed speed, no `Math.random` (idle
    bob derived from `id`+tick).
  - possessed → integrate the standing `moveIntent{dx,dy}` at player speed; ignore AI.
- Colonists reflect existing staffing/production decisions; they do **not** change the
  resource math, so the existing passes and tests are untouched.
- Movement: straight-line across the surface (EVA), clamped to map bounds; no building
  collision v1.

## 2. Searching for resources (engine)

- `snapshot.deposits: DepositView[]` — seeded field scattered across the map away from
  base. Kinds: `ice → water`, `ore → materials`, `cache → food`. Finite `amount`,
  deplete as mined, removed at 0; occasional new deposits spawn deterministically.
- `interact` Command (context action for the possessed colonist):
  - standing on/adjacent to a deposit, not full → channel a chunk into `carrying`
    (capacity ~20; carry is single-kind).
  - within base radius (near hub) → unload `carrying` into the matching pool
    (water/food/materials).

## 3. Materials economy (engine)

- New `materials` resource + pool. `BuildingDef.cost?: Partial<Record<Resource,number>>`.
- `place` / `canPlace` / `canPlacePredict` check affordability and deduct on placement.
- Colony starts with a modest `materials` stock — covers the seed colony + a little, so
  meaningful expansion requires gathering. Sized so existing test placements still pass;
  fix any fallout.
- HUD: ResourceRail gains a materials cell; Palette tiles show cost and grey out when
  unaffordable.

## 4. Alien traders (engine + UI + narrator)

- `snapshot.trade?: { id, phase: inbound|landed|leaving, give:{res,amount},
  take:{res,amount}, deadlineSol, x, y }`, modeled on the existing resupply window.
- Seeded offer scheduled on a window → `traders_inbound` event → ship lands →
  `respondTrade{accept}` Command: accept swaps pools (clamped to caps, refused if you
  can't pay the `take`) → `trade_done`; decline / deadline → `trade_left`.
- Council first-contact moment + accept/decline reactions.

## 5. Renderer & camera

- Low-poly EVA astronaut per colonist (possessed = selection ring + brighter; carry shown
  as a glowing cube above the head); deposit meshes per kind that shrink as they deplete;
  alien saucer that descends/sits/lifts from `snapshot.trade`.
- Follow-cam: on possess the orthographic camera smoothly pans+zooms to track the
  colonist; on release it restores the overview. Stays orthographic.
- Positions interpolate between snapshots (like the existing status pulse).

## 6. Protocol / wiring

- Commands added to `worker/protocol.ts`: `possess{id|null}`, `moveIntent{dx,dy}`,
  `interact`, `respondTrade{accept}`; handled in `worker/host.ts`; exposed on
  `worker/bridge.ts`. `App.vue` maps F (possess/release), WASD (moveIntent), E (interact).

## 7. Tests

- Colonist determinism: same seed → identical positions after N ticks (no possession).
- Possess + moveIntent moves deterministically; release resumes AI.
- Mine → carry → deposit moves the right amounts and depletes the node.
- Build refuses when materials short and deducts when sufficient; `canPlacePredict` matches.
- Trade accept swaps pools (caps/insufficient honored); decline/expiry leaves pools intact.
- Casualty removes a colonist.

## Build order

Write `shared/types.ts` + determinism-critical engine core first (colonists, movement,
possession, mining, materials, deposits). Then fan out in parallel: renderer
(astronaut/deposits/follow-cam), alien-trade (engine lifecycle + ship + prompt + narrator),
HUD (possession bar, material costs, trade prompt), tests. Integrate →
`npm run typecheck && npm test` → Playwright drive (possess, walk, mine, deposit,
build-with-materials, trade) → single commit.

## v1 simplifications (can extend later)

- One build resource `materials` (no ore→metal refining chain).
- No building collision while walking (EVA on the surface), bounds-clamped.
- Follow-cam stays orthographic (pan/zoom), not a new perspective rig.
