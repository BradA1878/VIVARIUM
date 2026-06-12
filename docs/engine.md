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
| Hydroponics | GRO | Food + a little oxygen; needs 2 workers; shed early in a brownout | −6 power, −3 water → +5 food, +2 O₂ |
| Med-Bay | MED | Triage for strike wounds; needs 1 worker; heals fastest at its door, under a medic | −4 power |
| Water Cistern | CIS | Holds water (+160 cap) | — |
| Oxygen Tank | TNK | Reserve oxygen (+130 cap) | — |
| Deflector Array | DFL | Wards off UFO abductions while powered; sheds early in a brownout | −3.5 power |
| Wind Turbine | WND | Power from moving air; rides the wind curve — strongest at night and in dust | +9 power × wind level |
| Geothermal Tap | GEO | Flat power, sol and night; **only seats on a vent** (`needsVent`) | +6 power |
| Fission Reactor | FIS | Big steady power; needs 1 worker (engineer-matched); a normal pass-4 recipe | −0.5 water → +20 power |
| Materials Printer | PRN | Regolith → build currency (`producesMat`); priority 15, shed first in a brownout | −6 power → +0.35 materials |
| Rover Bay | RVR | Garage; fabricates one drivable bulk hauler on a 45 s countdown | −2.5 power |
| Robotics Bay | BOT | Prints autonomous mining robots; needs 1 worker (engineer-matched) | −4 power |

The first twelve are the founding set, always placeable. The six below the
Deflector are the **expansion tier**, latched open by the abundance unlocks
(below). Optional def fields carry the new mechanics — `wind` (scaled by the
wind curve), `steady` (flat generation), `producesMat` (the printer), and
`needsVent` (terrain-restricted placement) — and the engine still just runs
data: no per-building code anywhere.

**Balancing means editing numbers in `defs.ts` and `tuning.ts`, never touching
engine logic.** `tuning.ts` holds the global knobs: per-colonist life-support
demand, base/starting pool amounts, sol length (150 s), the grace timer (55 s
before an empty pool turns lethal, on normal difficulty), storm scheduling,
arrivals, resupply, the campaign deadline, the embodied-colony economy, morale
and injury rates, and the difficulty profiles — plus the homeostasis groups:
auto-gather (`AUTO_CARRY 12`, `GATHER_DWELL 1.2 s`), the rover fleet
(`ROVER_*`: cap 1, 45 s build, speed 4.5, cargo 80, strike damage/repair), the
robot fleet (`ROBOT_*`: cap 3, 60 s build, 40-materials completion fee, speed
1.6, carry 30, 12 s flare stun), the wind curve (`WIND_*`), and the geothermal
vents (`VENT_*`, including the legacy-backfill salt).

The auto-hazard scheduler's cadence lives here too (`hazards.ts`): the first
scheduled hazard at **180 s**, then a **150–280 s** gap — stretched ~2× by the
homeostasis update so a settled colony gets visible runs of calm. (The
Director, when enabled, replaces this scheduler with its own, similarly calmed
pacing — see [agent-layer.md](agent-layer.md).)

## The tick is ordered passes, not one equation

`engine/tick.ts` is a pure function of `(state, dt, rng, envRng, emit)` that
mutates state in place and emits events. The feel of the genre lives in the
ordering. The passes, in order:

1. **Environment / sol clock** — advance time of day, roll the sol, emit
   `dawn`/`dusk`/`new_sol`, and run the hazards. A meteor or quake **strike now
   wounds colonists** near the impact cell as well as damaging buildings (see
   *Injuries* below).
2. **Resupply** — Earth windows open on a schedule and trickle resources in.
   In the code this runs inside the environment pass, right after the hazards
   and before any generation or demand.
3. **Generation & power** — compute the daytime solar curve and apply the hazard
   throttle; in the same pass, **environmental generation** charges the pool:
   each wind turbine adds `def.wind × windLevel` and each geothermal tap a flat
   `def.steady`, gated only on `buildingFunctional` (no staffing, no inputs —
   generation is weather, not production). Then allocate power **by priority**:
   in a deficit the engine **browns out the lowest-priority consumers first**,
   so hydroponics starves before life support and life support starves before
   nothing. This single pass is most of the game.
4. **Production gates** — each building runs only if staffed, powered, and (when
   required) pressurized; outputs are scaled by how much it actually got. The
   labor pool is **population minus the injured** (the wounded are off shift), and
   role-matched staffing plus colony morale scale what a building **produces** —
   never what it consumes. The **fission reactor** is deliberately a normal
   recipe building here (water in, power out, engineer-staffed), so every gate
   applies untouched; the **materials printer**'s `producesMat` credits the
   build currency in this pass too, scaled by the same efficiency and clamped
   to the materials cap (outside net flow, which tracks the four survival
   pools only).
5. **Colonist demand** — population draws oxygen/water/food from the pools.
6. **Shortfall → grace timer → casualty** — when a life-support pool hits empty a
   grace timer starts; if it isn't recovered before the timer runs out, a colonist
   is lost.
7. **Morale** (pass 6b) — after brownout/casualty resolution and before arrivals,
   integrate the morale drivers and latch the `morale_low` / `morale_recovered`
   thresholds (see *Morale* below).
8. **Arrivals & births** — new colonists land only on a real surplus with housing;
   a thriving settlement also grows from within.
9. **Embodied colony** — integrate colonist movement, gathering, and unloading
   (see below), step the deposit field, trade window, and UFO on the **env-RNG**,
   and run **injury recovery** just before colonists step (so the healed can take
   a work slot the same tick). The automation ladder runs here too: the Rover
   Bay's fabrication line and the fleet's self-repair (`rover.ts`), piloting for
   a possessed rover, then the Robotics Bay's line and the autonomous miners
   (`robots.ts`), which step through the **same claim set** the colonists' pass
   built.
10. **Abundance unlocks** (pass 7d) — evaluate the un-latched gates and latch
    any that pass, just before the campaign verdict (see *Abundance unlocks*
    below).
11. **Campaign** — evaluate the win/lose arc (see [gameplay.md](gameplay.md)).

Pools are buffers that **decouple** the passes: batteries carry power across the
night, tanks and cisterns carry oxygen and water across a production gap. That
decoupling is what makes the colony feel like a system instead of an equation.

## Wind is a pure curve, not a draw

`engine/wind.ts` computes `windLevel` once per tick beside `solarMul` — a pure
derivation of `(sol, tod, active dust)`, **zero RNG draws**: a base level of
0.45, a diurnal cosine that bottoms exactly at solar noon (so wind **peaks at
night**), a ~3-sol synoptic swell, and a boost of up to +0.35 at full active
dust intensity (storms *are* wind), clamped to `[0.05, 1]`. The
anti-correlation with solar is the design: a turbine is the panel's complement,
not a cheaper panel — it carries the night and the storm, the two places solar
dies. The value is stored on state and surfaced on the snapshot
(`Snapshot.windLevel`) for the renderer's rotor and the ambient audio bed.

## Determinism: the seeded RNG and two streams

`engine/rng.ts` is a small seeded generator. The engine threads **two independent
streams**:

- the **main RNG** drives hazards, arrivals, and births;
- a **separate env-RNG** drives the deposit field, the geothermal vents (seeded
  once at world-gen), the trade windows, and the UFO.

Splitting them is deliberate: adding the explore/gather/trade layer must not
perturb the hazard/arrival sequence, so an old save replays byte-for-byte. Colonist
movement and pathfinding use **no** RNG at all — they're fully determined by state.
The whole automation ladder keeps that property: auto-gather, the rover, the
robots, and the unlocks **draw nothing from either stream** — claims are
nearest-by-distance² with id tiebreaks, fabrication is countdowns, and the
robot flare-stun is a flat rule.

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
continuous grid coordinates, and `population === colonists.length`. One actor
can be **possessed** by the player (`possess` + `moveIntent` commands); the
`interact` command (the player pressing **P**) explicitly fills its hands from a
surface **deposit** in reach (`deposits.ts`: ice → water, ore → materials,
cache → food) or empties them at the **depot**. **Materials** is the build
currency — every building has a `matCost`, gated in `grid.ts` (`canPlace`) and
mirrored in `predict.ts`. `canPlace` also enforces the two newer placement
rules: a locked expansion def is refused (`unlocks.ts defLocked`), and a
`needsVent` building must cover a vent cell.

The surface itself is two layers of terrain (`deposits.ts`). **Geothermal
vents** seed first at world-gen — three of them, off the border, clear of the
base, spaced apart — and never deplete or move; they exist solely for the
geothermal tap to seat on. The **deposit field** scatters around them (deposits
reject vent cells) and respawns on a timer. Kind weights are a single env-RNG
draw per node — **ore 40% / ice 32% / cache 28%** (caches were 21% and the
larder underran an untouched colony by ~sol 4, so food got the share; still
exactly one draw, so the env stream's draw count is unchanged).

### The automation ladder

Three rungs, one shared brain — all of it RNG-free.

- **Auto-gather** (`gather.ts`) — gathering is the **day-idle default**: an
  unpossessed, unstaffed, healthy colonist claims a node, walks to it, dwells
  `GATHER_DWELL` (1.2 s) to mine, hauls `AUTO_CARRY` (12 — gentler than the
  piloted 20) to the depot, banks, and repeats; a dusk carrier finishes its
  depot run before sleeping. Claims are **sticky** (`gatherDepositId`, the
  `workUid` pattern) so two gatherers never thrash over a node, and they hold
  while the node lives. **Fresh claims are need-aware** (`kindsByNeed`): an
  empty-handed agent serves the colony's **scarcest pool first** — kinds ranked
  by ascending fill fraction of their destination pool, exact ties breaking
  survival-first (cache, ice, ore) — falling through to the next-scarcest kind
  when the field has none, then nearest-by-distance² within the kind (tie →
  lowest id, unclaimed preferred). Note the deliberate limit: need-awareness
  applies **only at claim time** — a gatherer mid-chain on a long-lived ice
  node keeps working it while food drains, and re-ranks at its next fresh claim.
- **The rover** (`rover.ts`) — one drivable bulk hauler, fabricated by the
  Rover Bay on a 45 s countdown that **pauses (never resets)** while the bay is
  dark. Multi-kind cargo bays (80 units across all kinds, banked in a fixed
  `CARGO_KINDS` order — determinism by declaration), 4.5 cells/s under the same
  `moveIntent` command. Strikes within 1.6 cells dent integrity by 0.35
  (`applyStrikeMachines`, run beside the injury pass on every strike path); it
  self-repairs at 0.02/s, is immobile below the 0.45 functional threshold, and
  is **never destroyed** — a big purchase must not evaporate.
- **Mining robots** (`robots.ts`) — the Robotics Bay (staffed, unlike the
  rover's garage) prints up to 3 autonomous gatherers on a 60 s countdown whose
  40-materials fee is charged **at completion** (an unaffordable chassis holds
  at zero). They run the **same `stepGatherer` brain** sol and night, never
  shelter, draw no life support, and count toward neither population nor labor.
  Counterplay is deterministic: a flare's activation front stuns the whole
  fleet for 12 s; a meteor/quake strike within 1.6 cells **scraps a robot
  outright** (`robot_destroyed`) — robots are the cheap, brittle rung where the
  rover is expensive and tough.

Two unification tricks hold the ladder together. **The unified actor id
space**: rover *and* robot ids draw from `s.colonistCounter`, so every
possessable id is globally unique and the existing `possess {id}` protocol
addresses a rover with no new command (`Colony.possess` resolves colonists
first, then rovers; robots are deliberately not possessable). And **one shared
claim set per tick**: `stepColonists` seeds it from every standing claim and
threads it through `stepRobots`, so the species never thrash over a node —
fresh claims resolve in the colonists' pass (id order) and then the robots'
pass (id order) over that one set, which means a colonist out-claims a robot
contesting the same node within a tick.

**Alien traders** (`trade.ts`) arrive on a window like resupply; `respondTrade`
swaps pools or buys permanent **alien tech** (`techs.ts`) with materials. Techs are
capacity / passive-power / demand / deflector-boost upgrades applied through
`caps.ts` and the tick, plus two medical ones: **Medi-Gel** multiplies the injury
recovery rate ×2, and the **Harmonizer** raises the colony's morale floor to 0.45.
Takes are always clamped to storable capacity.

## Abundance unlocks

Six expansion buildings would bury a new player in palette, so the tech tree
**reveals itself as the colony earns it** (`unlocks.ts`). `GATES` is a data
table — defId → predicate over `ColonyState` — and each tick `updateUnlocks`
latches any gate that first passes into `s.unlocked` (persisted) and emits
`unlock {defId, detail}` **exactly once**; an unlock never revokes, even if its
condition regresses. Anything not in the table (the founding twelve) is always
open. The gates land each building when its problem is felt:

| Def | Gate |
|---|---|
| Rover Bay | sol ≥ 3 **or** materials ≥ 80 |
| Wind Turbine | sol ≥ 4 **or** an active dust hazard (the first storm sells it) |
| Materials Printer | population ≥ 6 |
| Geothermal Tap | sol ≥ 6 (the vents are visible from sol 1 — a mystery before they're usable) |
| Fission Reactor | population ≥ 8 **and** materials ≥ 150 |
| Robotics Bay | a reactor built, **or** population ≥ 10 **and** materials ≥ 200 |

The gate is **engine-authoritative**: `grid.ts canPlace` and `predict.ts`
refuse locked defs, so no client can build ahead of the curve;
`computeUnlocks()` feeds `Snapshot.unlocks` for the palette. Pure predicates,
zero RNG draws — and a legacy save (no latch) simply re-derives the
currently-true gates on its first tick, announcing the new buildings once.

## The roster: names, roles, matched staffing

Colonists have **names and roles**, and both are *pure derivations of the stable
colonist id* (`roster.ts`) — no RNG draws, nothing stored, so determinism, replay,
and old saves are untouched. `roleOf(id)` walks `id % 4` over
miner / engineer / botanist / medic (the four seed colonists cover all four
roles); `nameOf(id)` indexes fixed first/last tables with strides coprime to
their lengths, so names only repeat every 120 consecutive ids.

Roles match buildings through the `BUILDING_ROLE` table — `miner→extractor`,
`botanist→greenhouse`, `medic→medbay`, and the **engineer** covering the
electrolysis unit, the fission reactor, *and* the Robotics Bay (unmapped defs
simply never match). Staffing assignment (`colonists.ts`) is a
**deterministic two-pass**: slots are enumerated in building-uid order; pass 1
hands each slot the lowest-id unclaimed colonist whose role matches the building,
pass 2 backfills the rest in id order. The injured are eligible for neither pass.
A matched crew works the recipe harder — `ROLE_BONUS` (0.25) gives
`eff = 1 + 0.25 × matched/staffing`, applied to **produces and net only**, never
to consumes — so individuality can only help a colony, never starve it.

## Morale

`s.morale` is **one colony-level scalar** in `[floor, 1]` (`morale.ts`) — a pure
function of state, zero RNG draws, no per-colonist mood. It starts at 0.7, where
the production multiplier `1 + 0.35 × (morale − 0.7)` is exactly **1.0**, so a
fresh colony balances identically to before. Continuous drivers integrate in
their own tick pass: down 0.012/s per active shortfall timer and 0.004/s while
the brownout latch is on; up 0.005/s while calm and 0.004/s while the
self-sufficiency clock runs. The big emits step it discretely (casualty −0.12,
abducted −0.15, injured −0.04, birth +0.10, arrival +0.08, trade +0.05).

Morale scales **produces only — never walk speed** — which rules out a
sad-colony-moves-slower death spiral by construction, and the hard floor (0.15,
multiplier ≈ 0.81; the Harmonizer tech raises the floor to 0.45) bounds the
damage. Crossing below 0.35 latches and emits `morale_low`; recovering above
0.55 emits `morale_recovered` — the same latch pattern as the brownout detector.

## Injuries and the Med-Bay

A meteor or quake strike wounds **every colonist within 1.6 cells** of the impact
(`injury.ts`) — near-misses still hurt — and a **second hit while wounded kills**,
through the existing casualty machinery (`casualty` with detail `"strike"`). Who
gets hurt falls out of the strike cells the hazard system already rolls, so the
main RNG stream is byte-identical: zero new draws.

An injury is base-seconds of recovery (30 s fresh). Healing is a pure rate that
runs **everywhere** — there are no stranded states — multiplied ×3 within 1.6
cells of a functional, online Med-Bay's door, ×1.5 again when a **medic** staffs
its slot, and ×2 by the Medi-Gel tech (the multipliers stack). The wounded leave
the labor pool, walk slowly (0.55 cells/s; a possessed pilot at half speed), and
path to the nearest treatable Med-Bay on their own, else limp home.
`colonist_injured` / `colonist_recovered` events carry the colonist id.

## Difficulty profiles

`tuning.ts` defines three `DIFFICULTY` profiles over the same engine:

| | easy | normal | hard |
|---|---|---|---|
| Grace timer | 75 s | 55 s | 40 s |
| Launch deadline | Sol 28 | Sol 22 | Sol 18 |
| Hazard gap × | 1.4 | 1 | 0.7 |
| Hazard intensity × | 0.8 | 1 | 1.25 |
| UFO cadence × | 1.5 | 1 | 0.7 |
| Starting materials | 130 | 90 | 60 |

Two rules keep this safe. **Normal is the legacy constants exactly**, so
`new Colony(seed)` and `new Colony(seed, "normal")` are byte-identical — a test
pins it. And the multipliers apply **after** each RNG draw (gap and intensity,
then clamped), never before, so draw counts — and therefore the whole RNG stream —
are identical across difficulties; Director-passed intensities scale coherently
through the same path. The difficulty is chosen at reset
(`reset{difficulty}`), persisted in state, and surfaced on the snapshot.

## Save / resume

`engine/index.ts` exposes `SaveData`; `persistence/` serializes it to localStorage
or Mongo. Because the engine is deterministic, a save is tiny and a resume is exact
— `save.test.ts` asserts the round-trip. (Saves from a different grid size are
discarded on load.) The format stays `version: 1`: fields added later get graceful
load defaults in `Colony.load` — `difficulty ?? "normal"`, `morale ?? 0.7`,
`moraleLatch ?? false`, per-colonist `injury ?? 0`, and the homeostasis fields:
`rovers`/`robots` default to empty fleets with fresh fabrication countdowns
(`roverFab ?? 45`, `robotFab ?? 60`), `windLevel ?? 0` (recomputed next tick),
`unlocked ?? []` (re-derived and re-announced once on the first tick), and the
per-colonist gather fields (`gatherDepositId ?? null`, `gatherT ?? 0`). So a
pre-release save loads as a normal-difficulty, neutral-morale, uninjured colony
with no machines and the currently-earned schematics.

**Vents get a special backfill.** A pre-generation-economy save carries no
vents, but seeding them from the live env-RNG would shift its serialized state
and break byte-identical resume — so `Colony.load` backfills from a **derived**
`RNG(seed ^ VENT_BACKFILL_SALT)` instead. Every load of the same save gets the
same terrain and the same future, and the live env stream keeps resuming
untouched.

## See also

- [architecture.md](architecture.md) — the worker wall and protocol
- [gameplay.md](gameplay.md) — what these systems feel like to play
- [development.md](development.md) — adding a building or a command
