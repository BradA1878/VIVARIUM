# Design — The Evil UFO + Colonist Births

_2026-06-09_

Two new ambient life events for VIVARIUM, both living entirely behind the engine
determinism wall (doc §0):

1. **An evil UFO** that rarely appears and **abducts a colonist** (permanent loss).
2. **Colonist births** — the colony rarely **grows from within** when it's thriving.

## Decisions (from brainstorming)

- **Abductee fate:** gone for good (permanent `population -= 1`).
- **Counterplay:** yes — a **deterrent building _and_ a tech that strengthens it**.
- **Birth trigger:** "thriving + room" — surplus + spare housing + a population floor.

## Guiding principle — autonomous, no new commands

Both are **autonomous engine events**: the UFO arrives/abducts on its own; births
happen on their own. No new `Command` is needed. The deterrent **building** uses
the existing `place` command (it's just a new `BuildingDef`); the strengthening
**tech** is acquired through the existing trader system (a new `TechDef`). The only
cross-wall additions are new `ColonyEvent` types and a `ufo` field on `Snapshot`.

## 1. The Evil UFO (`engine/ufo.ts`, new — modeled on `trade.ts`)

A rare hostile visitor with a 3-phase lifecycle (sibling of the alien trader):

- **Phases:** `inbound` (telegraph, descends) → `hovering` (beam locks a colonist)
  → `leaving` (ascends, gone).
- **Victim:** on `inbound` it picks one **non-possessed** colonist (never yanks the
  player's controlled colonist) and locks `targetId`; the UFO tracks that colonist
  so the beam follows its victim.
- **Abduction beat** (`hovering → leaving`): roll against the colony's shield.
  - Foiled → emit `abduction_blocked`; the UFO leaves empty-handed.
  - Success → remove that colonist, `population -= 1`, emit `abducted`.
- **Safety floors (tunable):** no appearance before **sol `UFO_MIN_SOL` (3)**; no
  abduction when **`population < UFO_MIN_POP` (3)** so a rare event can never
  directly end the game; skips if no valid (non-possessed) target exists.
- **Cadence (tunable):** first eligible ~`UFO_FIRST` (240s), then a long random
  gap `UFO_GAP_MIN..+SPAN` (~240–440s); failed eligibility retries in `UFO_RETRY`.

**Determinism:** the UFO runs on the existing **`envRng`** (the separate stream
that drives deposits + traders), leaving the main hazard/arrival sequence
byte-identical. The abduction's consequence (population drop) is real and
reproducible. If the locked victim vanishes mid-sequence, the UFO aborts to
`leaving`.

## 2. The deterrent — building + tech

- **`deflector` building** (`defs.ts`): 1×1, non-pressurized pylon. `matCost ~30`,
  draws `~3.5 power/s`, **no staffing**, **low-ish priority (~35)** so a brownout
  sheds it _before_ life-support — let power slip and your shield drops. A meteor
  can also destroy it. The coupling to the existing power/hazard systems is the
  point.
- **`aegis` tech** (`techs.ts`): a permanent alien-tech upgrade bought from traders
  with materials. It **strengthens each deflector** rather than standing alone.
- **Shield math** (in `ufo.ts`): each _online + functional_ deflector blocks
  `DEFLECTOR_BLOCK` (0.5), raised by aegis (`+DEFLECTOR_AEGIS_BOOST` 0.3 → 0.8).
  Multiple stack with diminishing returns: `pBlock = 1 − Π(1 − perDeflector)`. No
  deflector → no protection.

## 3. Births (`tick.ts`, a small pass beside Arrivals)

A "thriving + room" growth event, sibling of Earth arrivals but on its own rarer,
**uncapped** timer:

- Fires only when: net **surplus** on O₂/water/food (reuses the computed `net`),
  spare **housing** (`population+1 ≤ housing`), **`population ≥ BIRTH_MIN_POP` (4)**,
  and **no active life-support crisis** (all grace timers null).
- Effect: `population += 1` (a single colonist), emit `birth`. The roster
  auto-reconciles, so a new astronaut appears at the hub. Counts toward `targetPop`
  victory naturally.
- **Cadence (tunable):** first eligible ~`BIRTH_FIRST` (180s), then
  `BIRTH_GAP_MIN..+SPAN` (~240–440s) between births; failed checks retry in
  `BIRTH_RETRY`. Runs on the **main RNG** (consistent with arrivals).

## 4. Vocabulary across the wall (`shared/types.ts`)

- New `UfoPhase` + `UfoView` (mirrors `TradeView`); `ufo: UfoView | null` on
  `Snapshot`.
- New `EventType`s: `ufo_inbound`, `abducted`, `abduction_blocked`, `ufo_left`,
  `birth`.

## 5. Rendering (`render/three/ufo.ts`, new — adapted from `alienship.ts`)

A menacing crimson variant of the saucer (vs. the trader's teal/purple) with a
stronger abduction beam. The renderer syncs it from `snap.ufo` exactly like it
syncs the trader from `snap.trade`: create on first appearance, animate by phase
over the victim's interpolated position, dispose when null.

## 6. Narration & UI

- `lines.ts`: **required** `SEV` entries for all 5 new events (SEV is a _total_
  `Record<EventType, number>`); plus scripted `LINES` banks so the Council reacts
  (dread on `ufo_inbound`, grief on `abducted`, grim relief on `abduction_blocked`,
  quiet wonder on `birth`).
- `Alerts.vue` (optional): a transient "⚠ UFO inbound" alert during the telegraph.

## 7. Files

**New:** `engine/ufo.ts`, `render/three/ufo.ts`, `engine/ufo.test.ts`.
**Modified:** `shared/types.ts`, `engine/state.ts`, `engine/tuning.ts`,
`engine/defs.ts`, `engine/techs.ts`, `engine/tick.ts`, `engine/colony.ts`
(snapshot + serialize/load + fresh-state), `render/renderer.ts`, `agent/lines.ts`,
optionally `ui/components/Alerts.vue`.

## 8. Determinism & testing

- New tuning timers are all > 120s so existing short tests are unperturbed; the
  long determinism test (600s) stays reproducible (both RNGs seeded; `ufo` added to
  `serialize()`/`load()`).
- `engine/ufo.test.ts`: shield math (0 with no deflector; rises with an online
  deflector; higher with aegis; 0 when the deflector is offline); abduction reduces
  population deterministically; a powered deflector lowers the abduction rate;
  same-seed runs match; save/load mid-UFO resumes bit-identically.
- Births: a thriving colony grows; births stop when housing is full or a shortfall
  is active; deterministic.
