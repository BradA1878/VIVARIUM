# PTP — Planetary Transport Pod (planet-hopping) — design

- **Date:** 2026-06-14
- **Status:** design approved (brainstorm + multi-agent code exploration), pending spec review
- **Origin:** Round 3 roadmap — an Animal-Crossing-inspired endgame. Build the PTP planet-hopping legacy as the **foundation for Round 4 (parallel colonies)**.
- **Sequencing:** lands after the homeostasis / difficulty-start-screen / water-tier work already merged. Touches `protocol`/`host`/`colony`/`tuning`/persistence/store — built in **verified vertical slices** (see Build order) so the tree is green at every commit.

## Problem

The roadmap's central premise — "the slot backend already supports named slots" — is **only half true**, and that gap *is* the feature:

- The engine already does the hard part. A settled world's save is a complete `SaveData = { version, seed, rngState, envRngState, state }` (`state.ts:261-269`) where `state` is the entire `ColonyState` incl. terrain/vents/aquifers (`state.ts:135-259`). `Colony.serialize()` captures both RNG stream states (`colony.ts:303-339`); `Colony.load()` restores them byte-for-byte (`colony.ts:342-416`). So **"persist a world, revisit it later" works at the engine layer today with zero engine changes.**
- The difficulty system is a precise, working template for "world profiles": a typed profile keyed in a `Record` → start-screen card → one Command → `Colony.reset` bakes scalars + `state` stores the key for live re-derivation (`tuning.ts:302-326`, `colony.ts:46,74`, `protocol.ts:26-35`, `host.ts:46-49`).
- **But:** the Mongo server *is* slot-keyed (`server/routes/save.ts:11-51` reads `body.slot`, upserts one doc per `{slot}`), while **both client adapters are single-slot** — `local.ts:9` uses one fixed `KEY = 'vivarium:save:v1'`; `remote.ts:9` hardcodes `SLOT = 'default'` — and `loadBest`/`persist` take no slot arg (`persistence/index.ts:11-21`). Worse, `tearDownRun` calls `clearLocal()` on every new run (`stores/colony.ts:197`) — **actively hostile** to slot-per-world.
- Every run is also literally the **same map**: `DEFAULT_SEED = 0x5eed1234` is the only seed ever used (`tuning.ts:95`), and `start`/`reset` carry only `difficulty?` — there is **no channel** to hand the worker a new seed or world.

So the work is three things the engine can't help with: **(1)** a multi-slot client persistence layer + a Colonies ledger; **(2)** a founding channel so launching carries `{ seed, world, legacy }`; **(3)** a `WorldProfile` that is a strict superset of difficulty (most world-feel levers are hardcoded module constants that must be extracted — pure once extracted, but real engine edits).

## Goal

Past the reactor, the colony can build a **PTP**. Launching it is a deliberate, run-ending **"Expansion"**: the current world archives to its own **save slot**, a cross-run **Colonies ledger** records it, and the player picks the **next world** (Ceres / Io / Titan) to found a fresh run on — carrying a couple of **veteran colonists** and one **alien tech**. Settled worlds are **revisitable** from the StartScreen (load their slot, resume live). Worlds differ only by **numbers on the unchanged engine**.

## Non-goals (these are Round 4)

- **Ticking-while-away** — worlds you leave are **frozen**; revisiting resumes exactly where you left.
- Switchable **live parallel grids**, inter-planet logistics, a shared economy.
- **Per-world Director memory** — `director/memory.ts` stays a single global model for v1.
- No new *engine mechanics* — no new buildings beyond the PTP, no new resources. Worlds are profiles, not new systems.

## Design

### The four worlds (character → levers)

World is an axis **orthogonal to Difficulty** — pick both; profiles compose (difficulty is a uniform post-draw scaler, world is an environment selector). v1 ships four profiles; **Mars is the anchor whose profile is the identity of today's constants** (the determinism baseline — see below).

- **Mars** — base / origin. Profile == today's behaviour exactly. Balanced sun/wind/dust.
- **Ceres** — ice-rich, weak sun, no dust storms. Water is abundant; **power is the squeeze**. Hazard mix drops dust; keeps cold-snap/flare.
- **Io** — geothermal-rich, quake-heavy. Vents plentiful (flat free power) but **frequent quakes** damage buildings; ore-heavy, ice-poor deposits.
- **Titan** — no solar at all, strong steady wind. **Wind is the lifeline**; solar buildings near-dead weight; storm-driven.

Levers each world pulls: solar amplitude / day-night (`tick.ts:~91`), wind curve (`wind.ts`), geothermal vent density (env-seeder), deposit mix ice/ore/cache (`deposits.ts` ratio literals), hazard-weight mix (`hazards.ts` `HAZARD_META`), start pools/caps. **Character + which levers** are specified here; **exact constants are a balance-tuning pass during implementation**, tuned against fixed Mars.

### `WorldProfile` (mirrors `DifficultyProfile`)

A typed `WorldProfile` keyed in a `WORLDS: Record<World, WorldProfile>` in `tuning.ts`, shaped exactly like `DIFFICULTY` (tolerant lookup defaulting to Mars/base). Fields are a **strict superset** of difficulty: `solar` scalar, `wind` curve params, `geothermal`/vent density, `deposit` ratios, a **hazard-weight table**, `startPools`. `World` is added to `shared/types.ts` (the neutral cross-wall vocabulary). It threads the **same pipeline difficulty already uses**: founding Command → `host` → `Colony.reset` → `freshState` bakes scalars + stores `world` on `ColonyState` (serializes for free).

The load-bearing discipline carries over verbatim: **world multipliers apply *after* RNG draws** so draw count/order is preserved (mirrors `hazards.ts:62,88`).

### Multi-slot client persistence + the Colonies ledger (the real work)

- **Multi-slot client.** Thread a `slotKey: string` through `persistence/index.ts` (`loadBest(slot)`/`persist(slot, data)`), `local.ts` (namespace → `vivarium:save:v1:<slot>`), `remote.ts` (pass `slot` instead of the hardcoded `'default'` — server already supports it). Add **list + delete**: a new server endpoint (`GET /api/saves` list, `DELETE /api/save?slot=`) and a localStorage key-index helper. `save.ts` `SaveJSON` encode/decode is unchanged.
- **Slot-scope the hostile bits.** `tearDownRun`'s unconditional `clearLocal()` (`stores/colony.ts:197`) and the 12s autosave loop (`stores/colony.ts:406-410`) become **slot-scoped to the active world** — founding a new world must not clobber the one just settled. *This is slice 1 and retires the main risk first.*
- **Colonies ledger** = a **new main-thread store modeled on `director/memory.ts`** (its own key `vivarium:colonies:v1`, normalize-with-defaults under try/catch, module singleton via `useColonies()`, storage-injectable, Node-safe). **Plain JSON, never a `SaveData` / engine state.** One row per founded world:
  ```ts
  type ColonyRecord = {
    worldId: World; slotKey: string; seed: number; difficulty: Difficulty;
    label: string; outcome: Outcome; sols: number; population: number;
    foundedAt: number; endedAt?: number; legacyManifest?: LegacyManifest;
  }
  ```
  Appended/updated at the existing victory/defeat hook (`colony.ts:~321` memory write; mirrored in the store) where all of this is already in hand. Timestamps are stamped **main-thread only** (engine forbids `Date.now`).

### The founding channel + next-world seed

A founding payload carries `{ seed, world, legacy, difficulty }`. **All chosen on the main thread** (the store) and passed as deterministic inputs — the engine never originates them (no `Math.random`/`Date.now` past the wall). The next-world **seed is derived**: `nextSeed = new RNG(priorSeed ^ WORLD_SALT).u32()`, reusing the sanctioned terrain-backfill idiom (`colony.ts:407-410`, a derived RNG that never touches the live stream), and **stored in the ledger row** so the campaign is reproducible and a revisit loads the exact terrain. The `Colony` constructor + `reset` already honour `(seed, difficulty)` (`colony.ts:46,74-80`); only the pinned `DEFAULT_SEED` call sites need to accept the passed seed.

### PTP building + launch + the `expansion` outcome

- **PTP building**: one `defs.ts` entry + one `ORDER` entry + one pure `GATES` predicate (e.g. has-reactor + high pop/materials), mirroring the reactor exactly (`unlocks.ts:18-36`). The `unlocks.test.ts` contract (no-rng / never-revoke / announce-once / legacy re-derive / save round-trip) is copied for the new gate.
- **Launch** is a **player Command** `launchPtp` handled in `host.ts` — *not* an auto-threshold (that would put "decide to launch" inside the pure engine and steal player agency). It widens `Outcome` to add `'expansion'`, sets it, pauses, emits an event — mirroring the existing victory block.
- **Archive-then-hand-off.** On launch the store writes the **leaving world's living snapshot to its slot with the terminal outcome cleared** (so revisiting resumes a still-playable colony), while the *session* ends with `outcome='expansion'` for the end-screen. Note the boot guard discards finished saves (`stores/colony.ts:357`), so the slot/ledger must capture the world **before** that discard — the cleared-outcome archive handles this.
- **Expansion EndScreen variant.** `EndScreen.vue` already owns the cross-run dossier (`:134-161`) and the "next run" picker; `replay()` (`:175`) is the action replaced. The Expansion variant shows the **world picker** (difficulty-card idiom, numbers pulled live from `WORLDS` so copy never drifts) + a **carried-legacy preview**; its action founds the next run via the founding channel.

### Carried legacy

`legacy?: { veterans: number[]; tech?: string }` on the founding payload, applied inside `seedColony` as **plain state, zero RNG**:
- **Veterans by literal id.** Colonist identity *is* the integer id — `roleOf(id) = ROLES[id%4]`, `nameOf(id)` hashes id (zero stored fields, zero RNG, `roster.ts`). Seeding a veteran at a fixed id reproduces their exact name **and** role. A veteran seeded at id 1 becomes the new commander (commander = lowest living id, `lead.ts`) with no command change. Carry the launching commander + 1.
- **One alien tech.** `acquiredTech` is a `string[]` summed live into `recomputeCaps` (`techs.ts:75-122`, `caps.ts`); `seedColony` already calls `recomputeCaps` (`colony.ts:238`). Carrying one tech = pushing one string before that call. Idempotent, zero new code, zero RNG.
- **Hard determinism rule:** after seeding veterans at fixed ids, set `colonistCounter = max(carriedId)+1` before any post-seed mint, or a later arrival/rover/robot mints a duplicate id and corrupts `possess`/UFO-targeting/succession. `seedColony` hardcodes population=4 / ids 1-4 today — veteran injection reconciles by overriding those ids.
- **Accepted tradeoff:** id fixes *both* name and role; you can't carry one independently. Surfaced, not hidden.

### Revisit

The StartScreen gains a **Colonies list** (the ledger) → selecting a world calls the existing `load` path with that world's `slotKey`, resuming the colony live (zero engine work — `Colony.load` already does it). Worlds you're away from are **frozen** (v1 boundary; off-screen progression is Round 4).

## Determinism & the wall (non-negotiables)

- **Mars profile == today's constants.** The default path stays Mars/`DEFAULT_SEED`, so every existing determinism/replay/save test stays byte-identical. New worlds get their own tests; cross-world replay parity is **not** promised (a world that disables a hazard alters its own draw set — fine per-slot).
- **World hazard variation via post-draw remap** — draw one uniform, map through the world's weight table; never change the *number/order* of main-stream draws.
- **World terrain variation rides the separate `envRng` only** (deposits/vents/aquifers already draw on `envRng = RNG(seed ^ 0x9e3779b9)`, `colony.ts:49`); changing seeding *inputs* (ratios/counts) keeps the same draw count. Never insert a new draw into the main stream for world flavour.
- **Seed + legacy enter via the founding payload**, applied as plain state in `seedColony`/`freshState` with no RNG — never live mutation. Seed generation happens **main-thread**, passed in as a deterministic input.
- **Ledger is meta state outside the wall** (like `director/memory.ts`): main-thread JSON, timestamps stamped main-thread, never read inside the tick.
- Every world-lever **extraction** (solar/wind/deposit/hazard constants → profile fields) is treated as a determinism-sensitive change: keep "base world == today" and re-run `npm test`, not a cosmetic swap.

## Files touched

**Shared / engine (determinism-sensitive — guarded):**
- `shared/types.ts` — `World` type; `Outcome` gains `'expansion'`; founding payload + `LegacyManifest` vocabulary.
- `src/engine/tuning.ts` — `WORLDS` record + `WorldProfile`; `WORLD_SALT`.
- `src/engine/state.ts` — `world` on `ColonyState` (+ legacy-backfill default = Mars).
- `src/engine/colony.ts` — `reset`/constructor accept `seed`+`world`; `freshState`/`seedColony` bake world levers + carried legacy; `colonistCounter` reconciliation.
- `src/engine/defs.ts` + `src/engine/unlocks.ts` — PTP building def + `ORDER` + `GATES` predicate.
- lever extraction sites: `src/engine/tick.ts` (solar), `src/engine/wind.ts`, `src/engine/deposits.ts`, `src/engine/hazards.ts` (post-draw world remap).

**Worker (the wall):**
- `src/worker/protocol.ts` — founding payload `{ seed?, world?, legacy? }` on `start`/`reset`; new `launchPtp` Command.
- `src/worker/host.ts` — handle `launchPtp` (set `expansion`, pause, emit); thread seed/world/legacy into `reset`.
- `src/worker/bridge.ts` — senders for the new/extended commands.

**Persistence (the real work):**
- `src/persistence/index.ts`, `local.ts`, `remote.ts` — `slotKey` everywhere; list + delete.
- `server/routes/save.ts` — list + delete endpoints (save/load already slot-aware).
- `src/persistence/colonies.ts` — **new** ledger store (modeled on `director/memory.ts`).

**UI (main thread):**
- `src/ui/stores/colony.ts` — slot-scoped autosave/teardown; founding orchestration (derive seed, build legacy manifest, write ledger, archive-then-hand-off); `launch()` action.
- `src/ui/components/EndScreen.vue` — Expansion variant: world picker + legacy preview.
- `src/ui/components/StartScreen.vue` — Colonies list (revisit).

## Testing

- **Engine determinism stays green** — Mars/`DEFAULT_SEED` path untouched; run the full suite after every lever extraction.
- **New engine tests:** `WorldProfile` applies levers via post-draw remap (draw count/order preserved); a non-default seed yields different terrain and round-trips through save/load byte-identically; carried legacy seeds veterans at fixed ids + bumps `colonistCounter` (no duplicate-id mint); the PTP gate honours the `unlocks.test.ts` contract.
- **Persistence tests:** multi-slot round-trip (save A, found B, A's slot survives and reloads identical); list/delete; the local/remote slot namespacing; ledger normalize-with-defaults + Node-safe.
- **Host test:** `launchPtp` sets `outcome='expansion'`, pauses, emits; founding `reset{seed,world,legacy}` carries all three.
- **Playwright (`window.__viv`):** settle a world → build PTP (gate opens) → launch → Expansion screen → pick Ceres → land with the veteran as commander + the tech's effect at sol 0; reload → StartScreen Colonies list shows both worlds; revisit world A → resumes live.

## Build order (verified vertical slices)

1. **Multi-slot client persistence + slot-scoped teardown/autosave.** Thread `slotKey` through `index/local/remote`; add list+delete; make `tearDownRun`/autosave slot-scoped. Playwright: settle A, found B, A survives & reloads identical. *Retires the main risk; unblocks everything.*
2. **Colonies ledger store** (`colonies.ts`, copy `director/memory.ts` shape) + read-only render in EndScreen.
3. **Seed + world channel across the wall** (no new content). Add `seed?`/`world?` to founding; thread to `reset`/constructor. Prove a non-default seed → different terrain → byte-identical round-trip.
4. **`expansion` outcome + `launchPtp` Command + PTP building + Expansion EndScreen** (still onto Mars). Vertical slice ends a run by launching.
5. **Carried legacy** (veterans + one tech) applied in `seedColony`; manifest captured from the launching snapshot.
6. **The three `WorldProfile`s + lever extraction + launch-time world picker** (the content payoff). Keep Mars == today; suite stays green.
7. **Revisit list on the StartScreen** (pure reuse of `load`).

## Open questions / toggles

1. **PTP gate predicate** — has-reactor + a pop/materials threshold (default), vs. a dedicated late-game milestone. Default: mirror the reactor's gate shape; tune the threshold in balance.
2. **How many veterans** — commander + 1 (default) vs. a larger cohort. Default: 2, to keep the new world's early game intact.
3. **Ledger delete** — let the player abandon/delete a settled world's slot from the Colonies list (needs the new server delete endpoint either way). Default: yes, with confirm.
4. **World picker copy** — qualitative ("weak sun, ice-rich, no dust") with a couple of concrete anchors, mirroring the difficulty cards. Default: qualitative + anchors, numbers pulled live from `WORLDS`.
