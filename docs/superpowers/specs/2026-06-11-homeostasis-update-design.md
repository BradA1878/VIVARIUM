# Design — The Homeostasis Update

_2026-06-11_

The level-up release made the colony personal; playtesting it surfaced the next
problem: the game has become **running around getting resources**. The player
wants more sim and less manual collection — a colony that, once built well,
reaches SimCity-style **homeostasis** and visibly hums on its own. Three more
notes rode along: the council reads **too poetic**, the narrator terminal is
**too small and buried** (and construction misfires while piloting), and
**storms hammer too often** — confirmed in code: a Director strike every
~100–140 s is roughly once per 150 s sol. This release answers all four as one
package, every mechanic still behind the engine determinism wall (doc §0):

1. **Automation ladder** — idle colonists **auto-gather**, a buildable
   **drivable rover** hauls in bulk, autonomous **mining robots** work through
   the night.
2. **Generation economy** — wind turbines, geothermal vents, a fission
   reactor, and a materials printer turn the environment itself into supply.
3. **Abundance unlocks** — the new tech reveals itself as the colony earns it,
   computed and latched by the engine.
4. **Pacing + voice** — hazards land ~2× less often; the council goes **"dry
   with fingerprints"**; the terminal becomes a bottom-edge **ticker** with an
   expandable log; piloting locks construction.

## Decisions (from planning)

- The narrator becomes a **bottom-edge ticker + expandable log**; the old
  terminal window is deleted, not hidden.
- The council goes **dry with fingerprints** — telemetry-first lines with thin
  per-voice signatures — across **both tiers**: the scripted banks *and* the
  live persona prompts. **No narrator model/SDK changes** (`claude-opus-4-8`,
  `max_tokens 120` stay).
- The **full automation ladder** ships (auto-gather → rover → robots), not one
  rung.
- New buildings: **wind turbine**, **geothermal tap** (vent-restricted),
  **fission reactor**, **materials printer**, plus the **Rover Bay** and
  **Robotics Bay** fabricators.
- **~2× calmer** hazard pacing, still tightening over the sols.
- Unlocks are **engine-computed and latched**, not a UI affordance.
- No new runtime dependencies; the game stays fully playable with no backend
  or keys.

## Guiding principle — automation is motion, not luck

Everything that moves in this release is deterministic by construction:

- **Auto-gather, the rover, and the robots use no RNG at all.** Claims are
  nearest-by-distance² with id tiebreaks, movement integrates intents, and the
  robot flare-fault is a flat zero-RNG rule (every robot faults).
- **Wind is a pure curve** of `(sol, tod, active dust)` — a derivation, never
  a draw.
- The **only new randomness is world-gen**: vents seed from the existing
  **envRng** stream (deposits/traders/UFO). The **main hazard/arrival/birth
  stream gains and loses zero draws**, so its future stays byte-identical.
- **Unlocks are latched pure predicates** over state the engine already owns.

## 1. The automation ladder

Three rungs, one shared brain.

**Rung 1 — auto-gather (`engine/gather.ts`, new).** Gathering becomes the
**day-idle default**. The colonist decision chain becomes hazard→shelter |
injured→medbay | day && workUid→work | **(day || carrying) && deposit→gather**
| home/idle — night is still for resting, but a dusk carrier finishes its
depot run instead of abandoning cargo. The mechanics are the possessed-mining
helpers **refactored out of `interactPossessed`** (a behavior-identical
rewire): `nearestDepositInReach`, `pickupFromDeposit`, `dropCarryAtDepot`, and
a shared `stepGatherer(s, agent, dt, claimed, {speed, carryCap, dwell})` —
walk to the deposit, dwell `GATHER_DWELL 1.2 s` ("mining"), take
`min(cap − carry, amount)`, haul to the depot ("hauling"), drop, repeat.
**Sticky claims** (`gatherDepositId` per colonist, the `workUid` pattern) stop
two colonists thrashing over one deposit: nearest-by-distance² wins, ties to
the lowest deposit id, others' claims excluded, kind-filtered while carrying.
Deliberately **gentler than the player**: `AUTO_CARRY 12` at `WALK_SPEED` (vs
the piloted 20 at 2.6), so possession keeps its edge. Possessed, staffed, and
injured colonists are excluded by construction; no new events — the field just
starts working.

**Rung 2 — the rover.** A **separate possessable entity**, not a colonist
buff: `s.rovers` (`{ id, x, y, facing, cargo, integrity }`), fabricated by the
new **Rover Bay** on a colony countdown (`ROVER_BUILD_TIME 45 s`, paused while
the bay is offline; `ROVER_CAP 1`; emits `rover_ready` at a free cell by the
bay). The load-bearing trick is the **unified actor id space**: rover ids draw
from `s.colonistCounter`, so every possessable id is globally unique and the
existing `possess {id}` protocol is **unchanged** — `Colony.possess` resolves
colonists first, then rovers; `bridge.possessNearest` scans both (skipping
rovers below 45% integrity — the functional threshold), strictly nearest, tie
to the lower id. No driver colonist is consumed: possession is the colony's
will, the established fiction. The payoff for driving it: **multi-resource
cargo** (`Partial<Record<DepositKind, number>>`, capped `ROVER_CARGO_CAP 80`
vs the suit's 20) at `ROVER_SPEED 4.5` (vs 2.6) off the same `moveIntent`
command. One interact press grabs from the nearest deposit of *any* kind; one
press at the depot drops **all** kinds in a fixed order. Hazards now touch
machines: meteor/quake strikes within 1.6 cells deal 0.35 integrity (a new
`applyStrikeMachines` beside `applyStrikeInjuries`); the rover self-repairs at
0.02/s, is immobile below the functional threshold, and is **never
destroyed** — a big purchase must not evaporate.

**Rung 3 — mining robots.** `s.robots` — autonomous and **not possessable**
(the refusal is the design: robots are infrastructure, not avatars), ids from
the same actor counter. Fabricated by the **Robotics Bay** (staffed,
engineer-matched): the `ROBOT_BUILD_TIME 60 s` countdown requires the bay
online + functional + staffed, and `ROBOT_MAT_COST 40` materials are drawn
**at completion** — the timer holds at zero until the colony can afford the
body. `ROBOT_CAP 3`; emits `robot_ready`. The brain is the **same
`stepGatherer`** as rung 1 with robot parameters (`ROBOT_SPEED 1.6`,
`ROBOT_CARRY 30`, single-kind), and claims unify **across colonists + robots
in actor-id order** — one claim table, no species priority. What robots buy:
they work **day and night**, never shelter, draw no life support, and count
toward neither population nor labor. The counterplay keeps hazards relevant in
the automated endgame: a **flare faults every robot** for `ROBOT_FLARE_FAULT
12 s` (zero RNG; flares already fault electronics in the fiction), and a
meteor/quake strike within 1.6 cells **destroys** a robot outright
(`robot_destroyed {gx,gy}`) — robots are cheap and brittle where the rover is
expensive and tough.

## 2. The generation economy

Power has been solar + battery; everything else comes from three producers.
This release adds **environmental generation** so a well-read map can hum
through the night — split across **two mechanisms by design**:

- **Environment-driven generation (tick pass 2, beside solar):** the wind
  turbine (`wind: 9` × `windLevel`) and the geothermal tap (`steady: 6`,
  flat) charge the power pool *before* the priority/brownout pass, exactly
  like solar — generation is weather, not production. Both gate only on
  `buildingFunctional` (no staffing, no inputs).
- **Pass-4 producers:** the **fission reactor** is a normal recipe building —
  `produces {power: 20}`, `consumes {water: 0.5}`, staffing 1
  (engineer-matched) — so it rides every existing production gate: online AND
  connected AND staffed AND fed AND intact. Its one tick of latency hides
  behind the battery buffer, and in exchange brownout, staffing, role bonus,
  and integrity all apply untouched. The **materials printer** closes the last
  loop: `producesMat 0.35/s` (× efficiency) into `s.materials`, clamped to
  cap — the build currency finally has an on-planet source beyond mining — at
  **priority 15**, so a brownout sheds the printer before anything that keeps
  people alive.

**Wind is a pure curve, anti-correlated with solar** (`engine/wind.ts`, new):

```
windLevel(s) = clamp(0.05, 1,
    0.45                             // base (long-run average ≈ 0.45)
  − 0.25·cos(2π·(tod − 0.51))        // diurnal: peaks at night
  + 0.15·sin(2π·(sol + tod)/3)       // ~3-sol synoptic swell
  + 0.35·maxActiveDustIntensity)     // storms ARE wind
```

It peaks **at night and inside dust storms** — exactly when solar dies — so a
turbine is not a cheaper panel; it is the panel's complement, and the first
dust storm sells it (see the unlock gate). `windLevel` is computed once per
tick beside `solarMul`, stored on state, and surfaced on the snapshot for the
renderer (rotor speed) and the audio bed.

**Vents are world-gen.** Three geothermal vents seed in `seedColony` via the
existing **envRng** stream, before deposits (≥4 cells from the base, ≥2
apart; deposits reject vent cells). They never deplete. The geothermal tap is
the first **terrain-restricted building**: `needsVent` gates `grid.ts
canPlace`, mirrored in the `predict.ts` ghost. **Legacy saves** carry no
vents, so `Colony.load` backfills them from a **derived `RNG(seed ^ salt)`** —
never the live envRng, whose serialized state must keep resuming
byte-identically.

## 3. Abundance unlocks

Six new buildings would bury a new player in palette. Instead the tech tree
**reveals itself as the colony earns it** (`engine/unlocks.ts`, new):

- `updateUnlocks(s, emit)` runs each tick before the campaign pass; when a
  def's predicate first passes, it **latches into `s.unlocked`** (persisted)
  and emits `unlock {defId, detail: display name}` **exactly once** — unlocks
  never regress even if the qualifying condition later does.
- `computeUnlocks()` feeds `Snapshot.unlocks`; the 12 existing defs are always
  true. The gate is **engine-authoritative**: `grid.ts canPlace` and
  `predict.ts` refuse locked defs, so no client can build ahead of the curve.
- Gates land each building when its problem is felt: Rover Bay
  `sol ≥ 3 || materials ≥ 80` · printer `pop ≥ 6` · wind turbine
  `sol ≥ 4 || active dust hazard` (the first storm sells it while solar dies)
  · geothermal `sol ≥ 6` (vents are visible from sol 1 — a mystery before
  they are usable) · reactor `pop ≥ 8 && materials ≥ 150` · Robotics Bay
  `reactor built || (pop ≥ 10 && materials ≥ 200)`.
- Legacy saves re-derive and re-emit once on load — announcing the new
  buildings to an old colony is correct behavior, not a bug.

The UI phase renders the ladder: locked palette tiles get a padlock and the
unlock condition; an unlock fires a one-shot "NEW SCHEMATIC" toast, a narrator
line, and a chime.

## 4. Pacing — the planet calms down (~2×)

Playtest feedback, confirmed by the constants: the Director strikes every
~100–140 s — about once per 150 s sol — and the engine's own scheduler
(Director off) is similar. Homeostasis needs stretches of calm to be
*visible*. Both pacing sources stretch ~2×; difficulty multipliers are
untouched and still apply **after** the draws (draw counts identical across
difficulties):

| knob | was | now |
|---|---|---|
| Director `FIRST_STRIKE` | 150 s | 220 s |
| Director `BASE_GAP` | 180 s | 340 s |
| Director `MIN_GAP` (floor) | 105 s | 200 s |
| Director `SOL_RAMP` | 4 s/sol | 6 s/sol |
| Director comfort weight | 0.30 | 0.25 |
| Director intensity | `0.4 + 0.045·sol + 0.2·comfort` | `0.35 + 0.04·sol + 0.2·comfort` |
| Scheduler `SCHED_FIRST` | 95 s | 180 s |
| Scheduler gap | 70–140 s | 150–280 s |

Net effect (comfort 0.5): gaps ≈ **292 s at sol 1**, **245 s at sol 10**,
floor 200 s — roughly half the old cadence, still tightening over the run. The
steeper `SOL_RAMP` keeps the long arc menacing; the higher floor stops the
endgame from becoming a metronome. The four pinned `director.test.ts`
expectations (arming time, floor, campaign strike count) move with the
constants.

## 5. The council goes dry; the terminal becomes a ticker

(Summarized at decision level — the UI phase implements.)

**Dry with fingerprints — both tiers.** Every voice rewrites to a
telemetry-first register: **exactly one line, ≤140 chars, concrete rounded
numbers from the snapshot, no metaphor/poetry/feelings** — with a thin
per-voice signature so the cast survives the dryness. VIVARIUM speaks
first-person system status; the WATCHER gives root-cause chains; the
STRATEGIST issues one imperative ending on the verb; the CHRONICLER keeps
ledger counts. The register's pinned exemplar — brownout: *"Demand exceeds
supply. Shedding lowest priority first. Forgive the dark rooms."* The rewrite
covers the **scripted banks** (~150 lines) *and* the **live persona prompts**
(`server/mxf/prompt.ts`), with a `slice(0, 200)` seatbelt client-side.
**Structures are untouched** — SEV keys/values, bank keys, the
`{sol}/{secs}/{detail}/{res}/{chain}` placeholders, the pick/rotate machinery,
the `diagnoseShortfall` chain format — and a **binding prose-test coupling
table** (every substring the council tests pin) is written into the
implementing commit so the rewrite cannot silently break a pinned phrase. New
severities and banks cover the four new events (`unlock 2, rover_ready 2,
robot_ready 2, robot_destroyed 3`).

**Ticker + log.** `Terminal.vue` is deleted (TypedText survives). A
full-width bottom-edge **`NarratorTicker`** shows the latest utterance —
typed text, voice glyph, timestamp, a finite crit-flash at severity ≥ 4 — and
a **`LogOverlay`** pull-up panel holds history (store cap 40→120, instant
text, `L`/Esc/click). `Utterance`/`TerminalLine` gain `severity` so the
ticker never re-derives it.

**Piloting locks construction.** Three independent belts: the F-handler
clears the active tool before possessing, the store's
`pick()`/`toggleDemolish()` early-return while possessed, and
`placement.onClick()` ignores clicks while piloting — plus a **disabled, not
hidden** palette with a "PILOTING — construction locked" hint.

**Renders + audio.** New kits — rover, robot, fumarole vent, wind turbine
(whose rotor **integrates `(0.4 + 7·wind)·dt`**: visible weather feedback),
reactor, facility variants — reconcilers for the three new entity arrays, the
follow-cam unioned over colonists ∪ rovers, vent-cell highlighting while
placing geothermal, and cues for the unlock/rover/robot events. The ambient
wind bed follows the snapshot: `max(base, 0.18 + 0.72·windLevel)`, chosen so
`windLevel 0` reproduces every existing audio pin.

## 6. Vocabulary across the wall

`shared/types.ts` (stays plain data, structured-clone-safe; owned by the
engine phase — and every engine commit that extends `Snapshot` patches the two
full-Snapshot fixtures, `makeSnap` in `agent/council/banter.test.ts` and
`ui/audio/map.test.ts`, in the same commit):

- `VentView { id; gx; gy }`
- `RoverView { id; x; y; facing; cargo: Partial<Record<DepositKind, number>>;
  cargoTotal: number; integrity: number; possessed: boolean }`
- `RobotView { id; x; y; facing; carryKind: DepositKind | null;
  carryAmt: number; faulted: number; state: "idle" | "gathering" | "mining" |
  "hauling" | "faulted" }`
- `Snapshot` += `rovers: RoverView[]; robots: RobotView[]; vents: VentView[];
  windLevel: number; unlocks: Record<string, boolean>`
- `ColonistAct` += `"gathering"` (mining/hauling already exist and now occur
  unpossessed)
- `EventType` += `"unlock" | "rover_ready" | "robot_ready" |
  "robot_destroyed"`; `ColonyEvent` += optional `defId?: string` (`unlock`
  carries the defId *and* the display name in `detail`; `robot_destroyed`
  carries gx/gy)
- `BuildingDef` += optional `wind?: number; steady?: number;
  producesMat?: number; needsVent?: true`

**Protocol: zero changes.** The unified actor id space means `possess {id}`
already addresses rovers; fabrication is a side effect of `place`; everything
else is observation.

**Defs:** the six new ids append to `ORDER` after `deflector`, in exactly this
order: `windturbine, geothermal, reactor, printer, roverbay, roboticsbay`
(preserving the `injury.test.ts` pin that medbay follows greenhouse). The
roster's one-to-one role↔building map refactors to
`BUILDING_ROLE: Record<defId, ColonistRole>` so the engineer can match
electrolysis + reactor + Robotics Bay.

**UI contracts:** `TerminalLine`/`Utterance` gain `severity`; the message cap
rises 40→120 with a `logOpen` ref; `KitEnv` gains optional
`wind?: number; dt?: number` for the turbine rotor.

## 7. Determinism & save compatibility

- **The main RNG stream gains and loses zero draws.** Auto-gather, the rover,
  robots, unlocks, and the pacing change draw nothing; wind is a pure
  derivation; the robot flare-fault is a flat rule. Hazards, arrivals, and
  births stay byte-identical for a given seed.
- **Vents draw from envRng at world-gen** (the deposits/traders/UFO stream).
  This shifts the env stream's draw order for *fresh* colonies versus old
  builds — accepted, like the level-up release's `TECH_IDS` ripple. Resumed
  saves are unaffected (the env stream's serialized state restores), and the
  **legacy backfill uses a derived `RNG(seed ^ salt)`**, never the live
  envRng, precisely so resume determinism holds.
- **One accepted input-dependence:** building a rover consumes an actor id
  from `s.colonistCounter`, which shifts the ids — hence the hash-derived
  names/roles — of *later* colonists versus a run that never built one. Same
  seed + same inputs still produce the same future; this is input-dependence,
  not nondeterminism.
- **`SaveData` stays `version: 1`.** Every new field loads with a graceful
  default in `Colony.load` (the established `?? fallback` pattern): rovers,
  robots, vents (backfilled), `unlocked`, fabrication timers, `windLevel`,
  and the per-colonist gather fields. Legacy saves load as a colony with no
  machines, backfilled vents, and unlocks re-derived (re-announcing the new
  tech — intended).
- Testing idioms hold: **TDD for every engine commit**, same-seed determinism
  pairs (300–600 s), save round-trips mid-trip and mid-fabrication,
  legacy-field-deletion loads, rare events by state injection, and the two
  full-Snapshot fixtures patched in every Snapshot-extending commit.

## 8. Risks & mitigations

- **Prose-test coupling** (the sharpest edge): council tests substring-match
  scripted lines, so the dry rewrite ships against a binding coupling table —
  written with the tests open — enumerating every pinned phrase.
- **Fixture churn:** each `Snapshot` extension breaks the two
  complete-literal fixtures → patched in the same commit, by rule.
- **envRng draw-order shift** from vent seeding → fresh same-seed colonies
  differ across versions; saves resume identically; the legacy backfill
  avoids the live stream.
- **Economy inflation:** auto-gather + rover + robots multiply field inflow,
  but the deposit field itself is the throttle — respawn caps inflow at
  ≈1.1 units/s, and `DEPOSIT_RESPAWN` is the single rebalance lever.
- **Brownout × generators:** wind/geothermal charge in pass 2 (pre-shedding),
  the reactor produces in pass 4 (behind the battery), the printer sheds
  first at priority 15 — the brownout ladder keeps its meaning.
- **Rover-id ripple** on later colonist names/roles → accepted
  input-dependence (§7).
- **Ticker overflow** at narrow widths → the ticker ellipsizes; the log keeps
  full text.

## 9. Out of scope (explicitly deferred)

Reactor meltdown mechanic, multi-rover fleets, robot possession or repair
bays, rover dust-kick particles, terrain geology beyond vents, scripted-line
localization, narrator model changes (stays `claude-opus-4-8`).
