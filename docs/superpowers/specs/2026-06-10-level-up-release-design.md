# Design — The Level-Up Release

_2026-06-10_

VIVARIUM is feature-complete as a loop (build → survive → trade → win/lose), but a
deep dive found big headroom in four areas. This release levels up **all four** as
one coordinated package, every mechanic still behind the engine determinism wall
(doc §0):

1. **Sim** — colonists stop being fungible scalars: **names, roles, morale,
   injuries**, a **Med-Bay**, and **difficulty modes**.
2. **Graphics** — **postfx bloom + ACES**, a **night lighting pass**, terrain
   relief, an astronaut **walk cycle**, **kinetic storms**, UFO/trader upgrades.
3. **Audio/UX** — **procedural sound** (the game is currently silent), a persisted
   **settings** modal, a **run report** with sparklines, contextual **hints**.
4. **Narrative** — council **idle banter**, new event line banks, and **Director
   legibility** (attribution lines + an end-of-run dossier).

## Decisions (from planning)

- All four areas ship as **one coordinated release**, not piecemeal quick-wins.
- The live narrator model **stays `claude-opus-4-8`** — no server changes.
- **No new runtime dependencies**: postfx via `three/addons/postprocessing/*`
  (inside the installed three 0.169.0), audio via raw Web Audio, charts via
  canvas 2D. The game stays fully playable with no backend or keys.
- Sequencing honors the repo pattern: spec → engine (TDD) → render → UI →
  narrative, `npm run typecheck && npm test` green at every commit, Playwright
  drives via `window.__viv` per phase.

## Guiding principle — zero new RNG draws

The release's deepest constraint: it adds **no new draws to either RNG stream**.
Everything new is a *pure derivation*, so same seed + same inputs still produce
the same future:

- **Names and roles** are hashes of the colonist's stable id — derived on demand,
  never stored, zero save churn.
- **Morale** is a pure function of colony state, integrated by the tick.
- **Injuries** derive from existing hazard **strike cells** — no new rolls.
- **Difficulty** multiplies *after* existing draws, so draw counts and sequences
  are identical across difficulties; `"normal"` multipliers are exactly **1.0**,
  making `new Colony(seed)` and `new Colony(seed, "normal")` **byte-identical**.
  Today's behavior is the rollback baseline, and a test pins it.

## 1. Engine — colonists become people

**Roles & names (`engine/roster.ts`, pure).** `roleOf(id)` and `nameOf(id)` are
id-hash lookups into fixed tables (the four seed colonists cover all four roles).
Each role matches a building (`miner→extractor`, `engineer→electrolysis`,
`botanist→greenhouse`, `medic→medbay`). Staffing assignment becomes a
deterministic two-pass: role-matched colonists claim their building first, the
remainder fill in id order; injured colonists are skipped. Matched staffing earns
a production bonus — `eff = moraleMult × (1 + ROLE_BONUS × matched/staffing)` —
applied to **produces and net only**, never to consumes, so individuality can
only help a colony, never starve it.

**Morale — one colony scalar.** `s.morale ∈ [floor, 1]`, no per-colonist mood.
It starts at `MORALE_START 0.7`, where `moraleMult` is exactly **1.0** — a fresh
colony balances identically to today. Continuous drivers integrate in their own
tick pass (down per active shortfall timer and during brownout; up while calm and
while the self-sufficiency clock runs); discrete events bump it at their existing
emit sites (casualty −0.12, abducted −0.15, injured −0.04, birth +0.10, arrival
+0.08, trade +0.05). The effect is **production-only — never walk speed** — which
rules out the shelter-slower→more-injuries death spiral by construction; a hard
floor (`MORALE_FLOOR 0.15`, mult ≈ 0.81) bounds the damage. `morale_low` /
`morale_recovered` are latched events mirroring the existing brownout latch.

**Injuries + the Med-Bay.** Hazard strikes now wound colonists near the impact
cell: healthy → injured (a recovery timer; walks slow, doesn't work, and labor
capacity drops accordingly); already-injured → death through the existing
casualty machinery. The grace-timer casualty pass is untouched. Recovery runs
**everywhere** at a base rate — no stranded states — ×3 near a functional+online
med-bay, faster again when a medic staffs it, ×medigel tech. Injured colonists
path to the med-bay when one exists, else home. The `medbay` is a new 1×1
pressurized building at **priority 60** — between hab/electrolysis and extractor —
so triage survives moderate brownouts but never outranks air.

**Difficulty.** Three profiles in `tuning.ts` — easy / normal / hard — varying
grace windows, the campaign deadline, hazard gap/intensity, UFO cadence, and
starting materials. **Normal is current values exactly.** Multipliers apply after
the scheduler's draws (and scale Director-driven intensity coherently). The
difficulty is chosen at reset, persisted in state, surfaced on the snapshot. Two
new alien techs ride along — `medigel` (heal ×2) and `harmonizer` (raises the
morale floor) — and because `TECH_IDS` auto-grows, traders offer them with zero
changes to the trade system.

## 2. Graphics — Mars gets moody

**PostFx behind a quality switch (`render/three/postfx.ts`).** RenderPass →
UnrealBloomPass → OutputPass with ACESFilmic tone mapping (exposure 1.15). Bloom
**threshold 1.0 is the design**: only emissives pushed above 1.0 bloom, so no
layers or masks — kits opt surfaces into glow by pushing intensity. The switch is
`ThreeRenderer.setQuality("low" | "high")`: high = postfx + shadows + pixelRatio
cap 1.5; low = today's direct render path (NoToneMapping) and must stay
**pixel-identical to today** — the rollback and acceptance gate. `setFlare(level)`
lets flare hazards spike exposure/bloom from `snap.hazards`.

**Night pass + terrain relief.** A `nightLevel(tod, dust)` scalar, computed once
per frame, reaches kit meshes through a new optional `KitEnv` argument on
`setStatus` — builders that ignore it simply don't declare the param. Kits ramp
warm window boxes, port lights, and LEDs at night, with one hard rule: **rust
"hurt" glows get no night boost** — a warning must never halo. Terrain: the play
grid flattens (displacement ×0.15, smoothstepped out within ~3 cells) while
ridged dunes, mesas, and ~7 monolith rocks rise toward the fog line; greeble RNG
seeds are chosen so existing greebles stay byte-stable.

**Walk cycle + transients.** Astronaut limbs move into pivot groups with
`setGait(phase, amp, lean)`; gait phase advances by actual per-colonist movement
speed and the existing bob phase-locks to it. The hazard-FX primitives
(`ringPulse`, `flash`, `puff`) are parameterized and reused for placement pops,
demolish puffs, and possession engage/release rings — all driven by snapshot
diffs, guarded so a save-load doesn't pop-storm and a hazard-destroyed building
doesn't double-burst.

**Kinetic storms + ships.** Dust storms become weather you can see coming: wind-
streak lines ramp through the telegraph phase (the visible warning) and pooled
dust devils wander the grid while the hazard is active. The evil UFO's beam gains
a layered core, rising motes, and a ground ring tied to its grab factor; the
trader deploys landing struts when landed. Abduction-related flashes render **at
the live UFO mesh position** (events carry no coordinates). A DEV-only
`renderer.debugFx(...)` exists solely to make rare events screenshotable.

## 3. UI — sound, settings, the run report

**Settings (`ui/stores/settings.ts` + `SettingsModal.vue`).** One persisted store
(`vivarium:settings:v1`, injectable storage so tests run in node): audio volumes,
graphics quality, the live-narrator toggle (AND-gated over `VITE_LIVE_NARRATOR`,
disabled+explained when no backend), Director on/off (replacing the hard-coded
enable; off returns hazards to the engine's own deterministic scheduler), and a
next-run difficulty forwarded through `reset{difficulty}`.

**Procedural audio (`ui/audio/`) — zero assets, zero deps.** Three parts: synth
helpers; an ambient bed (lowpassed-noise wind that gusts and rises with storms,
hazard rumbles, a possession hum, UFO dread); and a **pure** `map.ts` — the
event→cue table, snapshot-derived continuous state, and snapshot diffs for
place/demolish (the engine emits no demolish event) — so the whole mapping is
unit-testable without ever constructing an AudioContext. The singleton handles
gesture unlock (capture-phase listeners with resume retries, since Boot
auto-dismisses without a click), per-bus volumes, visibility suspend/resume, and
degrades to a permanent no-op when Web Audio is unavailable: the game must never
depend on sound.

**Run report + hints.** `ui/stores/history.ts` samples pools/population every 2
sim-seconds (capped with decimation so a full run always fits), tallies events
and hazards, and persists on the autosave tick. The EndScreen grows from bare
text into a run report: an epitaph derived from the outcome plus the last
critical resource/hazard, five sparklines (canvas 2D), tally and difficulty
chips, and **"WHAT THE PLANET HAS LEARNED"** — the Director's cross-run player
model (runs, wins, death axes/hazards, current opening bias) made legible at the
moment the player most wants to understand what killed them. Contextual hints
(`ui/hints.ts` + `HintToast.vue`) are one-shot, persisted, one-toast-at-a-time
tips for first-time situations (sealed-but-unconnected building, first brownout,
first trader, first UFO warning, first possession). HUD touches: a morale row in
`Crew.vue`, the piloted colonist's name + role in `PilotBar.vue`.

## 4. Council depth + Director legibility

**Idle banter — scripted-only by construction.** `Council.observeIdle()` plus an
optional `Voice.considerIdle?()`: fires only when the channel has been quiet
25–40 sim-seconds AND nothing is happening (no hazards, timers, UFO, or trade);
round-robin fairness with a long per-voice idle cooldown. The load-bearing rule:
**idle lines never mark the global cooldown**, so banter can never delay a real
event line — and the idle path cannot reach the live API at all.

**New event banks.** Scripted lines for morale_low/recovered,
colonist_injured/recovered, strike casualties (currently line-less), and
per-difficulty boot lines, with matching audio cues.

**Director attribution.** The store records when the Director fires a hazard; a
matching `hazard_warn` within 3 sim-seconds gets `directed: true` — a UI-side
annotation the engine never sets — gated to players with ≥2 runs and a 1-in-3
chance, so the reveal stays uncanny rather than mechanical. Watcher/Chronicler
gain attribution variants ("This storm did not come from the weather. Something
chose it."). Full transparency lives in the EndScreen dossier, not mid-run.

## 5. Vocabulary across the wall

`shared/types.ts` (stays plain data, structured-clone-safe):

- `type Difficulty = "easy" | "normal" | "hard"` (canonical values; the UI may
  *label* them CALM / STANDARD / BRUTAL).
- `type ColonistRole = "miner" | "engineer" | "botanist" | "medic"`.
- `ColonistView` += `name: string; role: ColonistRole; injury: number`.
- `Snapshot` += `morale: number; difficulty: Difficulty`.
- `ColonistAct` += `"toMedbay" | "recovering"`.
- `EventType` += `colonist_injured`, `colonist_recovered`, `morale_low`,
  `morale_recovered` (engine-emitted) and `idle` (agent-layer only, like
  `anomaly`).
- `ColonyEvent` += optional `id?: number` (colonist id payload) and
  `directed?: boolean` (UI-side annotation; the engine never sets it).

Protocol, the standard path: `{ type: "reset"; difficulty?: Difficulty }` in
`worker/protocol.ts` → handled in `worker/host.ts` → `bridge.reset(difficulty?)`.

Renderer contracts: `ThreeRenderer.setQuality(q: "low" | "high")` (built in the
graphics phase, consumed by settings); `kit/contract.ts` gains
`interface KitEnv { night: number }` as an optional third `setStatus` argument.

## 6. Determinism & save compatibility

- **Zero new RNG draws** (see the guiding principle): id-hash derivations, pure
  morale, strike-cell injuries, post-draw difficulty multipliers. A 600 s
  same-seed determinism pair guards each engine feature, and
  `Colony(seed) ≡ Colony(seed, "normal")` is itself a test.
- **`SaveData` stays `version: 1`** (`persistence/save.ts` rejects other
  versions). New state fields get graceful load defaults following the
  `envRngState` precedent in `Colony.load`: `difficulty ?? "normal"`,
  `morale ?? MORALE_START`, `moraleLatch ?? false`, per-colonist `injury ?? 0`.
  Old saves load as a Normal-difficulty, neutral-morale, uninjured colony.
- **One accepted ripple:** the two new techs grow `TECH_IDS`, which shifts the
  env-stream's tech-offer *index* draw versus old builds (which tech a given
  seed offers). The main hazard/arrival stream is untouched; the seed-scanning
  trade tests get re-verified.
- Testing idioms hold: rare events are tested by **state injection** (set the
  timer/sol so the event is due now), never by waiting; save/load round-trips
  include mid-injury; backward compat is tested by deleting the new fields from
  a serialized save and loading it; all new UI stores are node-env-safe
  (injectable storage; no AudioContext is ever constructed in tests).

## 7. Risks & mitigations

- **ACES shifts the established rust/cyan palette** → one exposure knob, a
  side-by-side screenshot gate at the postfx commit, and the low-quality path
  stays pixel-identical for rollback.
- **Morale death spiral** → production-only effect, hard floor 0.15, multiplier
  floor ≈ 0.81, calm upward drift, and the Harmonizer tech as a counter.
- **Banter starving real lines** → idle never touches the global cooldown, the
  quiet predicate, and fake-clock tests pin the behavior.
- **Env-stream timeline shift** from the two new techs → re-verify the
  seed-scanning trade tests.
- **Transparency sorting** (frosted domes + beams + devils + fog) →
  `depthWrite: false`, explicit `renderOrder`, `fog: false` on additive
  materials.
- **Autoplay policy blocks audio** → capture-phase gesture unlock with resume
  retries; silent no-op fallback.
- **Old saves** → graceful v1 field defaults (above); no version bump.

## 8. Out of scope (explicitly deferred)

Narrator model change (stays `claude-opus-4-8`), jobs/XP progression beyond role
affinity, per-colonist mood, multi-base/biome maps, mobile/touch layout, 3D name
labels above colonists, replay scrubber / photo mode.
