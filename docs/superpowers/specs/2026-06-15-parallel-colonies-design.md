# Parallel Colonies (Round 4) — design

- **Date:** 2026-06-15
- **Status:** design approved (brainstorm + multi-agent architecture exploration), pending spec review
- **Origin:** Round 4 roadmap — the next step past PTP planet-hopping (shipped `4e800eb`). Multiple settled worlds that progress while you're away, switchable as live grids, with inter-planet logistics.
- **Scope:** the **full** feature (not an MVP) — switcher + deterministic catch-up, world theming, rich off-screen progression, and inter-planet logistics (resources + crew). Built as verified slices, like PTP.

## Problem

The engine is already **instance-pure** — zero module-level mutable state across all 12 core engine files (verified by grep; the only module-scope bindings are `const` tuning primitives + frozen lookup arrays), and every `Colony` owns its own seeded `rng`/`envRng` (`colony.ts:48-50`). So **N `Colony` objects are already isolated and constructible today** — they're built on the main thread in tests already. The single-colony assumption lives *only* in `host.ts` (one `private colony`), `bridge.ts` (one `latest`), the store (one `snapshot` ref, one `activeSlot`), and the renderer (one scene).

PTP already shipped the persistence spine: slot-keyed `SaveData` (`persistence/{local,remote,index}.ts`), a Colonies ledger (`persistence/colonies.ts`, one `ColonyRecord` per world), and **`revisit(slotKey)`** — a proven *load-a-slot-and-resume-LIVE* primitive (`stores/colony.ts`). `revisit` is literally "make slot X the live colony," working end-to-end.

So **Round 4 is generalizing `revisit`, not rebuilding the worker.** The work is: a deterministic *catch-up* so away colonies advance, a switcher UI, world-aware rendering, an off-screen digest, and a determinism-safe logistics layer.

## Core architecture decision

**One live `Colony` at full fidelity; away colonies frozen on disk; on switch, fast-forward the target with a DETERMINISTIC bounded catch-up ("advance-to-now on load"), then load it live.**

- Rejected: **N free-running workers** — they reintroduce timing nondeterminism precisely at the inter-planet-transfer boundary (two loops accrue different `dt` sequences → "a shipment lands" becomes wall-clock-dependent). That's the single strongest argument against per-colony workers.
- Deferred: **genuinely simultaneous live grids** (one worker holding `N` ticked `Colony` instances). It's a later perf optimization that first needs `assign`-cache + `findPath`-pool + digest-snapshots (the per-tick hot passes multiply linearly with N). Catch-up still covers any colony not promoted to live.
- Chosen (**C**): the focused colony runs the real tick; away colonies cost **zero** CPU; catch-up is the *same engine* fed a deterministic fixed-`dt` schedule, so a Mars solo run is byte-identical and the 458-test suite stays green untouched.

## Design

### 1. The catch-up model (determinism-critical)

- **`savedAt` wall-clock** — a new per-world field on `SaveData` + the ledger row, stamped **main-side** (the engine forbids `Date.now`). The first concrete change; nothing real catches up without it.
- On switch, the store computes `elapsedReal = now − savedAt`, maps it **1:1 to sim-seconds** (as in live play), clamps to a **cap** (`CATCHUP_CAP_SOLS`, default ~3 sols — tunable; bounds a months-away return), and hands it to the engine as a **plain number** (never a clock).
- **`Colony.fastForward(budgetSeconds)`** (engine) — runs `tick(dt)` in fixed `≤MAX_DT` sub-steps summing to the budget, accumulating the emitted `ColonyEvent`s (for the digest). Same save + same budget → **byte-identical** result (same seeded RNG, deterministic dt schedule). Budget 0 = no-op, so Mars solo is unaffected.
- **Chunked across frames** — long catch-ups are sliced into per-frame work bursts in the host's step loop so they never block the loop or starve the live colony's snapshots; a `catchupProgress` outbound drives the curtain.
- **Away hazards** — during `fastForward`, the colony runs with `directorControlled = false` so the engine's seeded hazard scheduler presses it (the Director is a main-thread observer, absent from the fast-forward). On promotion to live, `directorControlled` is restored from the player's setting. So away colonies face the planet deterministically; the *Director* presses only the watched colony.

### 2. Worker / host changes

Stays **one live `Colony`** (no `Map<slot,Colony>`, no per-colony workers). New command:

- `switchColony{ slotKey, budgetSeconds }` — host: load the slot's `SaveData` (passed in by the store, which read it from persistence), run `fastForward(budgetSeconds)` (chunked), then resume live (lift the gate). Emits the accumulated catch-up events + a final snapshot. If catch-up ends with `outcome != null` (the colony died/won off-screen), the snapshot carries it and the UI surfaces its end-screen.
- The protocol gains no per-colony *address* (we stay one-live); `switchColony` carries the target `SaveData` the way `load` does.

### 3. The Colonies map / switcher (UI)

- A new in-game **Colonies map** panel (HUD button) listing every `ColonyRecord` — world, sols, souls, status, in-transit shipments — click a world to switch to it. Reuses the ledger-chip idiom (`StartScreen`/`EndScreen` already render revisit chips).
- **Ledger freshness:** the autosave loop now `upsertColony()`s the active colony's row (sols/population/`savedAt`) every interval, so the map shows current numbers instead of stale launch-time stamps (today they're stamped only at `launch()`/`foundNext()`).
- **Switch flow (store `switchTo(slotKey)`):** save the *leaving* colony first (await `bridge.save` → `persist` + `upsertColony` — fixes `revisit`'s up-to-12s loss); read the target's `SaveData` + compute the budget main-side; `bridge.switchColony{slot, budget}`; reset agent scratch (council/sentinel/director, lethal-axis, history) like `revisit` does — without clearing the loaded slot.

### 4. World theming (renderer world-aware)

- Today `render/three/terrain.ts` hardcodes Mars seeds (`mulberry(98213)`/`0x77aa`) + a rust palette; `scene.ts` sky/sun are time-of-day only; **nothing in `src/render` reads `snapshot.world`** (which already crosses the wall).
- Add per-world **visual fields** to `WORLDS` (`tuning.ts`): `terrainSeed`, `palette` (ground/rock/dust), `relief`, `sky`/`sun`/`ambient` tint. Make terrain **rebuildable on swap** and branch sky/sun/ambient on `snapshot.world`.
- Ceres reads icy/pale, Io volcanic/dark, Titan hazy-gold. **Pure observe-side — zero determinism implication.**

### 5. The curtain + quiet swap

- A brief **~0.5s fade curtain** ("jump to orbit → descend") masks the rebuild + first-render shader compiles; driven by the switch flow (cover up while `fastForward` + mesh rebuild run).
- **`renderer.swapWorld()`** — a fast-path that clears all mesh maps **without** the ~40-puff/~12-pop demolition FX the current load/reconcile path fires (wrong for a calm switch), and triggers the terrain rebuild. No warm-scene infra (that's the deferred instant-cut path).

### 6. Off-screen progression + "while you were away" digest

- The catch-up (§1) already runs real hazards/resupply/casualties. This makes it **legible**:
  - A main-side **before/after delta** over the catch-up (pre-snapshot vs post-snapshot) + the accumulated `ColonyEvent`s → a **"WHILE YOU WERE AWAY"** panel on arrival: sols elapsed, colonists lost/born, buildings lost/built, hazards weathered, resource swing.
  - **Dead-on-catch-up:** if `fastForward` ends with `outcome != null`, surface that colony's end-screen (victory/defeat for that world) and mark its ledger row's `outcome`; the player dismisses it (a dead world stays in the ledger as a tombstone, not auto-removed).

### 7. Inter-planet logistics (resources + crew)

Never let one colony reach into another — debit in a tick, hold main-side, credit as seed-state.

- **Dispatch (debit):** `dispatchShipment{ manifest }` Command applied in the *live* colony's tick — debits resources/materials (capacity-clamped, mirroring `respondTrade`'s pool debit); crew leave the roster (removed from `colonists`, `population` adjusted). Deterministic, in-tick.
- **In-flight queue:** main-thread state on the Colonies ledger — `Shipment { id, fromSlot, toSlot, manifest, dispatchedAtSol, transitSols }`. `manifest = { resources?: Partial<Record<Resource,number>>, materials?: number, crew?: number[] }`. **Not engine state** (it spans colonies). Transit in **sim-sols**.
- **Arrival (credit):** when the destination is loaded/caught-up, the store drains **matured** shipments (those whose `dispatchedAtSol + transitSols <= destination.sol`) into the destination's `SaveData` **before it resumes**, as seed-like state: resources clamped into pools; crew seeded at **rebased ids** (`colonistCounter = max(incoming, current) + 1`, the `seedColony` discipline — no id collisions / commander surprises). Drain is **idempotent + ordered** (sort by id) and the ledger/queue mutation is written **synchronously before** the async persist (the `launch()` orphan-avoidance pattern).
- **No new RNG** (fixed transit + manifest), like resupply and all of homeostasis.
- **UI:** a "send a shipment" action on the Colonies map (pick destination + manifest); in-transit shipments shown on the map with their ETA in sols.

## Determinism & the wall (non-negotiables)

- **Elapsed time is computed main-side** and handed in as a plain number; the engine never reads a clock (it already forbids `Date.now`).
- **Catch-up is a bounded fixed-`dt` loop**, never one giant `tick` (`MAX_DT` + sub-tick timers — grace, brownout, scheduler gaps — forbid it). Same save + same budget → byte-identical.
- **No abstract away-model** — away colonies advance by the *real* tick only (an approximation that skips RNG draws can't byte-match and would break resume/reconcile).
- **No new RNG anywhere** in v1; if ever needed, draw from a separate env-style salted stream (the `0x9e3779b9` pattern), never the live hazard stream.
- **Each colony is an island** — no cross-colony reach-in. Logistics debits in A's tick, holds main-side, credits B as seed-state on load. Never a live cross-state write.
- **Mars/`DEFAULT_SEED` stays byte-identical** — `fastForward(0)` is a no-op, a solo run never switches, and theming is observe-side. The 458-test suite must stay green.

## Files touched (by area)

**Engine (determinism-guarded):**
- `shared/types.ts` — `savedAt` on the save vocabulary; `Shipment`/`ShipmentManifest`; per-world visual fields on the `World` profile contract.
- `src/engine/colony.ts` — `fastForward(budget)`; apply credited shipments as seed-state on load; `dispatchShipment` debit.
- `src/engine/state.ts` — `savedAt` on `ColonyState`/`SaveData`.
- `src/engine/tuning.ts` — per-world visual fields on `WORLDS`; `CATCHUP_CAP_SOLS`.

**Worker (the wall):**
- `src/worker/protocol.ts` — `switchColony`, `dispatchShipment` Commands; `catchupProgress` Outbound.
- `src/worker/host.ts` — `switchColony` (load + chunked `fastForward` + resume); `dispatchShipment`.
- `src/worker/bridge.ts` — senders + the `catchupProgress` stream.

**Persistence:**
- `src/persistence/colonies.ts` — `savedAt` on `ColonyRecord`; the `Shipment` queue (add/drain/list); helpers.

**UI / render:**
- `src/ui/stores/colony.ts` — `switchTo(slotKey)`, the catch-up budget math, ledger-freshness autosave, the digest delta, shipment dispatch/credit orchestration, the curtain trigger.
- `src/ui/components/ColoniesMap.vue` — **new**, the switcher + shipment UI.
- `src/ui/components/AwayDigest.vue` — **new**, the "while you were away" panel.
- `src/render/renderer.ts` — `swapWorld()`; world-aware reconcile.
- `src/render/three/terrain.ts`, `scene.ts` — per-world terrain/sky/sun/palette.
- `src/ui/components/Curtain.vue` (or App.vue overlay) — the switch fade.

## Testing

- **Engine determinism stays green** — Mars/`DEFAULT_SEED` untouched; full suite after every engine change.
- **`fastForward`:** **reproducible** — two identical colonies fast-forwarded by the same budget B produce byte-identical snapshots (it replays a *fixed* `≤MAX_DT` sub-step schedule, so same save + same budget → same result; it does NOT need to match a variable-`dt` live run). `fastForward(0)` is a no-op; a long budget stays a bounded loop; an away colony can deterministically die during catch-up (same save+budget → same death).
- **Catch-up away-hazards:** `directorControlled=false` during fastForward; the engine scheduler fires; restored on resume.
- **Logistics:** `dispatchShipment` debits the live colony deterministically; the queue drains matured shipments exactly-once, ordered; credit clamps resources to capacity and seeds crew at rebased ids (no id collision, no commander displacement); transit measured in sim-sols; zero rng.
- **Persistence:** `savedAt` round-trips; the shipment queue round-trips; ledger freshness.
- **Playwright (`window.__viv`):** settle 2+ worlds → open the Colonies map → switch → catch-up runs behind the curtain → the target renders as its own planet → the "while you were away" digest shows the delta; dispatch a shipment → switch to the destination → it arrives credited.

## Build order (verified slices)

1. **`savedAt` + `Colony.fastForward(budget)`** + the catch-up determinism tests (the core; engine only).
2. **`switchColony` command + store `switchTo` flow** (save→load→catch-up→resume) + ledger-freshness autosave.
3. **Colonies-map switcher UI** (the ledger-driven panel + switch action).
4. **World theming** (renderer world-aware + `WORLDS` visual fields + terrain rebuild on swap).
5. **Curtain + quiet `swapWorld()`** (mask the rebuild; suppress the FX storm).
6. **Off-screen progression**: away-scheduler handling + the "while you were away" digest + dead-on-catch-up end-screen + ledger tombstone.
7. **Inter-planet logistics**: `dispatchShipment` debit + the ledger shipment queue + credit-on-switch (resources, then crew at rebased ids) + the shipment UI.

## Open questions / toggles

1. **Catch-up cap** — `CATCHUP_CAP_SOLS` default ~3 sols (a long absence advances at most this much per visit). Default: 3, tunable; revisit during balance.
2. **Switch transition flavor** — the curtain as a literal "to orbit / descend" beat vs a plain fade. Default: a simple fade with a sky-darken; thematic polish later.
3. **Crew transfer in v1** — included (rebased ids handle the collision risk). If it proves fiddly, resources-only ships first and crew follows in the same sub-project.
4. **Director off-screen** — away colonies face the *engine scheduler* only (the Director presses the watched colony). Default as designed; revisit if off-screen colonies feel too safe/harsh.
