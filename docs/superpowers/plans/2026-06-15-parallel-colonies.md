# Parallel Colonies (Round 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Multiple settled worlds that progress while you're away, switchable as live grids behind a cinematic curtain, each rendered as its own planet, with deterministic off-screen catch-up, a "while you were away" digest, and inter-planet logistics (resources + crew).

**Architecture:** One live `Colony` at full fidelity; away colonies frozen on disk at zero cost. On switch, the store computes elapsed real-time **main-side**, hands it to the engine as a `dt` budget, and `Colony.fastForward(budget)` replays the **real tick** in fixed `≤MAX_DT` sub-steps (reproducible, determinism-suite-safe). Logistics never reach across colonies: debit in the live tick, hold the in-flight payload in main-thread ledger state, credit the destination as seed-like state on load.

**Tech Stack:** Vite + Vue 3 + TS, Web-Worker sim, Hono + Mongo, Vitest (node env), Playwright via `window.__viv`.

**Design source of truth:** `docs/superpowers/specs/2026-06-15-parallel-colonies-design.md`. Read its "Determinism & the wall" before touching any `src/engine/` file. This generalizes the shipped PTP slot/ledger/`revisit` layer — read `src/ui/stores/colony.ts` (`revisit`/`foundNext`/`launch`), `src/persistence/colonies.ts`, `src/persistence/index.ts` first.

**Conventions to match (already in the codebase):**
- Engine purity: deterministic, seeded RNG only, NO `Date.now`/`Math.random`/`await`; the Mars/`DEFAULT_SEED` path is byte-identical, guarded by the 458-test suite. Two RNG streams (`rng`, `envRng` salted `0x9e3779b9`).
- Cross-colony payload as **seed state**: `LegacyManifest` + `seedColony` (`colony.ts`) apply veterans/tech at founding, never a live mutation, rebasing `colonistCounter`. Inter-planet credit follows this exactly.
- Orphan-avoidance: write the ledger/queue mutation **synchronously before** the async `persist` (`launch()` in `stores/colony.ts`).
- Storage-injectable, node-safe stores: `persistence/colonies.ts`, `stores/settings.ts`.

---

## Execution model (ultracode)

Slices are sequential (each builds on the last; shared files — `protocol.ts`/`host.ts`/`colony.ts`/`stores/colony.ts` — forbid a parallel fleet). Per slice: implement TDD → **adversarial verification workflow** (determinism + correctness) → fix → commit. Slice 4 (world theming, 3 worlds) can fan out authoring once the visual-field shape lands. `npm run typecheck && npm test` green before every commit; **Mars byte-identical** through every engine change.

## File structure

**New files**
- `src/engine/catchup.test.ts` — `fastForward` reproducibility/no-op/death tests. [slice 1]
- `src/ui/components/ColoniesMap.vue` — the switcher + shipment UI. [slice 3/7]
- `src/ui/components/AwayDigest.vue` — the "while you were away" panel. [slice 6]
- `src/render/three/worldlook.ts` *(or fields in `tuning.ts`)* — per-world visual params. [slice 4]

**Modified — engine (determinism-guarded)**
- `src/engine/colony.ts` — `fastForward(budget, collect?)`; apply credited shipments as seed-state in `load`/founding; `dispatchShipment` debit.
- `src/engine/tuning.ts` — `CATCHUP_STEP`, `CATCHUP_CAP_SOLS`; per-world visual fields on `WORLDS`.
- `shared/types.ts` — `Shipment`/`ShipmentManifest`; visual-field contract.

**Modified — worker (the wall)**
- `src/worker/protocol.ts` — `switchColony{slotKey,budgetSeconds}` carrying target `SaveData`; `dispatchShipment{manifest}`; `catchupProgress` Outbound.
- `src/worker/host.ts` — `switchColony` (load + chunked `fastForward` + resume); `dispatchShipment`.
- `src/worker/bridge.ts` — senders + `catchupProgress` stream.

**Modified — persistence**
- `src/persistence/colonies.ts` — `savedAt` on `ColonyRecord`; the `Shipment` queue (add/drain/list); the `directorControlled`-off-during-catch-up note.

**Modified — UI / render**
- `src/ui/stores/colony.ts` — `switchTo(slotKey)`; catch-up budget math; ledger-freshness autosave; digest delta; shipment dispatch/credit orchestration; curtain trigger.
- `src/render/renderer.ts` — `swapWorld()`; world-aware reconcile.
- `src/render/three/terrain.ts`, `scene.ts` — per-world terrain/sky/sun/palette.
- `src/ui/App.vue` — mount `ColoniesMap`, `AwayDigest`, the curtain overlay.

---

## Slice 1 — `Colony.fastForward` (the deterministic catch-up core)

**Why first:** the determinism-critical heart. Pure engine; nothing renders or switches yet. Reproducibility + Mars-byte-identical are the whole game here.

### Task 1.1: `CATCHUP_STEP` constant

**Files:** Modify `src/engine/tuning.ts` (near `MAX_DT`/`SOL_LENGTH`).

- [ ] **Step 1:** Add the fixed sub-step size (matches the live loop's `MAX_DT` clamp so catch-up steps look like maximal live ticks):

```ts
/** the fixed sub-step the catch-up (Colony.fastForward) replays — a fixed schedule
 *  is what makes fast-forward reproducible. Matches the live loop's MAX_DT clamp. */
export const CATCHUP_STEP = 0.1;
```

- [ ] **Step 2:** `npm run typecheck` (no consumers yet) → clean.

### Task 1.2: `Colony.fastForward(budgetSeconds, collect?)`

**Files:** Modify `src/engine/colony.ts`; Test `src/engine/catchup.test.ts` (create).

- [ ] **Step 1: Write the failing test**

```ts
// src/engine/catchup.test.ts
import { describe, it, expect } from "vitest";
import { Colony } from "./index";
import { SOL_LENGTH } from "./tuning";

describe("fastForward (catch-up)", () => {
  it("fastForward(0) is a no-op", () => {
    const a = new Colony(7);
    const before = a.snapshot();
    a.fastForward(0);
    expect(a.snapshot()).toEqual(before);
  });

  it("is reproducible — same seed + budget → byte-identical", () => {
    const a = new Colony(7), b = new Colony(7);
    a.fastForward(SOL_LENGTH * 3);
    b.fastForward(SOL_LENGTH * 3);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it("advances sim time by roughly the budget", () => {
    const a = new Colony(7);
    const sol0 = a.snapshot().sol;
    a.fastForward(SOL_LENGTH * 2);
    expect(a.snapshot().sol).toBeGreaterThan(sol0);
  });

  it("an unattended colony deterministically dies during a long catch-up", () => {
    const a = new Colony(7), b = new Colony(7);
    const ea = a.fastForward(SOL_LENGTH * 30, true); // collect events
    const eb = b.fastForward(SOL_LENGTH * 30, true);
    expect(a.snapshot().outcome).toBe("defeat"); // unattended colony reliably loses
    expect(b.snapshot().outcome).toBe(a.snapshot().outcome);
    expect(a.snapshot().sol).toBe(b.snapshot().sol); // same death sol
    expect(eb.map((e) => e.type)).toEqual(ea.map((e) => e.type)); // identical event stream
  });

  it("stops once the run ends — further catch-up is a no-op", () => {
    const a = new Colony(7);
    a.fastForward(SOL_LENGTH * 30); // dies
    const dead = a.snapshot();
    a.fastForward(SOL_LENGTH * 10);
    expect(a.snapshot()).toEqual(dead);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`npx vitest run src/engine/catchup.test.ts`) — `a.fastForward is not a function`.

- [ ] **Step 3: Implement** in `colony.ts` (add `CATCHUP_STEP` to its `./tuning` import; method near `tick`/`reset`):

```ts
/** Deterministically advance the colony by `budgetSeconds` of sim time, in fixed
 *  CATCHUP_STEP sub-steps — the catch-up that fast-forwards an away colony on switch
 *  (Round 4). Reproducible: same save + same budget → byte-identical (a fixed dt
 *  schedule + seeded RNG). Stops early once the run ends. `collect` accumulates the
 *  emitted events for the "while you were away" digest; otherwise they're discarded. */
fastForward(budgetSeconds: number, collect = false): ColonyEvent[] {
  const out: ColonyEvent[] = [];
  let remaining = Math.max(0, budgetSeconds);
  while (remaining > 1e-9 && this.s.outcome === null) {
    const dt = Math.min(CATCHUP_STEP, remaining);
    this.tick(dt);
    if (collect) out.push(...this.drainEvents());
    else this.events = [];
    remaining -= dt;
  }
  return out;
}
```

- [ ] **Step 4: Run — expect PASS** (`npx vitest run src/engine/catchup.test.ts`).
- [ ] **Step 5: Full suite — Mars byte-identical** (`npm run typecheck && npm test`) → 458 + new, all green (fastForward is never called by existing paths, so the determinism suite is untouched).
- [ ] **Step 6: Commit** — `feat(vivarium): Colony.fastForward — deterministic catch-up core (parallel-colonies slice 1)`

### Slice 1 verification (ultracode)
Fan out: (a) determinism — confirm `fastForward` adds no module state, draws no extra RNG outside the real tick, and Mars solo is byte-identical; (b) the fixed-step schedule is truly reproducible and the `outcome` guard prevents over-ticking a finished colony; (c) the `collect` event accumulation matches a non-collect run's state exactly.

---

## Slice 2 — `switchColony` command + store `switchTo` + savedAt/ledger freshness

**Files:** `persistence/colonies.ts` (`savedAt` on `ColonyRecord`), `protocol.ts`/`host.ts`/`bridge.ts` (`switchColony{slotKey,save,budgetSeconds}` + `catchupProgress`), `stores/colony.ts` (`switchTo`, budget math, autosave upsert).

- **savedAt:** add `savedAt: number` to `ColonyRecord`; the store stamps it on every `upsertColony` (founding, autosave, switch). Budget on switch = `clamp(now − record.savedAt mapped 1:1 to sim-seconds, 0, CATCHUP_CAP_SOLS * SOL_LENGTH)`.
- **switchColony (host):** receives the target `SaveData` + budget; `this.colony = Colony.load(save)`; set `directorControlled=false` for the catch-up; `fastForward(budget, true)` (chunked across `step()` calls so it never blocks — emit `catchupProgress`); restore the director flag from the command; resume live; emit the accumulated events + a snapshot. If `outcome != null` after catch-up, the snapshot carries it.
- **store `switchTo(slotKey)`:** save the LEAVING colony first (`await bridge.save → persist + upsertColony` — fixes revisit's loss); read the target record's `savedAt`; compute budget; `bridge.switchColony`; reset agent scratch like `revisit` (council/sentinel/director, lethal-axis, history) WITHOUT clearing the loaded slot; `setActiveSlot(slotKey)`.
- **Ledger freshness:** the autosave loop calls `upsertColony({...active row..., savedAt: Date.now(), sols, population})` so the map stops showing stale launch-time numbers.
- **Tests:** host `switchColony` loads + catches up + resumes (snapshot world/sols reflect the target + budget); a 0-budget switch is a plain load; `savedAt` round-trips; budget clamps to the cap. **Engine suite green.**
- **Verify (ultracode):** the leaving colony is saved before the swap (no loss); chunked catch-up never starves snapshots; budget is main-side only (no clock in the engine).
- **Commit:** `feat(vivarium): switchColony command + deterministic switch flow (parallel-colonies slice 2)`

---

## Slice 3 — Colonies-map switcher UI

**Files:** `ui/components/ColoniesMap.vue` (new), `App.vue` (mount + a HUD toggle), `stores/colony.ts` (expose `colonies()` already exists; add a `switchTo` control + an `activeSlot` getter).

- A panel listing every `ColonyRecord` (world label, sols, souls, status) → click → `controls.switchTo(slotKey)`. Highlight the active colony. Reuse the StartScreen chip idiom. A HUD button opens it.
- **Tests / Playwright:** settle 2 worlds → open the map → both listed → switch → the snapshot's world changes and the run resumes.
- **Commit:** `feat(vivarium): Colonies map switcher (parallel-colonies slice 3)`

---

## Slice 4 — World theming (renderer world-aware)

**Files:** `tuning.ts` (per-world visual fields on `WORLDS`: `terrainSeed`, `palette`, `relief`, `sky`/`sun`/`ambient`), `render/three/terrain.ts` (read the profile instead of hardcoded `mulberry(98213)`/rust), `scene.ts` (sky/sun/ambient branch on `snapshot.world`), `renderer.ts` (rebuild terrain on world change).

- Pure observe-side — **zero determinism implication** (`snapshot.world` already crosses the wall; tests assert the engine suite is untouched).
- Parallel authoring (ultracode): once the visual-field shape + Mars baseline (== today's look) land, fan out one agent per world (Ceres/Io/Titan) to propose its palette/seed/sky; reconcile.
- **Tests / Playwright:** Mars renders identically to today (baseline screenshot); switching to Ceres/Io/Titan visibly changes terrain/sky.
- **Commit(s):** `feat(vivarium): world-aware rendering + Ceres/Io/Titan looks (parallel-colonies slice 4)`

---

## Slice 5 — Curtain + quiet `swapWorld()`

**Files:** `render/renderer.ts` (`swapWorld()` — clear mesh maps WITHOUT the per-uid puff/pop FX; trigger terrain rebuild), `ui/components/Curtain.vue` or an App.vue overlay (a ~0.5s fade), `stores/colony.ts` (raise the curtain around `switchTo`, lower it on the post-catch-up snapshot).

- **Tests / Playwright:** a switch shows the curtain, suppresses the FX storm (no ~40 puffs), and lands cleanly.
- **Commit:** `feat(vivarium): switch curtain + quiet swapWorld (parallel-colonies slice 5)`

---

## Slice 6 — Off-screen progression + "while you were away" digest

**Files:** `stores/colony.ts` (capture pre-/post-catch-up snapshots + the collected events → a delta; dead-on-catch-up handling), `ui/components/AwayDigest.vue` (new), `persistence/colonies.ts` (mark a row's `outcome` on death).

- **Away hazards:** already handled by slice 2's `directorControlled=false` during catch-up — assert the engine scheduler fires off-screen and the flag is restored on resume.
- **Digest:** diff pre/post snapshots (sols, colonists, buildings, pools) + summarize the collected events → the `AwayDigest` panel on arrival.
- **Dead-on-catch-up:** if the post-catch-up snapshot has `outcome != null`, surface that colony's EndScreen and `upsertColony` its outcome (a tombstone row, not auto-removed).
- **Tests / Playwright:** neglect a colony → switch back → digest shows the delta; a colony that dies off-screen surfaces its end-screen + a lost ledger row.
- **Commit:** `feat(vivarium): off-screen progression + while-you-were-away digest (parallel-colonies slice 6)`

---

## Slice 7 — Inter-planet logistics (resources + crew)

**Files:** `shared/types.ts` (`ShipmentManifest`/`Shipment`), `protocol.ts`/`host.ts`/`bridge.ts` (`dispatchShipment{manifest}`), `engine/colony.ts` (debit in tick; apply credited shipments as seed-state on load/founding — the `seedColony` rebase idiom for crew), `persistence/colonies.ts` (the `Shipment` queue: add/drain-matured/list), `stores/colony.ts` (dispatch → debit + enqueue; credit-on-switch drain before resume), `ColoniesMap.vue` (send-shipment UI + in-transit display).

- **Dispatch (debit):** `dispatchShipment{manifest}` in the live tick — pool/materials debit (capacity-clamped, mirror `respondTrade`); crew removed from the roster.
- **Queue:** main-thread `Shipment{ id, fromSlot, toSlot, manifest, dispatchedAtSol, transitSols }` on the ledger; transit in **sim-sols**; **zero new RNG**.
- **Credit (on switch/catch-up):** drain matured shipments (`dispatchedAtSol + transitSols <= dest.sol`) into the destination `SaveData` BEFORE it resumes — resources clamped into pools; crew seeded at rebased ids (`colonistCounter = max+1`). Idempotent + ordered (sort by id); ledger/queue mutation synchronous before async persist.
- **Tests:** debit is deterministic; drain is exactly-once + ordered; resource credit clamps to capacity; crew credit seeds at non-colliding ids and doesn't displace the commander; transit in sim-sols; zero rng. **Engine suite green.**
- **Verify (ultracode):** mass accounting (no double-credit/drop across a tab-close mid-credit); crew id-collision + commander-succession; no cross-colony live write.
- **Commit:** `feat(vivarium): inter-planet logistics — shipments of resources + crew (parallel-colonies slice 7)`

---

## Self-review (plan vs spec)

- **Spec coverage:** catch-up core (slice 1) ✓; savedAt + switch flow + ledger freshness (2) ✓; switcher UI (3) ✓; world theming (4) ✓; curtain + quiet swap (5) ✓; off-screen progression + digest + dead-on-catch-up (6) ✓; logistics resources+crew (7) ✓. Determinism non-negotiables pinned to the slice that touches them; the only deferred non-goal (simultaneous live grids) is implemented nowhere. ✓
- **Type consistency:** `fastForward(budget, collect?)` (slice 1) consumed by `switchColony` (2) and the digest (6); `ColonyRecord.savedAt` (2) read by `switchTo`'s budget math (2) + freshness (2); `Shipment`/`ShipmentManifest` (7) shared by queue + credit; `switchColony{slotKey,save,budgetSeconds}` consistent across protocol/host/bridge/store.
- **Deliberate JIT detail:** slices 2–7 give files + signatures + tests + determinism guardrails but not line-final code, because their exact shapes depend on earlier slices (the catch-up's event shape, the switch payload, the `Shipment` type). Each is expanded to bite-sized TDD steps at execution time against the landed earlier slice.
