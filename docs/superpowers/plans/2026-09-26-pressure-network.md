# Pressure Network Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sealed buildings connect themselves when placed, docked modules share the seal, every hub roots a network, and the player can always see what is connected and why any building is off.

**Architecture:** A new pure engine module `seal.ts` owns the flood (`sealNetwork`) and the corridor planner (`planSealRoute`); the tick's connectivity pass and the worker's `place` command use it, and the main thread runs the same functions on snapshots for the ghost preview. The production pass records `offReason`, which feeds new render modules (network overlay, fault badges), a HUD alert, and the narrator's world model.

**Tech Stack:** TypeScript (strict), Vue 3, three.js r169, Vitest (node), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-pressure-network-design.md`

## Global Constraints

- Engine purity (CLAUDE.md): nothing in `src/engine/` imports three.js, Vue, DOM, `fetch`, `await`, `Math.random`, `Date`. `seal.ts` is a pure function of its inputs; ordering is fixed (neighbour order `[1,0], [-1,0], [0,1], [0,-1]`, footprint scan order), so worker and preview agree.
- `place` gains `connect?: boolean`, default false; only sent when true. Existing command logs keep their meaning.
- Corridor cost stays `DEFS.corridor.matCost` (2) per new cell; building + corridor must be affordable or nothing is placed.
- Sealed buildings = `requiresPressure: true` (hab, reclaimer, electrolysis, greenhouse, medbay). Surface buildings neither need nor pass the seal.
- `BuildingState.offReason?: OffReason`, `OffReason = "power" | "damaged" | "faulted" | "seal" | "crew" | "water" | "oxygen" | "food"` (named `offReason`, not `fault`, because `BuildingState.faulted` already exists as the flare-fault timer).
- Labels: NO POWER, DAMAGED, FLARE FAULT, NO SEAL, NO CREW, NO WATER, NO OXYGEN, NO FOOD. Corridors never get a badge.
- Preview strip text exactly: "connects to the network" · "lays N corridor cells · C mat (T total)" · "needs T mat, have M" · "no route to the network · will be unsealed".
- tsconfig strict + noUnusedLocals/Parameters + noImplicitOverride; Vitest runs in node (no WebGL, no DOM: canvas work only inside methods and injectable for tests).
- Plain comments and commit messages. Never `git add -A`; list files. Commit on `main` (Brad: "on commit main").
- e2e specs stay off HIGH and freeze the render loop around canvas clicks (CI renders on SwiftShader).

## Review Focus

1. A route that runs through a dangling (unconnected) corridor: it is reused for free, not charged. → Task 2 test "reuses a dangling corridor".
2. Two placements in one batch before a tick: the second sees the first as part of the network. → Task 3 test "a second placement in the same batch docks to the first".
3. Materials exactly equal to building + corridor: allowed. → Task 3 test "exact materials are enough".
4. Rotation never changes the plan (doors are visual): the planner takes no rotation. → Task 2 test "rotation-free signature" is structural; Task 6 preview passes no rotation.
5. A corridor removed from under a network: the stranded sealed building reports `offReason: "seal"`, badges, and alerts. → Task 4 test "unsealed building reports seal"; Task 10 e2e.

## File Structure

| File | Responsibility |
|---|---|
| `src/engine/seal.ts` (new) | `passesSeal`, `occupancyOf`, `sealNetwork`, `planSealRoute`, `sealPreview`, types |
| `src/engine/seal.test.ts` (new) | rule + planner + preview tests |
| `src/engine/connectivity.ts` | thin wrapper over `sealNetwork` |
| `src/engine/colony.ts` | `place(..., connect)` |
| `src/engine/tick.ts` | `offReason` in the production pass |
| `src/engine/index.ts` | export seal API + `cellsFor` |
| `shared/types.ts` | `OffReason`, `BuildingState.offReason` |
| `src/worker/protocol.ts`, `host.ts`, `bridge.ts` | `connect` flag; `previewSeal` |
| `src/agent/worldmodel/graph.ts`, `index.ts` | read `offReason`; `damaged` reason |
| `src/render/three/network-overlay.ts` (new) | overlay cells + instanced tiles |
| `src/render/three/badges.ts` (new) | badge specs + pooled sprites |
| `src/ui/components/alerts.ts` | `faultAlerts` |
| `src/ui/sealPreview.ts` (new) | `sealPreviewText` |
| `src/render/three/placement.ts` | corridor ghost + preview callback + `connect: true` |
| `src/render/renderer.ts` | wire overlay, badges, `focusBuilding`, `onPlacePreview` |
| `src/ui/stores/colony.ts`, `Inspector.vue`, `Alerts.vue` | preview line, alert buttons, `focusFault` |
| `src/ui/hints.ts`, `src/ui/components/guide.ts`, docs, `CLAUDE.md` | words |
| `e2e/pressure-network.spec.ts` (new) | end-to-end checks |

Phases: **1 engine** (Tasks 1–4, main session, serial) → **2 modules** (Tasks 5a–5c, parallel subagents in worktrees, new files only) → **3 integration** (Tasks 6–9, main session) → **4 e2e + review + ship** (Task 10, reviewers, final audit, push, CI, pin).

---

### Task 1: The seal rule (`seal.ts` flood + connectivity wrapper)

**Files:** Create `src/engine/seal.ts`, `src/engine/seal.test.ts`; modify `src/engine/connectivity.ts`, `src/engine/engine.test.ts` (old-rule tests), `src/engine/index.ts`.

**Interfaces — Produces:**
```ts
export interface SealBuilding { uid: number; defId: string; gx: number; gy: number }
export interface SealNetwork { cells: Set<number>; connected: Set<number> } // cell = y * N + x
export function passesSeal(defId: string): boolean;
export function occupancyOf<B extends SealBuilding>(N: number, buildings: readonly B[]): Map<number, B>;
export function sealNetwork(N: number, buildings: readonly SealBuilding[]): SealNetwork;
```

- [ ] **Step 1: failing tests** (`seal.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { sealNetwork, type SealBuilding } from "./seal";

let uid = 1;
const at = (defId: string, gx: number, gy: number): SealBuilding => ({ uid: uid++, defId, gx, gy });
const N = 16;

describe("sealNetwork — the pressure rule", () => {
  it("floods from every hub, not just the first", () => {
    const a = at("hub", 0, 0), b = at("hub", 10, 10), habB = at("hab", 12, 10);
    const net = sealNetwork(N, [a, b, habB]);
    expect([...net.connected].sort()).toEqual([a.uid, b.uid, habB.uid].sort());
  });
  it("docked sealed buildings share the seal through each other", () => {
    const hub = at("hub", 0, 0), hab = at("hab", 2, 0), elec = at("electrolysis", 3, 0), med = at("medbay", 4, 0);
    const net = sealNetwork(N, [hub, hab, elec, med]);
    expect(net.connected.has(med.uid)).toBe(true);
  });
  it("a surface building breaks the chain", () => {
    const hub = at("hub", 0, 0), hab = at("hab", 2, 0), bat = at("battery", 3, 0), elec = at("electrolysis", 4, 0);
    const net = sealNetwork(N, [hub, hab, bat, elec]);
    expect(net.connected.has(hab.uid)).toBe(true);
    expect(net.connected.has(bat.uid)).toBe(false);
    expect(net.connected.has(elec.uid)).toBe(false);
  });
  it("corridors carry it; a sealed building off the end of the run joins", () => {
    const hub = at("hub", 0, 0), c1 = at("corridor", 2, 0), c2 = at("corridor", 3, 0), gh = at("greenhouse", 4, 0);
    const net = sealNetwork(N, [hub, c1, c2, gh]);
    expect(net.connected.has(gh.uid)).toBe(true);
    expect(net.cells.has(0 * N + 5)).toBe(true); // the greenhouse's far cell is sealed too
  });
  it("with no hub nothing is connected", () => {
    const net = sealNetwork(N, [at("hab", 3, 3), at("corridor", 4, 3)]);
    expect(net.connected.size).toBe(0);
    expect(net.cells.size).toBe(0);
  });
});
```

- [ ] **Step 2:** `npx vitest run src/engine/seal.test.ts` → FAIL (module not found).

- [ ] **Step 3: implement** `src/engine/seal.ts` (header comment explaining the rule), the flood as a head-indexed queue over `occupancyOf`; roots = all hub cells; a neighbour cell joins when its building `passesSeal` (hub, conduit, requiresPressure). `connectivity.ts` becomes:

```ts
export function recomputeConnectivity(s: ColonyState): void {
  const net = sealNetwork(s.N, s.buildings);
  for (const b of s.buildings) b.connected = net.connected.has(b.uid);
}
```
Update its header: every hub roots the flood; hubs, corridors, and sealed buildings pass it; surface buildings are never marked connected. Grep `src/engine` for non-test readers of `.connected` and confirm each checks `requiresPressure` (or is about a sealed building) before relying on it.

- [ ] **Step 4:** rewrite `engine.test.ts` "a sealed unit cut off from the hub goes offline": docking keeps the seed electrolysis sealed through the habs, so instead place an electrolysis (connect omitted) at an empty cell with an empty ring around it, confirm `connected === false` and `online === false` after `run(c, 2)`, then place corridor cells between it and the seed corridor/hub and confirm it comes online. Fix the brownout test's comment ("habs do not extend a seal" → sealed buildings pass the seal).

- [ ] **Step 5:** `npx vitest run src/engine` → PASS; `npm run typecheck`.

- [ ] **Step 6: commit** `feat(engine): every hub roots the seal and docked modules share it` (seal.ts, seal.test.ts, connectivity.ts, engine.test.ts).

### Task 2: The corridor planner

**Files:** modify `src/engine/seal.ts`, `src/engine/seal.test.ts`, `src/engine/index.ts`.

**Interfaces — Produces:**
```ts
export type SealPlan =
  | { kind: "touching" }
  | { kind: "corridor"; path: [number, number][]; newCells: [number, number][]; cost: number }
  | { kind: "no-route" };
export function planSealRoute(N: number, buildings: readonly SealBuilding[], network: SealNetwork, footprint: readonly [number, number][]): SealPlan;
export type SealPreview =
  | { kind: "touching" }
  | { kind: "corridor"; path: [number, number][]; cells: number; cost: number; total: number; affordable: boolean }
  | { kind: "no-route" };
export function sealPreview(plan: SealPlan, buildingCost: number, materials: number): SealPreview;
```
`index.ts` exports `sealNetwork, planSealRoute, sealPreview, passesSeal` and the types, plus `cellsFor` from `./grid`.

- [ ] **Step 1: failing tests** (append to `seal.test.ts`)

```ts
import { planSealRoute, sealPreview } from "./seal";
import { cellsFor } from "./grid";
import { DEFS } from "./defs";
const foot = (defId: string, gx: number, gy: number) => cellsFor(DEFS[defId], gx, gy);

describe("planSealRoute", () => {
  const hub = at("hub", 0, 0); // cells (0,0)-(1,1)
  it("touching the network needs no corridor", () => {
    const bs = [hub];
    expect(planSealRoute(N, bs, sealNetwork(N, bs), foot("hab", 2, 1)).kind).toBe("touching");
  });
  it("lays the shortest corridor to the network", () => {
    const bs = [hub];
    const plan = planSealRoute(N, bs, sealNetwork(N, bs), foot("hab", 6, 0));
    expect(plan.kind).toBe("corridor");
    if (plan.kind !== "corridor") return;
    expect(plan.path).toHaveLength(4); // (5,0) (4,0) (3,0) (2,0) in some order of discovery
    expect(plan.newCells).toHaveLength(4);
    expect(plan.cost).toBe(8);
  });
  it("reuses a dangling corridor for free", () => {
    const dangling = at("corridor", 4, 0);
    const bs = [hub, dangling];
    const plan = planSealRoute(N, bs, sealNetwork(N, bs), foot("hab", 6, 0));
    if (plan.kind !== "corridor") throw new Error("expected a corridor");
    expect(plan.path).toHaveLength(4);
    expect(plan.newCells).toHaveLength(3);
    expect(plan.cost).toBe(6);
  });
  it("a boxed-in site has no route", () => {
    const ring = [at("battery", 8, 7), at("battery", 8, 9), at("battery", 7, 8), at("battery", 9, 8)];
    const bs = [hub, ...ring];
    expect(planSealRoute(N, bs, sealNetwork(N, bs), foot("hab", 8, 8)).kind).toBe("no-route");
  });
  it("no hub means no route", () => {
    expect(planSealRoute(N, [], sealNetwork(N, []), foot("hab", 4, 4)).kind).toBe("no-route");
  });
  it("is deterministic", () => {
    const bs = [hub, at("battery", 4, 1)];
    const a = planSealRoute(N, bs, sealNetwork(N, bs), foot("greenhouse", 7, 3));
    const b = planSealRoute(N, bs, sealNetwork(N, bs), foot("greenhouse", 7, 3));
    expect(a).toEqual(b);
  });
});

describe("sealPreview", () => {
  it("adds the building cost and says whether it is affordable, exact totals included", () => {
    const plan = { kind: "corridor", path: [[2, 0], [3, 0]], newCells: [[2, 0], [3, 0]], cost: 4 } as const;
    expect(sealPreview(plan as never, 24, 28)).toMatchObject({ kind: "corridor", cells: 2, cost: 4, total: 28, affordable: true });
    expect(sealPreview(plan as never, 24, 27)).toMatchObject({ affordable: false });
    expect(sealPreview({ kind: "touching" }, 24, 0)).toEqual({ kind: "touching" });
  });
});
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement** per the spec's search: `touching` check first (any footprint cell 4-adjacent to `network.cells`); `no-route` if the network is empty; else BFS from free perimeter cells (footprint scan order × fixed neighbour order), passable = in bounds, not in the footprint, and empty or a corridor not in the network; goal = first dequeued passable cell 4-adjacent to the network; rebuild the path from a `prev` map; `newCells` = path cells with no occupant; `cost = newCells.length * (DEFS.corridor.matCost ?? 0)`. `sealPreview` maps `corridor` to `{ kind, path, cells: newCells.length, cost, total: buildingCost + cost, affordable: total <= materials }` and passes the other kinds through.
- [ ] **Step 4:** run → PASS; typecheck.
- [ ] **Step 5: commit** `feat(engine): plan the shortest corridor from a new building to the seal`.

### Task 3: `place` with `connect`

**Files:** modify `src/worker/protocol.ts`, `src/worker/host.ts`, `src/worker/bridge.ts`, `src/engine/colony.ts`; tests in `src/engine/seal.test.ts` (Colony section).

**Interfaces — Produces:** `Colony.place(defId, gx, gy, rot: Side = 0, connect = false): boolean`; `BridgeCore.place(defId, gx, gy, rot = 0, connect = false)`; Command `{ type: "place"; defId; gx; gy; rot?; connect?: boolean }`.

- [ ] **Step 1: failing tests** (Colony seed layout: hub at (4,4) 2×2, corridors (4,6) (5,6), habs (3,6) (6,6), electrolysis (5,7)):

```ts
import { Colony } from "./colony";
import type { ColonyState } from "./state";
const stateOf = (c: Colony) => (c as unknown as { s: ColonyState }).s;

describe("place with connect", () => {
  it("lays the corridor and charges building + 2 per cell", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = 200;
    const before = s.buildings.filter((b) => b.defId === "corridor").length;
    expect(c.place("hab", 4, 14, 0, true)).toBe(true);
    const laid = s.buildings.filter((b) => b.defId === "corridor").length - before;
    expect(laid).toBeGreaterThan(0);
    expect(s.materials.amount).toBe(200 - 24 - 2 * laid);
    expect(s.buildings.find((b) => b.defId === "hab" && b.gx === 4 && b.gy === 14)!.connected).toBe(true);
  });
  it("places nothing when the corridor is unaffordable", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = 25; // the hab alone would fit
    const count = s.buildings.length;
    expect(c.place("hab", 4, 14, 0, true)).toBe(false);
    expect(s.buildings.length).toBe(count);
    expect(s.materials.amount).toBe(25);
  });
  it("exact materials are enough", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = 1000;
    const probe = new Colony(7);
    stateOf(probe).materials.amount = 1000;
    probe.place("hab", 4, 14, 0, true);
    const spent = 1000 - stateOf(probe).materials.amount;
    s.materials.amount = spent;
    expect(c.place("hab", 4, 14, 0, true)).toBe(true);
    expect(s.materials.amount).toBe(0);
  });
  it("touching the base lays no corridor", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = 200;
    const before = s.buildings.length;
    expect(c.place("hab", 6, 4, 0, true)).toBe(true); // east of the 2×2 hub
    expect(s.buildings.length).toBe(before + 1);
  });
  it("a second placement in the same batch docks to the first", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = 500;
    expect(c.place("hab", 4, 14, 0, true)).toBe(true);
    const before = s.buildings.length;
    expect(c.place("electrolysis", 5, 14, 0, true)).toBe(true);
    expect(s.buildings.length).toBe(before + 1); // docked: no corridor
  });
  it("without connect nothing changes from today", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.materials.amount = 200;
    const before = s.buildings.length;
    expect(c.place("hab", 4, 14)).toBe(true);
    expect(s.buildings.length).toBe(before + 1);
  });
});
```
(If (4,14) is not empty in the seed, pick another empty cell well away from the base and state it in the test.)

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement.** `colony.ts`:

```ts
place(defId: string, gx: number, gy: number, rot: Side = 0, connect = false): boolean {
  const def = DEFS[defId];
  if (!def || !canPlace(this.s, def, gx, gy)) return false;
  let plan: SealPlan | null = null;
  if (connect && def.requiresPressure) {
    plan = planSealRoute(this.s.N, this.s.buildings, sealNetwork(this.s.N, this.s.buildings), cellsFor(def, gx, gy));
    if (plan.kind === "corridor" && (def.matCost ?? 0) + plan.cost > this.s.materials.amount) return false;
  }
  // …existing insert / pay / recomputeCaps / emit…
  if (plan?.kind === "corridor") for (const [x, y] of plan.newCells) this.place("corridor", x, y);
  if (connect) recomputeConnectivity(this.s);
  return true;
}
```
`protocol.ts`: add `connect?: boolean`. `host.ts`: `this.colony.place(cmd.defId, cmd.gx, cmd.gy, (cmd.rot ?? 0) as Side, cmd.connect === true)`. `bridge.ts`: `place(defId, gx, gy, rot = 0, connect = false) { this.send({ type: "place", defId, gx, gy, rot, ...(connect ? { connect: true } : {}) }); }`.
- [ ] **Step 4:** run → PASS; `npx vitest run` (full) → PASS; typecheck.
- [ ] **Step 5: commit** `feat(engine): placing a sealed building lays its own corridor`.

### Task 4: `offReason` and the narrator

**Files:** modify `shared/types.ts`, `src/engine/tick.ts`, `src/agent/worldmodel/graph.ts`, `src/agent/worldmodel/index.ts`; tests in `src/engine/engine.test.ts` (or a new `src/engine/offreason.test.ts`) and the world model's tests.

**Interfaces — Produces:** `export type OffReason = "power" | "damaged" | "faulted" | "seal" | "crew" | "water" | "oxygen" | "food"`; `BuildingState.offReason?: OffReason`; world-model `FailReason` gains `"damaged"`.

- [ ] **Step 1: failing tests** (`src/engine/offreason.test.ts`): build a `Colony(7)`, set up each condition on `stateOf(c)`, call `c.tick(0.1)` (or the file's existing `run` helper), assert `offReason`:
  - power: `s.pools.power.amount = 0`, `s.tod = 0` (night) → the seed electrolysis `offReason === "power"`.
  - damaged: seed electrolysis `integrity = 0.2` → `"damaged"`; faulted: `faulted = 5`, integrity 1 → `"faulted"`.
  - seal: place an electrolysis away from the base without connect → `"seal"`.
  - crew: `s.population = 0` → staffed buildings `"crew"`.
  - water: `s.pools.water.amount = 0` → electrolysis `"water"`.
  - a running building → `undefined`.
  World model: a snapshot whose building has `offReason: "damaged"` → `diagnoseShortfall` failing reason `"damaged"`; `offReason: "water"` → `"starved"` with `starvedOf: "water"`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement.** Production pass: clear `b.offReason = undefined` with the other resets; set it at each gate before `continue` (`"power"`, `b.faulted > 0 ? "faulted" : "damaged"`, `"seal"`, `"crew"`, the missing input). `reasonFor` reads `b.offReason` first (seal → unsealed, crew → unstaffed, power → unpowered, damaged/faulted → damaged, input → starved + starvedOf), else the existing derivation. `index.ts` prose for `damaged`: "is damaged".
- [ ] **Step 4:** run → PASS; full suite; typecheck.
- [ ] **Step 5: commit** `feat(engine): record why a building is off; the narrator reads it`.

**Phase 1 checkpoint (main session):** `npm run typecheck && npm test && npm run build`, read `git diff` of the phase, fix, commit.

---

### Task 5a (subagent): Network overlay module

**Files:** create `src/render/three/network-overlay.ts`, `src/render/three/network-overlay.test.ts`. Touch nothing else.

**Interfaces — Produces:**
```ts
export interface OverlayCell { gx: number; gy: number; ok: boolean }
export function overlayCells(buildings: readonly BuildingState[]): OverlayCell[];
export class NetworkOverlay {
  readonly group: THREE.Group;
  constructor(grid: GridSpace);
  setVisible(on: boolean): void;
  sync(buildings: readonly BuildingState[]): void; // rebuilds only when its key changes
  dispose(): void;
}
```
Rules: `ok` cells = every footprint cell of a building that is `connected` and is a hub, a conduit, or `requiresPressure`; not-ok cells = every footprint cell of a `requiresPressure` building that is not connected; surface buildings contribute nothing. Two `InstancedMesh`es (ok: `#7fd4e8`, opacity 0.18; bad: `#e8784f`, opacity 0.32), shared `PlaneGeometry(CELL * 0.96, CELL * 0.96).rotateX(-Math.PI / 2)`, `MeshBasicMaterial({ transparent: true, depthWrite: false })`, capacity `grid.N * grid.N` each, `count` set per sync, positions `grid.cellCenter(gx, gy)` at y = 0.025, `userData.noAO = true` on both meshes, group hidden by default. Key = the relevant buildings' `uid:gx:gy:connected` joined; skip rebuild when unchanged.

Tests: `overlayCells` classification (connected hub 4 ok cells, connected corridor ok, unconnected hab not ok, solar none); `sync` sets counts; second `sync` with the same list does not call `setMatrixAt` again (spy); `setVisible` toggles `group.visible`; `dispose` disposes geometry and both materials. Import `GridSpace` from `./coords`, `DEFS` from `@/engine`, `BuildingState` from `@shared/types`; build buildings with a small helper filling `online/staffed/fed/util/integrity/faulted/rot`.

Verify: `npx vitest run src/render/three/network-overlay.test.ts`, `npm run typecheck`. Commit `feat(render): network overlay tiles for the sealed network`.

### Task 5b (subagent): Fault badges module

**Files:** create `src/render/three/badges.ts`, `src/render/three/badges.test.ts`. Touch nothing else.

**Interfaces — Consumes:** `OffReason` from `@shared/types` (added in Task 4). **Produces:**
```ts
export const OFF_REASON_LABEL: Record<OffReason, string>; // NO POWER, DAMAGED, FLARE FAULT, NO SEAL, NO CREW, NO WATER, NO OXYGEN, NO FOOD
export interface BadgeSpec { uid: number; label: string }
export function badgeSpecs(buildings: readonly BuildingState[]): BadgeSpec[]; // offReason set, not a conduit
export type BadgeTextureFactory = (label: string) => THREE.Texture;
export class FaultBadgeSystem {
  readonly group: THREE.Group;
  constructor(makeTexture?: BadgeTextureFactory); // default draws a canvas pill (lazily, inside the method)
  sync(specs: readonly BadgeSpec[], anchor: (uid: number) => THREE.Vector3 | null): void;
  dispose(): void;
}
```
Follow `src/render/three/nametags.ts` (read it first): pooled `THREE.Sprite`s with `SpriteMaterial({ map, depthTest: false, transparent: true })`, `center.set(0.5, 0)`, world height 0.3, width from the texture aspect, `renderOrder` 999, textures cached per label, canvas pill: panel `rgba(12, 16, 20, 0.82)`, ink `#e8784f`, hairline `rgba(232, 120, 79, 0.55)`, font `"IBM Plex Mono", ui-monospace, monospace`. Sprite position = `anchor(uid)` + (0, 0.12, 0); a spec whose anchor is null is skipped. Extra pooled sprites are hidden. `sync` must be cheap when specs and anchors are unchanged (compare a key).

Tests (inject a stub factory `() => new THREE.Texture()`): labels map; `badgeSpecs` skips conduits and buildings without `offReason`; `sync` shows one sprite per spec at anchor + 0.12, hides extras when specs shrink, reuses pooled sprites, calls the factory once per distinct label; `dispose` disposes materials and cached textures.

Verify, commit `feat(render): fault badges say why a building is off`.

### Task 5c (subagent): Alert lines and preview text (pure)

**Files:** modify `src/ui/components/alerts.ts` (+ its test file if one exists, else create `src/ui/components/alerts.test.ts`); create `src/ui/sealPreview.ts`, `src/ui/sealPreview.test.ts`.

**Interfaces — Consumes:** `OffReason`, `BuildingState` (`@shared/types`); `SealPreview` from `@/engine` (Task 2). **Produces:**
```ts
export interface FaultAlert { k: string; sev: 2; txt: string; sub: string; uids: number[] }
export function faultAlerts(buildings: readonly BuildingState[]): FaultAlert[];
export function sealPreviewText(p: SealPreview, materials: number): { text: string; warn: boolean };
```
`faultAlerts`: ignore conduits and `offReason === "power"` (BROWNOUT covers it); one line per reason in order seal, crew, damaged, faulted, water, oxygen, food, only when count > 0; `k: "off-" + reason`; texts: `${n} UNSEALED` / "no corridor to a hub"; `${n} UNSTAFFED` / "no free crew"; `${n} DAMAGED` / "offline until repaired"; `${n} FLARE FAULT` / "electronics recovering"; `${n} NO WATER` / "input tank empty" (same pattern NO OXYGEN / NO FOOD); `uids` in building order.
`sealPreviewText`: touching → `{ text: "connects to the network", warn: false }`; corridor affordable → `{ text: "lays ${cells} corridor cells · ${cost} mat (${total} total)", warn: false }` (use "cell" when cells === 1); corridor not affordable → `{ text: "needs ${total} mat, have ${Math.floor(materials)}", warn: true }`; no-route → `{ text: "no route to the network · will be unsealed", warn: true }`.

Tests cover every branch, the ordering, conduit and power exclusion, and singular/plural. Verify, commit `feat(ui): fault alert lines and seal preview text`.

---

### Task 6: Preview wiring (main session)

**Files:** `src/worker/bridge.ts`, `src/render/three/placement.ts`, `src/render/renderer.ts`, `src/ui/stores/colony.ts`, `src/ui/components/Inspector.vue`.

- `BridgeCore.previewSeal(defId, gx, gy): SealPreview | null` — null for surface defs or no snapshot; memoize `sealNetwork` per `latest` snapshot object.
- `PlacementController`: `onPreview(cb)`; in `drawPlaceGhost`, when `canPlace` is true, get the preview; blocked = `!ok || (corridor && !affordable)`; draw footprint + path tiles in one color (cyan / rust), path at y 0.04; emit the preview (deduped by a key of kind/cells/cost/affordable) and emit null whenever not placing or not hovering. `onClick` place sends `connect: true`. Add `hasTool(): boolean`.
- `renderer.onPlacePreview(cb)` passthrough; store `placePreview` ref set in `initColony`, exported from `useColony`; `Inspector.vue` placing strip adds a line from `sealPreviewText` (class `ins-seal`, `warn` → rust).
- Verify: typecheck, tests, then Playwright: pick Habitat, hover away from the base, screenshot the corridor ghost and the strip text.
- Commit `feat(ui): preview the corridor a sealed building will lay`.

### Task 7: Renderer wiring (main session)

**Files:** `src/render/renderer.ts` (+ `placement.ts` `hasTool` if not done).

- Construct `NetworkOverlay(this.grid)` and `FaultBadgeSystem()`, add both groups to the scene, dispose on teardown.
- In `reconcile`: `networkOverlay.sync(snap.buildings)`; `networkOverlay.setVisible(this.placement.hasTool())`; badges `sync(badgeSpecs(snap.buildings), uid => anchor)` where anchor = the placed mesh position with `y = entry.topY` (computed once with `new THREE.Box3().setFromObject(mesh.object)` right after the mesh is positioned, before any spawn scale-in).
- `focusBuilding(uid): boolean` — pan the camera rig to the building's footprint centre (`cameraControls.rig.setOffset(target.sub(camFocus), camFocus)`), then `hazardFx.ringPulse(centre, FX_RUST_or_cyan, 1.8)`; skip the pan while piloting.
- Verify: typecheck/tests; Playwright: overlay visible with a tool, hidden without; a disconnected building shows a NO SEAL badge.
- Commit `feat(render): network overlay, fault badges, and focus on a building`.

### Task 8: Alerts wiring (main session)

**Files:** `src/ui/components/Alerts.vue`, `src/ui/stores/colony.ts`.

- `Alerts.vue` items include `faultAlerts(cur.buildings)`; `AlertItem.uids?`; rows with uids render as `<button type="button">` (same look, pointer cursor, visible focus) calling `focusFault(it.k, it.uids)`.
- Store `focusFault(k, uids)`: per-key cursor, next uid modulo length, `renderer?.focusBuilding(uid)`; exported via `useColony`.
- Verify + commit `feat(ui): fault alerts count and find unsealed and unstaffed buildings`.

### Task 9: Words and docs (main session)

- `ui/hints.ts` corridor hint body; `ui/components/guide.ts` greenhouse copy (update any tests that pin the old text).
- `docs/gameplay.md`, `docs/engine.md` (pressure section), `docs/rendering.md` (overlay, badges), `CLAUDE.md` "Doors / rotation / corridors" entry.
- Commit `docs: the pressure network after the refactor`.

**Phase 3 checkpoint:** typecheck, full tests, build, full e2e locally; read the diff; commit.

### Task 10: e2e + review + ship

- `e2e/pressure-network.spec.ts` (desktop only): (1) pick Habitat, pan to an empty cell away from the base, hover, expect the strip to show "lays … corridor cells", freeze the loop, click, resume, poll the hab `connected === true` and corridor count up; (2) with a build tool active, `renderer.networkOverlay` group visible; cleared → hidden; (3) place an electrolysis with auto-corridor, `bridge.remove` one of its new corridor cells, poll `offReason === "seal"`, the "1 UNSEALED" alert, and a visible badge sprite.
- Adversarial review: two reviewers (engine; main thread) against the spec, plan, and diff; confirm findings in code; one fix wave.
- Final audit: read the full diff, run typecheck, tests, build, build:egg, server:build, full e2e.
- Ship: push `main`, wait for CI green, `gh workflow run sync-vivarium.yml -R BradA1878/bradanderson.org`, verify the pin and the live bundle.
