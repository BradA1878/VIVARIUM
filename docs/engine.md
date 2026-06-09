# The Engine

`src/engine/` is the game. It's a deterministic, synchronous simulation that runs
inside a Web Worker and depends on nothing from the renderer, Vue, the network, or
TensorFlow. Everything in this document is pure: same seed + same inputs → same
future. (See [architecture.md](architecture.md) for *why*.)

## A building is data, not code

The whole tech tree is `engine/defs.ts`. The engine has no idea what a greenhouse
*is* — it runs recipes against resource pools. A `BuildingDef` declares footprint,
material cost, staffing, power priority, what it `consumes`/`produces` per second,
storage `caps` it adds, and pressure/door requirements.

| Building | Glyph | Role | Per-second |
|---|---|---|---|
| Pressure Hub | HUB | Source of the seal; everything floods out from here | −1.5 power |
| Corridor | === | Carries the seal between hub and habs | −0.2 power |
| Habitat | HAB | Houses 4 colonists | −1.0 power |
| Solar Array | PV | Power from sunlight; follows the sol, gutted by dust | +solar |
| Battery Bank | BAT | Stores power (+120 cap) — the buffer through the dark | — |
| Ice Extractor | H2O | Power in, water out | −5 power → +4 water |
| Electrolysis | O2 | Splits water for oxygen; served first | −7 power, −2.5 water → +5 O₂ |
| Hydroponics | GRO | Food + a little oxygen; needs 2 workers; shed first | −6 power, −3 water → +5 food, +2 O₂ |
| Water Cistern | CIS | Holds water (+160 cap) | — |
| Oxygen Tank | TNK | Reserve oxygen (+130 cap) | — |

**Balancing means editing numbers in `defs.ts` and `tuning.ts`, never touching
engine logic.** `tuning.ts` holds the global knobs: per-colonist life-support
demand, base/starting pool amounts, sol length (150 s), the grace timer (55 s
before an empty pool turns lethal), storm scheduling, arrivals, resupply, the
campaign deadline, and the embodied-colony economy.

## The tick is ordered passes, not one equation

`engine/tick.ts` is a pure function of `(state, dt, rng, envRng, emit)` that
mutates state in place and emits events. The feel of the genre lives in the
ordering. The passes, in order:

1. **Environment / sol clock** — advance time of day, roll the sol, emit
   `dawn`/`dusk`/`new_sol`.
2. **Solar & power** — compute the daytime solar curve, apply the hazard throttle,
   then allocate power **by priority**. In a deficit the engine **browns out the
   lowest-priority consumers first**, so hydroponics starves before life support
   and life support starves before nothing. This single pass is most of the game.
3. **Production gates** — each building runs only if staffed, powered, and (when
   required) pressurized; outputs are scaled by how much it actually got.
4. **Colonist demand** — population draws oxygen/water/food from the pools.
5. **Shortfall → grace timer → casualty** — when a life-support pool hits empty a
   grace timer starts; if it isn't recovered before the timer runs out, a colonist
   is lost.
6. **Embodied colony** — integrate colonist movement, mining, and unloading
   (see below), and step the deposit field and trade window on the **env-RNG**.
7. **Resupply** — Earth windows open on a schedule and trickle resources in.
8. **Campaign** — evaluate the win/lose arc (see [gameplay.md](gameplay.md)).

Pools are buffers that **decouple** the passes: batteries carry power across the
night, tanks and cisterns carry oxygen and water across a production gap. That
decoupling is what makes the colony feel like a system instead of an equation.

## Determinism: the seeded RNG and two streams

`engine/rng.ts` is a small seeded generator. The engine threads **two independent
streams**:

- the **main RNG** drives hazards, arrivals, and resupply timing;
- a **separate env-RNG** drives the deposit field and trade windows.

Splitting them is deliberate: adding the explore/gather/trade layer must not
perturb the hazard/arrival sequence, so an old save replays byte-for-byte. Colonist
movement and pathfinding use **no** RNG at all — they're fully determined by state.

## Pressure, connectivity, doors, and routing

- **Connectivity** (`connectivity.ts`) flood-fills the pressure seal from the hub
  through conduits (corridors) and sealed buildings. A building that
  `requiresPressure` only functions while connected.
- **Doors** (`doors.ts`) — pressure buildings have a `door` side that turns with
  `BuildingState.rot`. Doors are routing + visual only; the seal rule is unchanged.
- **Corridors** (`route.ts`) — the Corridor palette tile is a 2-click auto-route
  mode that runs a BFS from door to door and lays the connecting tiles.
- **Pathfinding** (`pathfind.ts`) — unpossessed colonists route around buildings
  via a deterministic BFS to a building's door/access cell.

## The embodied colony

Colonists are real engine entities (`colonists.ts`): a `ColonistInstance` with
continuous grid coordinates, and `population === colonists.length`. One colonist
can be **possessed** by the player (`possess` + `moveIntent` commands); it auto-mines
surface **deposits** (`deposits.ts`: ice → water, ore → materials, cache → food)
and auto-unloads at the hub. **Materials** is the build currency — every building
has a `matCost`, gated in `grid.ts` (`canPlace`) and mirrored in `predict.ts`.

**Alien traders** (`trade.ts`) arrive on a window like resupply; `respondTrade`
swaps pools or buys permanent **alien tech** (`techs.ts`) with materials. Techs are
capacity / passive-power / demand upgrades applied through `caps.ts` and the tick.
Takes are always clamped to storable capacity.

## Save / resume

`engine/index.ts` exposes `SaveData`; `persistence/` serializes it to localStorage
or Mongo. Because the engine is deterministic, a save is tiny and a resume is exact
— `save.test.ts` asserts the round-trip. (Saves from a different grid size are
discarded on load.)

## See also

- [architecture.md](architecture.md) — the worker wall and protocol
- [gameplay.md](gameplay.md) — what these systems feel like to play
- [development.md](development.md) — adding a building or a command
