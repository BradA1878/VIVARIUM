# PTP — Planetary Transport Pod Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the PTP planet-hopping endgame — launch the colony to a new world, persist each settled world as its own save slot tracked by a cross-run Colonies ledger, carry a light legacy, all on the unchanged deterministic engine.

**Architecture:** Seven verified vertical slices. The engine stays pure (Mars profile == today's constants; the determinism suite is green at every commit). Worlds are *profiles* (numbers), founding inputs (`seed`/`world`/`legacy`) cross the wall through the command protocol, and the ledger is main-thread meta state modeled on `director/memory.ts` — never engine state.

**Tech Stack:** Vite + Vue 3 + TypeScript, Web-Worker sim, Hono + Mongo backend, Vitest (node env), Playwright via `window.__viv`.

**Design source of truth:** `docs/superpowers/specs/2026-06-14-ptp-planet-hopping-design.md`. This plan sequences and tests it; the spec carries the full rationale and the determinism non-negotiables. Read the spec's "Determinism & the wall" before touching any `src/engine/` file.

**Conventions to match (already in the codebase — do not reinvent):**
- Storage-injectable, Node-safe load/save: `src/ui/stores/settings.ts:36,92-119` (`Pick<Storage, …>` param defaulting to `defaultStorage()`; merge/normalize-with-defaults under try/catch; never throws). The ledger and the slot persistence follow this exactly.
- Cross-run persisted store shape: `src/agent/director/memory.ts` (versioned KEY, `empty*()`, `load*()/save*()`).
- Save round-trip test idiom: `src/persistence/save.test.ts`.
- Engine RNG discipline: two streams (`rng` main, `envRng` for terrain/arrivals, `colony.ts:49`); multipliers apply **after** draws (`hazards.ts:62,88`); derived seeds via a throwaway `new RNG(seed ^ SALT)` that never touches a live stream (`colony.ts:407-410`).

---

## Execution model (ultracode)

The slices are sequential (each builds on the last; shared files — `protocol.ts`, `host.ts`, `colony.ts`, `tuning.ts`, `stores/colony.ts` — forbid a parallel fleet). Per slice:
1. Implement with TDD (failing test → minimal code → green → typecheck).
2. **Adversarial verification workflow** (ultracode): parallel reviewers check the slice diff for determinism leaks, behavior drift, and edge cases; fix confirmed findings; commit.
3. Slice 6 (three independent world profiles) additionally fans out authoring once the profile spine exists.

`npm run typecheck && npm test` must pass before every commit. Mars/`DEFAULT_SEED` behavior must stay byte-identical through slices 1–5.

---

## File structure

**New files**
- `src/persistence/colonies.ts` — the Colonies ledger store (meta state; `director/memory.ts` shape). [slice 2]
- `src/persistence/colonies.test.ts` — ledger normalize/round-trip. [slice 2]
- `src/persistence/persistence.test.ts` — slot round-trip, default-slot back-compat, list/delete. [slice 1]
- `src/engine/worlds.ts` *(or `WORLDS` in `tuning.ts`)* — `WorldProfile` + `WORLDS` record. [slice 6]

**Modified — persistence (slice 1)**
- `src/persistence/local.ts` — slot-namespaced keys + injectable storage + index + `listLocal`/slot-aware `clearLocal`.
- `src/persistence/remote.ts` — `slot` param (drop the hardcoded const) + `listRemote`/`deleteRemote`.
- `src/persistence/index.ts` — thread `slot` through `loadBest`/`persist`; add `listSlots`/`deleteSlot`.
- `server/routes/save.ts` — `GET /api/saves` (list), `DELETE /api/save` (delete).

**Modified — the wall (slices 3–5)**
- `shared/types.ts` — `World` type; `Outcome` += `"expansion"`; founding payload + `LegacyManifest`.
- `src/worker/protocol.ts` — `{ seed?, world?, legacy? }` on `start`/`reset`; new `launchPtp` command.
- `src/worker/host.ts` — handle `launchPtp`; thread founding inputs to `reset`.
- `src/worker/bridge.ts` — senders.

**Modified — engine (slices 3–6, determinism-guarded)**
- `src/engine/colony.ts` — `reset`/ctor accept `seed`+`world`; `freshState`/`seedColony` apply world levers + carried legacy; `colonistCounter` reconciliation.
- `src/engine/state.ts` — `world` on `ColonyState` (+ legacy-backfill default `"mars"`).
- `src/engine/defs.ts`, `src/engine/unlocks.ts` — PTP def + `ORDER` + `GATES` predicate.
- `src/engine/tuning.ts` — `WORLDS`, `WORLD_SALT`.
- lever extraction: `src/engine/tick.ts` (solar), `wind.ts`, `deposits.ts`, `hazards.ts` (post-draw remap).

**Modified — UI (slices 2,4,6,7)**
- `src/ui/stores/colony.ts` — active slot; slot-scoped autosave/teardown; founding orchestration; `launch()`.
- `src/ui/components/EndScreen.vue` — Expansion variant (world picker + legacy preview) + ledger panel.
- `src/ui/components/StartScreen.vue` — Colonies (revisit) list.

---

## Slice 1 — Multi-slot client persistence + slot-scoped teardown/autosave

**Why first:** retires the only behavior actively hostile to slot-per-world (`tearDownRun`'s unconditional `clearLocal()`; the single autosave key). Pure capability + refactor; Mars behavior unchanged because the default slot reuses today's key. End-to-end "found B, A survives" lands in slice 4 (needs founding); slice 1 verifies at the unit level.

### Task 1.1: Slot-namespaced, injectable localStorage adapter

**Files:**
- Modify: `src/persistence/local.ts`
- Test: `src/persistence/persistence.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// src/persistence/persistence.test.ts
import { describe, it, expect } from "vitest";
import { Colony } from "@/engine";
import { saveLocal, loadLocal, clearLocal, listLocal } from "./local";

/** Map-backed Storage stand-in (vitest runs in node — no localStorage). */
function fakeStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

describe("local slot persistence", () => {
  it("round-trips a named slot and isolates slots", () => {
    const st = fakeStorage();
    const a = new Colony(11); a.tick(0.2);
    const b = new Colony(22); b.tick(0.2);
    saveLocal("ceres", a.serialize(), st);
    saveLocal("io", b.serialize(), st);
    expect(loadLocal("ceres", st)!.seed).toBe(11);
    expect(loadLocal("io", st)!.seed).toBe(22);
    clearLocal("ceres", st);
    expect(loadLocal("ceres", st)).toBeNull();
    expect(loadLocal("io", st)!.seed).toBe(22); // delete is scoped
  });

  it("the default slot reuses the legacy key (back-compat)", () => {
    const st = fakeStorage();
    const c = new Colony(33); c.tick(0.2);
    saveLocal("default", c.serialize(), st);
    expect(st.getItem("vivarium:save:v1")).toBeTruthy(); // legacy key, no suffix
    expect(loadLocal("default", st)!.seed).toBe(33);
  });

  it("listLocal returns written slots", () => {
    const st = fakeStorage();
    const c = new Colony(1); c.tick(0.2);
    saveLocal("default", c.serialize(), st);
    saveLocal("titan", c.serialize(), st);
    expect(new Set(listLocal(st))).toEqual(new Set(["default", "titan"]));
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npx vitest run src/persistence/persistence.test.ts`) — `saveLocal` now takes 2 args / no `listLocal` export.

- [ ] **Step 3: Rewrite `local.ts`** (keep `encode`/`decode` import; match the `settings.ts` storage seam):

```ts
import type { SaveData } from "@/engine";
import { encode, decode } from "./save";

export type PersistStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PREFIX = "vivarium:save:v1";
const INDEX_KEY = `${PREFIX}:index`;
// the default slot keeps the legacy unsuffixed key so existing saves survive
const keyFor = (slot: string): string => (slot === "default" ? PREFIX : `${PREFIX}:${slot}`);

function defaultStorage(): PersistStorage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
}

function readIndex(st: PersistStorage): string[] {
  try {
    const raw = st.getItem(INDEX_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    const list = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    // a legacy default save predates the index — surface it
    if (st.getItem(PREFIX) && !list.includes("default")) list.push("default");
    return list;
  } catch { return []; }
}
function writeIndex(st: PersistStorage, slots: string[]): void {
  try { st.setItem(INDEX_KEY, JSON.stringify([...new Set(slots)])); } catch { /* quota */ }
}

export function saveLocal(slot: string, save: SaveData, storage?: PersistStorage): void {
  const st = storage ?? defaultStorage(); if (!st) return;
  try {
    st.setItem(keyFor(slot), encode(save));
    writeIndex(st, [...readIndex(st), slot]);
  } catch { /* quota / private mode — non-fatal */ }
}

export function loadLocal(slot: string, storage?: PersistStorage): SaveData | null {
  const st = storage ?? defaultStorage(); if (!st) return null;
  try { const t = st.getItem(keyFor(slot)); return t ? decode(t) : null; } catch { return null; }
}

export function clearLocal(slot: string, storage?: PersistStorage): void {
  const st = storage ?? defaultStorage(); if (!st) return;
  try { st.removeItem(keyFor(slot)); writeIndex(st, readIndex(st).filter((s) => s !== slot)); } catch { /* ignore */ }
}

export function listLocal(storage?: PersistStorage): string[] {
  const st = storage ?? defaultStorage(); return st ? readIndex(st) : [];
}
```

- [ ] **Step 4: Run it — expect PASS.**
- [ ] **Step 5: Commit** — `git add src/persistence/local.ts src/persistence/persistence.test.ts && git commit -m "feat(vivarium): slot-namespaced local persistence (PTP slice 1)"`

### Task 1.2: Slot-aware remote adapter (+ list/delete)

**Files:** Modify `src/persistence/remote.ts`; extend `persistence.test.ts` (mock `fetch`).

- [ ] **Step 1: Failing test** — inject a fake `globalThis.fetch` asserting `saveRemote("ceres", save)` posts `{slot:"ceres",…}` and `loadRemote("ceres")` GETs `?slot=ceres`; `deleteRemote` issues `DELETE`; `listRemote` parses `{slots:[…]}`. (Keep the circuit-breaker behavior — a non-ok response returns false/null.)
- [ ] **Step 2: Run — FAIL** (functions take no slot arg today).
- [ ] **Step 3: Implement** — drop `const SLOT`; add `slot: string` as the first param of `saveRemote`/`loadRemote`; add `listRemote(): Promise<string[]>` (GET `/api/saves` → `data.slots.map(s => s.slot)`, `[]` on failure) and `deleteRemote(slot): Promise<boolean>` (DELETE `/api/save?slot=`). Preserve `isDown()/trip()/clear()`.
- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat(vivarium): slot-aware remote persistence + list/delete (PTP slice 1)`

### Task 1.3: Thread `slot` through the orchestrator

**Files:** Modify `src/persistence/index.ts`; extend `persistence.test.ts`.

- [ ] **Step 1: Failing test** — `persist("io", save)` writes local under `io` and `loadBest("io")` reads it back (remote down → local path).
- [ ] **Step 2: Run — FAIL.**
- [ ] **Step 3: Implement:**

```ts
export async function loadBest(slot: string): Promise<SaveData | null> {
  const remote = await loadRemote(slot);
  if (remote) return remote;
  return loadLocal(slot);
}
export async function persist(slot: string, save: SaveData): Promise<void> {
  saveLocal(slot, save);
  await saveRemote(slot, save);
}
export async function listSlots(): Promise<string[]> {
  const remote = await listRemote();           // [] when the server is down
  return [...new Set([...remote, ...listLocal()])];
}
export async function deleteSlot(slot: string): Promise<void> {
  clearLocal(slot);
  await deleteRemote(slot);
}
export { clearLocal };
```

- [ ] **Step 4: Run — PASS.**
- [ ] **Step 5: Commit** — `feat(vivarium): slot-addressable persistence orchestration (PTP slice 1)`

### Task 1.4: Server list + delete endpoints

**Files:** Modify `server/routes/save.ts`.

- [ ] **Step 1:** Add (save/load already slot-aware — leave them):

```ts
persistence.get("/saves", async (c) => {
  const col = await saves();
  if (!col) return c.json({ slots: [] }); // server down → client falls back to local list
  const docs = await col.find({}, { projection: { slot: 1, updatedAt: 1, _id: 0 } }).toArray();
  return c.json({ slots: docs });
});

persistence.delete("/save", async (c) => {
  const col = await saves();
  if (!col) return c.json({ error: "persistence unavailable", fallback: "local" }, 503);
  const slot = c.req.query("slot") || "default";
  try { await col.deleteOne({ slot }); return c.json({ ok: true }); }
  catch (err) { console.warn("[save] delete failed:", (err as Error).message); return c.json({ error: "delete failed", fallback: "local" }, 503); }
});
```

- [ ] **Step 2:** `npm run typecheck` (server is covered by vue-tsc). Manual smoke optional (Mongo may be down — endpoints degrade).
- [ ] **Step 3: Commit** — `feat(vivarium): server save list + delete endpoints (PTP slice 1)`

### Task 1.5: Active slot in the store; slot-scope teardown + autosave

**Files:** Modify `src/ui/stores/colony.ts` (`tearDownRun:197`, boot `loadBest:356`+`clearLocal:367`, autosave `persist:408`).

- [ ] **Step 1:** Add a module-level active slot (slice 3+ sets it per world/revisit):

```ts
// the persistence slot the live run reads/writes. Default reuses today's single
// key (Mars behavior unchanged); founding/revisit point this at a world's slot.
let activeSlot = "default";
export function setActiveSlot(slot: string): void { activeSlot = slot; }
```

- [ ] **Step 2:** Make persistence calls slot-scoped:
  - `tearDownRun`: `clearLocal()` → `clearLocal(activeSlot)`.
  - boot: `loadBest()` → `loadBest(activeSlot)`; the incompatible-save branch `clearLocal()` → `clearLocal(activeSlot)`; `persist` → `persist(activeSlot, …)`.
  - autosave: `persist` → `persist(activeSlot, …)`.
- [ ] **Step 3:** `npm run typecheck && npm test` — engine/determinism suites untouched; expect green.
- [ ] **Step 4: Playwright smoke** (`window.__viv`): fresh load resumes as before; reload mid-run resumes (default slot == legacy key, behavior identical).
- [ ] **Step 5: Commit** — `feat(vivarium): slot-scoped autosave + teardown in the store (PTP slice 1)`

### Slice 1 verification (ultracode)

Fan out reviewers over the slice-1 diff: **(a)** determinism/behavior-drift (does the default slot reproduce today's single-key behavior byte-for-byte? any path still calling a zero-arg `clearLocal`/`persist`?), **(b)** edge cases (quota throw, corrupt index, server-down list/delete, legacy save without an index entry), **(c)** the circuit breaker still trips/clears. Fix confirmed findings, re-run `typecheck && test`, then proceed.

---

## Slice 2 — The Colonies ledger store

**Files:** Create `src/persistence/colonies.ts` + `colonies.test.ts`; render read-only in `EndScreen.vue`; append/update from `stores/colony.ts` at the victory/defeat hook (`:321`).

- **Shape** (copy `settings.ts`/`memory.ts` discipline — injectable storage, normalize-with-defaults, Node-safe, KEY `vivarium:colonies:v1`):
  ```ts
  export interface ColonyRecord {
    worldId: string; slotKey: string; seed: number; difficulty: Difficulty;
    label: string; outcome: Outcome; sols: number; population: number;
    foundedAt: number; endedAt?: number;
    legacy?: { veterans: number[]; tech?: string };
  }
  export interface Ledger { v: 1; colonies: ColonyRecord[]; }
  export function loadLedger(storage?): Ledger
  export function upsertColony(rec: ColonyRecord, storage?): Ledger   // keyed by slotKey
  export function removeColony(slotKey: string, storage?): Ledger
  ```
- **Tests:** normalize a corrupt/empty blob → `{v:1,colonies:[]}`; upsert is idempotent by `slotKey`; round-trips through a fake storage; Node-safe (no storage → defaults, never throws).
- **Store wiring:** on `victory`/`defeat` (`:321`), after `recordOutcome`, `upsertColony({ worldId: snapshot.world ?? "mars", slotKey: activeSlot, seed, difficulty, outcome, sols, population, foundedAt, endedAt: <main-thread timestamp> })`. Timestamps stamped here (main thread — engine forbids `Date.now`). `worldId`/`seed` are read from the snapshot (present after slice 3; default `"mars"`/`DEFAULT_SEED` until then).
- **EndScreen:** a read-only "COLONIES" panel listing records (label, world, sols, outcome). Reuses the dossier panel styling (`EndScreen.vue:134-161`).
- **Commit:** `feat(vivarium): cross-run Colonies ledger (PTP slice 2)`
- **Verify (ultracode):** ledger never leaks into the tick; normalize handles version drift; idempotent upsert.

---

## Slice 3 — Seed + world channel across the wall (no new content)

**Files:** `shared/types.ts` (`World` type, default `"mars"`), `protocol.ts` (`start`/`reset` gain `seed?: number; world?: World`), `host.ts` (pass them to `reset`), `bridge.ts` (senders), `colony.ts` (`reset(difficulty?, seed?, world?)` + ctor; store `world` on state), `state.ts` (`world` field + legacy backfill = `"mars"`).

- **Engine discipline:** `reset` already reseeds both RNG streams from `this.seed` (`colony.ts:74-80`); accept an optional `seed` to override `DEFAULT_SEED`. `world` is stored on `ColonyState` and (slice 6) read by `freshState`; in slice 3 it's inert metadata (Mars only) so behavior is unchanged.
- **Tests:** `new Colony(seedA)` vs `new Colony(seedB)` produce different terrain (already true — assert it as the guard); a non-default seed round-trips byte-identical through `encode/decode/load`; `world` defaults to `"mars"` on a legacy save (backfill). **Mars/`DEFAULT_SEED` suite stays green.**
- **Commit:** `feat(vivarium): seed + world founding channel across the wall (PTP slice 3)`
- **Verify (ultracode):** no live-stream draw added; `world` purely carried; default path identical.

---

## Slice 4 — `expansion` outcome + `launchPtp` + PTP building + Expansion EndScreen

**Files:** `shared/types.ts` (`Outcome += "expansion"`), `defs.ts` + `unlocks.ts` (PTP def + `ORDER` + `GATES` predicate, mirror the reactor), `protocol.ts`/`host.ts`/`bridge.ts` (`launchPtp` command → set `outcome="expansion"`, pause, emit, mirroring the victory block), `EndScreen.vue` (Expansion variant: world picker + ledger), `stores/colony.ts` (`launch()` action + archive-then-hand-off).

- **PTP gate:** new `GATES` predicate (pure, latch-once) e.g. `has reactor && pop ≥ X && materials ≥ Y`; copy the `unlocks.test.ts` contract (no-rng / never-revoke / announce-once / legacy re-derive / save round-trip).
- **Launch command:** `host.ts` handles `{type:"launchPtp"}` → set `state.outcome="expansion"`, `paused=true`, emit `{type:"expansion"}`. **Not** a tick threshold.
- **Archive-then-hand-off (store):** on launch, capture the living snapshot, write it to `activeSlot` with `outcome` cleared (so revisit resumes live), `upsertColony` the ledger row, then the Expansion EndScreen offers the next world; choosing it derives the next seed (`new RNG(priorSeed ^ WORLD_SALT).u32()`), `setActiveSlot(<newWorldSlot>)`, and founds via the channel from slice 3.
- **Tests (host):** `launchPtp` sets `expansion` + pauses + emits; the event reaches `onEvent`. **Engine determinism green.**
- **Commit(s):** `feat(vivarium): PTP building + expansion outcome + launch command (PTP slice 4)`
- **Verify (ultracode):** outcome state machine (victory/defeat/expansion mutually exclusive); archive writes before the boot-guard discard; gate predicate rng-free.

---

## Slice 5 — Carried legacy (veterans + one tech)

**Files:** `shared/types.ts` (`LegacyManifest = { veterans: number[]; tech?: string }` on the founding payload), `protocol.ts`/`host.ts`/`bridge.ts` (thread `legacy?`), `colony.ts` (`seedColony` applies it), `stores/colony.ts` (build the manifest from the launching snapshot: commander id + 1, one owned tech).

- **Apply in `seedColony` (zero RNG):** seed veteran colonists at their literal ids (override the hardcoded ids 1-4 as needed); push `legacy.tech` into `acquiredTech` before the existing `recomputeCaps` (`colony.ts:238`). **Hard rule:** `colonistCounter = max(seededId)+1` before any post-seed mint.
- **Tests:** founding with `{veterans:[1], tech:"…"}` → colonist id 1 present with deterministic `nameOf(1)`/`roleOf(1)`, is the commander (lowest living id), the tech's cap effect applied at sol 0; `colonistCounter` past the max carried id (next mint never collides); fully reproducible from `(seed, world, difficulty, legacy)`.
- **Commit:** `feat(vivarium): carried legacy — veterans + one alien tech (PTP slice 5)`
- **Verify (ultracode):** no duplicate-id mint under subsequent arrivals/rover/robot; name/role are pure id hashes (no stored fields); idempotent tech push.

---

## Slice 6 — The three WorldProfiles + lever extraction + world picker

**Files:** `tuning.ts` (`WorldProfile`, `WORLDS = { mars, ceres, io, titan }`, `WORLD_SALT`), `colony.ts`/`state.ts` (`freshState` bakes world levers; start pools/caps from the profile), extraction sites `tick.ts` (solar amplitude), `wind.ts` (curve), `deposits.ts` (ratio/density), `hazards.ts` (post-draw weight remap), `EndScreen.vue` (world picker cards, numbers live from `WORLDS`).

- **`WorldProfile`** is a strict superset of difficulty: `solar`, `wind`, `geothermal`/vent density, `deposit` ratios, `hazardWeights`, `startPools`. **Mars profile == today's constants** (the determinism anchor).
- **Extraction is determinism-sensitive:** each hardcoded constant becomes `WORLDS[world].field`; the Mars value must equal today's literal so the suite stays byte-identical. Hazard variation via **post-draw remap** (draw one uniform, map through `hazardWeights` — never change draw count/order). Terrain variation rides **`envRng` only** (deposit ratios/vent counts are seeding inputs — same draw count).
- **Parallel authoring (ultracode):** once the `WorldProfile` type + Mars baseline land, fan out one agent per world (Ceres/Io/Titan) to draft its profile values + a "feels distinct, stays winnable" rationale; I reconcile and balance against fixed Mars.
- **Tests:** Mars profile reproduces the current suite byte-identical; each world applies its levers (assert solar/wind/deposit deltas) with draw count/order preserved; per-world save round-trip.
- **Commit(s):** `feat(vivarium): WorldProfile + Ceres/Io/Titan + lever extraction (PTP slice 6)`
- **Verify (ultracode):** every extraction keeps Mars == today; no main-stream draw inserted; hazard remap preserves draw count.

---

## Slice 7 — Revisit list on the StartScreen

**Files:** `StartScreen.vue` (a "COLONIES" list from the ledger), `stores/colony.ts` (a `revisit(slotKey)` action → `setActiveSlot(slotKey)` then `loadBest(slotKey)` via the existing load path).

- **Pure reuse** — `Colony.load` already resumes a slot byte-identically. Selecting a colony loads its slot; worlds away stay frozen (v1 boundary).
- **Tests / Playwright:** settle world A → launch → land on B → reload → StartScreen lists A and B → revisit A → resumes A live where it was left.
- **Commit:** `feat(vivarium): revisit settled worlds from the StartScreen (PTP slice 7)`

---

## Self-review (plan vs spec)

- **Spec coverage:** multi-slot persistence (slice 1) ✓; ledger (2) ✓; seed+world channel (3) ✓; expansion outcome + PTP building + launch + Expansion EndScreen (4) ✓; carried legacy (5) ✓; three WorldProfiles + lever extraction + picker (6) ✓; revisit (7) ✓. Determinism non-negotiables are each pinned to the slice that touches them. Non-goals (ticking-while-away, parallel live grids, per-world Director memory) are untouched by every task. ✓
- **Type consistency:** `slot: string` first-param order is uniform across `local`/`remote`/`index`; `ColonyRecord.slotKey`/`worldId` reused in slices 2/4/7; `Outcome += "expansion"` (slice 4) consumed by EndScreen + ledger; `LegacyManifest` shape identical in slices 4/5. `setActiveSlot`/`activeSlot` defined slice 1, used 4/7.
- **Deliberate just-in-time detail:** slices 2–7 give files + tests + signatures + determinism guardrails but not line-final code, because their exact code depends on shapes locked by earlier slices (e.g. the `WorldProfile` fields finalized in 6, the founding payload in 3–5). Each is expanded to bite-sized TDD steps at execution time against the landed earlier slice — a sequencing decision, not a punt.
