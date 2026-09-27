# Crew Settings, Printers, and Building Information Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the player decide which buildings get crew (FIRST / NORMAL / OFF), replace the Fabricator with 3D, Bio, and Atomic printers, and show a card that says what each building does and why it is or is not working.

**Architecture:** A per-building `mode` on `BuildingState` (engine data, saved with the building) reorders the tick's production pass and switches buildings off; `modesFor(def)` says which settings a def offers and is shared by the engine (validation) and the UI (buttons). The printers are defs (the Atomic Printer adds one optional def field, `printsLowest`); the Fabricator and its mechanism are deleted and dropped from saves on load. The card is a Vue component over pure helpers (`buildingFacts`, `statusLabel`, `statusLine`) that read defs and snapshots.

**Tech Stack:** TypeScript (strict, noUnusedLocals/Parameters), Vue 3, three.js r169, Vitest (node), Playwright.

**Spec:** `docs/superpowers/specs/2026-09-26-crew-printers-building-info-design.md`

## Global Constraints

- Engine purity (CLAUDE.md): nothing in `src/engine/` imports three.js, Vue, DOM, `fetch`, `await`, `Math.random`, `Date`. The setting is plain data; no RNG or clock anywhere in this work.
- `BuildingState.mode?: "first" | "off"`; undefined means NORMAL. `BuildingMode = "first" | "normal" | "off"`. Command: `{ type: "setMode"; uid: number; mode: BuildingMode }`.
- `modesFor(def)`: `["first","normal","off"]` when `staffing > 0`; `["normal","off"]` when `consumes.power > 0` and not `isHub`, `conduit`, or `popCap`; `[]` otherwise.
- `OffReason` gains `"off"`; badge label `"OFF"`; `faultAlerts` ignores `"off"`; world-model prose "is switched off".
- Printers (verbatim from the spec): 3D Printer `printer` 3DP 1×1 40 mat, 6 power/s → 0.35 materials/s, priority 15, gate unchanged; Bio Printer `bioprinter` BIO 1×1 35 mat, 8 power/s + 2 water/s → 3 food/s, priority 28, gate "a Hydroponics built, or sol ≥ 6"; Atomic Printer `atomic` ATM 2×2 120 mat, 30 power/s, `printsLowest: { oxygen: 6, water: 8, food: 4, materials: 1 }`, priority 10, gate "a Fission Reactor built". All: staffing 0, `requiresPressure: false`.
- Fabricators are dropped from saves on load **without a refund**.
- Descriptions: copy each `desc` verbatim from the spec's Descriptions table.
- Plain comments and commit messages. Never `git add -A`; list files. Commit on `main`. Every commit message ends with the line `Claude-Session: https://claude.ai/code/session_01Ega2HXb5a3AXwKzStmmc7w`.
- e2e specs stay off HIGH and freeze the render loop around canvas clicks (CI renders on SwiftShader).

**Ruling (spec AC4 vs AC5)** (amended during execution: see the ledger's Rulings 5 and 6 — stopped buildings keep their posts, and posts are sticky): AC5 ("with no settings, a run plays out exactly as before") holds for the production order and power; the `assign()` alignment required by AC4 can change which colonist stands at which running building, and so the role bonus, when some staffed buildings are not running. Accepted: AC4 is a stated rule; any test that pinned the old posting is updated with a comment.

## Review Focus

1. A building set to OFF in a brownout: it takes no share of the power, so the rest shed as if it were absent. → Task 2 test "OFF takes no power".
2. A FIRST building that cannot run (unsealed, unpowered): its worker goes to the next building in line, not wasted. → Task 2 test "a FIRST building that cannot run passes its worker on".
3. A `setMode` for a uid that was just demolished (a stale click): refused, nothing changes. → Task 1 test "rejects an unknown uid".
4. Loading a save whose fabricators occupied cells: those cells are free and buildable afterwards. → Task 3 test "a save with fabricators loads without them".
5. The Atomic Printer when every pool is full: it picks oxygen (tie order) and the pool stays at capacity. → Task 3 test "all full: oxygen, clamped".

## File Structure

| File | Responsibility |
|---|---|
| `shared/types.ts` | `BuildingMode`, `BuildingState.mode`, `OffReason "off"`, `BuildingDef.printsLowest`, `ColonistView.workUid`; drop `replicates`, `replicateT`, fabricator events |
| `shared/offReason.ts` (new) | `OFF_REASON_LABEL` — badge labels, shared by render and UI |
| `src/engine/modes.ts` (new) + test | `modesFor`, `productionOrder` |
| `src/engine/printers.ts` (new) + test | `lowestPrintTarget` |
| `src/engine/colony.ts` | `setMode`; load drops fabricators |
| `src/engine/tick.ts` | OFF in power + production passes; FIRST order; Atomic output; no fabricator pass |
| `src/engine/colonists.ts` | `assign()` posts running buildings in production order; `colonistViews` adds `workUid` |
| `src/engine/defs.ts` | printers; no fabricator; ORDER; every `desc` rewritten |
| `src/engine/unlocks.ts` | gates for the printers; `GATE_HINTS` |
| `src/engine/grid.ts` | `rebuildGrid` |
| `src/worker/protocol.ts`, `host.ts`, `bridge.ts` | `setMode` |
| `src/agent/...` | Sentinel feature swap; fabricator lines out; world model `"off"` |
| `src/render/...` | lineage code out; printer models; badge labels from shared |
| `src/ui/buildingFacts.ts` (new) + test | `buildingFacts`, `statusLabel`, `statusLine` |
| `src/ui/components/BuildingCard.vue` (new) | the card |
| `src/ui/...` | store `setMode`; App slot; Inspector hover status; Crew waiting; hints; palette hints from `GATE_HINTS`; FABRICATORS panel, end-screen and audio entries out |
| `e2e/building-card.spec.ts` (new) | end-to-end card checks |

Phases: **1 engine + removal** (Tasks 1–3, main session, serial; typecheck must pass at the end) → **2 helpers** (Task 4, subagent in a hand-made worktree from the branch tip, new files only) in parallel with **Task 5a** (main session: store, hover, crew line) → **3 card + docs + e2e** (Tasks 5b–6) → **4 review + ship** (Task 7).

---

### Task 1: The crew setting's data, validation, and command

**Files:**
- Modify: `shared/types.ts` (after `OffReason`; in `BuildingState`)
- Create: `src/engine/modes.ts`, `src/engine/modes.test.ts`
- Modify: `src/engine/colony.ts` (after `rotateAt`), `src/engine/index.ts`
- Modify: `src/worker/protocol.ts`, `src/worker/host.ts`, `src/worker/bridge.ts`
- Test: `src/worker/host.test.ts`, `src/worker/bridge.test.ts`, `src/net/hostRelay.test.ts`

**Interfaces — Produces:**
```ts
// shared/types.ts
export type BuildingMode = "first" | "normal" | "off";
// BuildingState
mode?: "first" | "off";
// src/engine/modes.ts
export function modesFor(def: BuildingDef): BuildingMode[];
// Colony
setMode(uid: number, mode: BuildingMode): boolean;
// BridgeCore
setMode(uid: number, mode: BuildingMode): void;
```

- [ ] **Step 1: Write the failing tests** (`src/engine/modes.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { Colony } from "./colony";
import { DEFS } from "./defs";
import { modesFor } from "./modes";
import type { ColonyState } from "./state";

const stateOf = (c: Colony) => (c as unknown as { s: ColonyState }).s;

describe("modesFor — which settings a building offers", () => {
  it("offers FIRST / NORMAL / OFF on every building that needs crew", () => {
    for (const id of ["extractor", "awg", "aquifer", "reclaimer", "electrolysis", "greenhouse", "medbay", "reactor", "roboticsbay"]) {
      expect(modesFor(DEFS[id]), id).toEqual(["first", "normal", "off"]);
    }
  });
  it("offers NORMAL / OFF on crewless buildings that draw power", () => {
    for (const id of ["deflector", "printer", "roverbay", "ptp"]) expect(modesFor(DEFS[id]), id).toEqual(["normal", "off"]);
  });
  it("offers nothing on the hub, corridors, habitats, generators, and storage", () => {
    for (const id of ["hub", "corridor", "hab", "solar", "windturbine", "geothermal", "battery", "cistern", "o2tank"]) {
      expect(modesFor(DEFS[id]), id).toEqual([]);
    }
  });
});

describe("Colony.setMode", () => {
  const seed = () => {
    const c = new Colony(7);
    const s = stateOf(c);
    const elec = s.buildings.find((b) => b.defId === "electrolysis")!;
    return { c, s, elec };
  };
  it("stores FIRST and OFF, and clears the field for NORMAL", () => {
    const { c, elec } = seed();
    expect(c.setMode(elec.uid, "first")).toBe(true);
    expect(elec.mode).toBe("first");
    expect(c.setMode(elec.uid, "off")).toBe(true);
    expect(elec.mode).toBe("off");
    expect(c.setMode(elec.uid, "normal")).toBe(true);
    expect("mode" in elec).toBe(false);
  });
  it("rejects an unknown uid (a building demolished a moment ago)", () => {
    const { c, s } = seed();
    const before = JSON.stringify(s.buildings);
    expect(c.setMode(99_999, "off")).toBe(false);
    expect(JSON.stringify(s.buildings)).toBe(before);
  });
  it("rejects a setting the building does not offer", () => {
    const { c, s } = seed();
    const hub = s.buildings.find((b) => b.defId === "hub")!;
    const solar = s.buildings.find((b) => b.defId === "solar")!;
    expect(c.setMode(hub.uid, "off")).toBe(false);
    expect(c.setMode(solar.uid, "first")).toBe(false);
    expect(c.setMode(hub.uid, "banana" as never)).toBe(false);
    expect(hub.mode).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/engine/modes.test.ts` → fails: cannot find module `./modes`.

- [ ] **Step 3: Implement**

`shared/types.ts`, after the `OffReason` type:
```ts
/** the player's crew setting for a building: FIRST is staffed before NORMAL;
 *  OFF does nothing at all (no crew, no power, no output) */
export type BuildingMode = "first" | "normal" | "off";
```
In `BuildingState`, after `offReason`:
```ts
  /** the player's crew setting; undefined means NORMAL, so saves carry only what was set */
  mode?: "first" | "off";
```

`src/engine/modes.ts`:
```ts
/* ============================================================================
   The player's crew setting per building (FIRST / NORMAL / OFF) — which
   settings a def offers, and the order the production pass visits buildings
   in. Pure; shared by the tick, Colony.setMode, and the UI's buttons.
   ============================================================================ */
import type { BuildingDef, BuildingMode } from "@shared/types";

/** FIRST / NORMAL / OFF when the building needs crew; NORMAL / OFF when it draws
 *  power (except the hub, corridors, and housing, which hold the colony
 *  together); nothing for generators and storage */
export function modesFor(def: BuildingDef): BuildingMode[] {
  if (def.staffing > 0) return ["first", "normal", "off"];
  if ((def.consumes.power ?? 0) > 0 && !def.isHub && !def.conduit && !def.popCap) return ["normal", "off"];
  return [];
}
```

`src/engine/colony.ts` — import `modesFor` from `./modes` and `BuildingMode` from `@shared/types`; after `rotateAt`:
```ts
  /** the player's crew setting for one building. False, changing nothing, for
   *  an unknown uid or a setting the building does not offer. */
  setMode(uid: number, mode: BuildingMode): boolean {
    const b = this.s.buildings.find((x) => x.uid === uid);
    const def = b ? DEFS[b.defId] : undefined;
    if (!b || !def || !modesFor(def).includes(mode)) return false;
    if (mode === "normal") delete b.mode;
    else b.mode = mode;
    return true;
  }
```

`src/engine/index.ts`: `export { modesFor } from "./modes";`

`src/worker/protocol.ts` (import `BuildingMode`): add to `Command`
```ts
  // the player's crew setting for one building (FIRST / NORMAL / OFF)
  | { type: "setMode"; uid: number; mode: BuildingMode }
```
`src/worker/host.ts`: `case "setMode": this.colony.setMode(cmd.uid, cmd.mode); break;`
`src/worker/bridge.ts` (import `BuildingMode`), after `move`:
```ts
  /** the player's crew setting for one building */
  setMode(uid: number, mode: BuildingMode): void { this.send({ type: "setMode", uid, mode }); }
```

- [ ] **Step 4: Plumbing tests**

`src/worker/host.test.ts`, in `describe("SimHost")`:
```ts
  it("setMode reaches the colony", () => {
    const host = new SimHost(1);
    const snap = () => (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot;
    const elec = snap().buildings.find((b) => b.defId === "electrolysis")!;
    host.applyCommand({ type: "setMode", uid: elec.uid, mode: "off" });
    expect(snap().buildings.find((b) => b.uid === elec.uid)!.mode).toBe("off");
  });
```
`src/worker/bridge.test.ts`, in `describe("BridgeCore.place")` (rename it `"BridgeCore commands"`):
```ts
  it("setMode sends the uid and the setting", () => {
    const b = new TestBridge();
    b.setMode(7, "first");
    expect(b.sent).toEqual([{ type: "setMode", uid: 7, mode: "first" }]);
  });
```
`src/net/hostRelay.test.ts`: add `{ type: "setMode", uid: 1, mode: "off" }` to the commands the "drops build/sim commands from a guest" test sends, and assert it is not forwarded (follow that test's existing pattern).

- [ ] **Step 5: Run** — `npx vitest run src/engine/modes.test.ts src/worker src/net` → pass; `npm run typecheck` → clean.

- [ ] **Step 6: Commit** — files above; message `feat(engine): a crew setting per building and the setMode command` + the Claude-Session line.

### Task 2: FIRST runs first, OFF does nothing, posts match who runs

**Files:**
- Modify: `shared/types.ts` (`OffReason` + `"off"`; `ColonistView.workUid`)
- Create: `shared/offReason.ts`
- Modify: `src/render/three/badges.ts` (labels from shared, re-exported), `src/ui/components/alerts.ts`, `src/agent/worldmodel/graph.ts`, `src/agent/worldmodel/index.ts`
- Modify: `src/engine/modes.ts` (`productionOrder`), `src/engine/tick.ts`, `src/engine/colonists.ts`
- Test: `src/engine/modes.test.ts`, `src/render/three/badges.test.ts`, `src/ui/components/alerts.test.ts`, `src/agent/worldmodel/worldmodel.test.ts`

**Interfaces — Produces:**
```ts
// shared/offReason.ts
export const OFF_REASON_LABEL: Record<OffReason, string>;
// src/engine/modes.ts
export function productionOrder<B extends { mode?: "first" | "off" }>(buildings: B[]): B[];
// ColonistView
workUid: number | null;
```

- [ ] **Step 1: Failing tests** — append to `src/engine/modes.test.ts`:

```ts
import { productionOrder } from "./modes";

describe("productionOrder", () => {
  it("is the same array when nothing is set to FIRST", () => {
    const list = [{ uid: 1 }, { uid: 2, mode: "off" as const }];
    expect(productionOrder(list)).toBe(list);
  });
  it("puts FIRST buildings first, each group in build order", () => {
    const list = [{ uid: 1 }, { uid: 2, mode: "first" as const }, { uid: 3 }, { uid: 4, mode: "first" as const }];
    expect(productionOrder(list).map((b) => b.uid)).toEqual([2, 4, 1, 3]);
  });
});

describe("crew order in the tick", () => {
  /** the seed colony at noon, pools full, plus two more electrolysis units laid
   *  onto the network, with `labor` workers: staffed buildings in build order are
   *  seed electrolysis, seed extractor, e3, e4 */
  function scene(labor: number) {
    const c = new Colony(7);
    const s = stateOf(c);
    s.tod = 0.5;
    for (const k of ["power", "water", "oxygen", "food"] as const) s.pools[k].amount = s.pools[k].capacity;
    s.materials.amount = 400;
    const hub = s.buildings.find((b) => b.defId === "hub")!;
    // two cells west of the hub's west edge, one above the other: each lays a corridor
    expect(c.place("electrolysis", hub.gx - 3, hub.gy, 0, true)).toBe(true);
    const e3 = s.buildings.filter((b) => b.defId === "electrolysis").at(-1)!;
    expect(c.place("electrolysis", hub.gx - 3, hub.gy + 1, 0, true)).toBe(true);
    const e4 = s.buildings.filter((b) => b.defId === "electrolysis").at(-1)!;
    s.population = labor;
    const e1 = s.buildings.find((b) => b.defId === "electrolysis")!;
    const x2 = s.buildings.find((b) => b.defId === "extractor")!;
    const staffedNow = () => [e1, x2, e3, e4].filter((b) => b.offReason !== "crew" && b.offReason !== "off").map((b) => b.uid);
    return { c, s, e1, x2, e3, e4, staffedNow };
  }

  it("by default staffs the oldest first", () => {
    const { c, e1, x2, staffedNow } = scene(2);
    c.tick(0.1);
    expect(staffedNow()).toEqual([e1.uid, x2.uid]);
  });

  it("a FIRST building is staffed before the rest", () => {
    const { c, e1, e4, staffedNow } = scene(2);
    c.setMode(e4.uid, "first");
    c.tick(0.1);
    expect(staffedNow().sort()).toEqual([e1.uid, e4.uid].sort());
  });

  it("an OFF building takes no worker, runs nothing, and says so", () => {
    const { c, e1, x2, e3, staffedNow } = scene(2);
    c.setMode(e1.uid, "off");
    c.tick(0.1);
    expect(e1.offReason).toBe("off");
    expect(e1.online).toBe(false);
    expect(e1.util).toBe(0);
    expect(staffedNow()).toEqual([x2.uid, e3.uid]);
  });

  it("a FIRST building that cannot run passes its worker on", () => {
    const { c, e1, x2, e4, staffedNow } = scene(2);
    c.setMode(e4.uid, "first");
    e4.integrity = 0.2; // below working integrity: it fails a gate before crew
    c.tick(0.1);
    expect(e4.offReason).toBe("damaged");
    expect(staffedNow().filter((u) => u !== e4.uid)).toEqual([e1.uid, x2.uid]);
  });

  it("OFF takes no power: with power for everything else, everything else runs", () => {
    const { c, s, e1 } = scene(10);
    c.setMode(e1.uid, "off");
    s.tod = 0; // night: no solar
    const dt = 0.1;
    const need = s.buildings
      .filter((b) => b.uid !== e1.uid)
      .reduce((sum, b) => sum + (DEFS[b.defId].consumes.power ?? 0) * dt, 0);
    s.pools.power.amount = need;
    c.tick(dt);
    for (const b of s.buildings) {
      if (b.uid === e1.uid || !(DEFS[b.defId].consumes.power ?? 0)) continue;
      expect(b.offReason, b.defId).not.toBe("power");
    }
  });

  it("an OFF building with no power draw stays offline", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.unlocked.push("reactor");
    s.materials.amount = 400;
    s.tod = 0.5;
    const hub = s.buildings.find((b) => b.defId === "hub")!;
    expect(c.place("reactor", hub.gx - 4, hub.gy - 4)).toBe(true);
    const reactor = s.buildings.at(-1)!;
    c.setMode(reactor.uid, "off");
    c.tick(0.1);
    expect(reactor.online).toBe(false);
    expect(reactor.offReason).toBe("off");
  });

  it("posts colonists only at the buildings that ran, FIRST ones first", () => {
    const { c, s, e1, e4 } = scene(2);
    c.setMode(e4.uid, "first");
    c.tick(0.1);
    const posted = s.colonists.map((k) => k.workUid).filter((u): u is number => u != null).sort();
    expect(posted).toEqual([e1.uid, e4.uid].sort());
  });

  it("stays deterministic with settings in play", () => {
    const run = () => {
      const { c, e4, e1 } = scene(2);
      c.setMode(e4.uid, "first");
      c.setMode(e1.uid, "off");
      for (let i = 0; i < 300; i++) c.tick(0.2);
      return JSON.stringify(c.serialize());
    };
    expect(run()).toBe(run());
  });
});

describe("the setting in saves", () => {
  it("round-trips, and a save without it loads as NORMAL", () => {
    const c = new Colony(7);
    const elec = stateOf(c).buildings.find((b) => b.defId === "electrolysis")!;
    c.setMode(elec.uid, "first");
    const data = c.serialize();
    expect(stateOf(Colony.load(data)).buildings.find((b) => b.uid === elec.uid)!.mode).toBe("first");
    delete data.state.buildings.find((b) => b.uid === elec.uid)!.mode;
    expect(stateOf(Colony.load(data)).buildings.find((b) => b.uid === elec.uid)!.mode).toBeUndefined();
  });
});
```

If `scene()`'s placements do not fit the seed layout (the test asserts `place` returned true), move them to other empty cells beside the base; the assertions do not depend on the exact cells, only on build order and connection.

`src/render/three/badges.test.ts`: extend the `OFF_REASON_LABEL` test's expected object with `off: "OFF"`.
`src/ui/components/alerts.test.ts`: `it("ignores OFF, the player's choice", () => expect(faultAlerts([bld(1, "hab", "off")])).toEqual([]));`
`src/agent/worldmodel/worldmodel.test.ts`: add `["off", "off", "is switched off"]` to the `it.each` table.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/engine/modes.test.ts` fails (`productionOrder` missing; order unchanged).

- [ ] **Step 3: Implement**

`shared/types.ts`: `export type OffReason = "power" | "damaged" | "faulted" | "seal" | "crew" | "water" | "oxygen" | "food" | "off";` and update its doc comment ("… then a missing input; `off` when the player switched it off"). `ColonistView` gains:
```ts
  /** the building this colonist is posted to this tick (a running staffed building), or null */
  workUid: number | null;
```

`shared/offReason.ts`:
```ts
/* The label each reason a building is off wears — on its badge, its card, and
   the hover chip. Display copy shared by the renderer and the UI. */
import type { OffReason } from "./types";

export const OFF_REASON_LABEL: Record<OffReason, string> = {
  power: "NO POWER",
  damaged: "DAMAGED",
  faulted: "FLARE FAULT",
  seal: "NO SEAL",
  crew: "NO CREW",
  water: "NO WATER",
  oxygen: "NO OXYGEN",
  food: "NO FOOD",
  off: "OFF",
};
```
`src/render/three/badges.ts`: delete its local map; `import { OFF_REASON_LABEL } from "@shared/offReason";` and `export { OFF_REASON_LABEL };`.

`src/ui/components/alerts.ts`: `type FaultReason = Exclude<OffReason, "power" | "off">;` and in `faultAlerts` skip `reason === "off"` beside `"power"` (update the doc comment: OFF is the player's choice).

`src/agent/worldmodel/graph.ts`: `FailReason` gains `| "off" // switched off by the player`; `fromOffReason` gains `case "off": return { reason: "off" };` before `default`. `src/agent/worldmodel/index.ts`: add `: f.reason === "off" ? "is switched off"` to the prose chain.

`src/engine/modes.ts`:
```ts
/** the order the production pass (and the crew posting after it) visits
 *  buildings: FIRST ones, then the rest, each in build order. The same array
 *  when nothing is set to FIRST, so a colony without settings runs as before. */
export function productionOrder<B extends { mode?: "first" | "off" }>(buildings: B[]): B[] {
  if (!buildings.some((b) => b.mode === "first")) return buildings;
  return [...buildings.filter((b) => b.mode === "first"), ...buildings.filter((b) => b.mode !== "first")];
}
```

`src/engine/tick.ts` (import `productionOrder`):
- pass 3: `.filter((b) => b.mode !== "off" && powerNeed(b, mods) > 0)`; the no-draw loop becomes `for (const b of s.buildings) if (b.mode !== "off" && !(powerNeed(b, mods) > 0)) b.online = true;`
- pass 4: `for (const b of productionOrder(s.buildings)) {` and, right after the resets and `const d = …`:
```ts
    if (b.mode === "off") { b.online = false; b.offReason = "off"; continue; } // the player switched it off
```
- update the pass-4 comment: FIRST buildings are visited first; OFF ones are skipped.

`src/engine/colonists.ts`, `assign()` — replace the slot loop and its doc comment:
```ts
/** Posts come from the staffed buildings that ran this tick, in the order the
 *  production pass staffed them (FIRST ones first), so the colonist posted to a
 *  building is the one running it; pass 1 hands each post the lowest-id
 *  unclaimed colonist whose role matches, pass 2 backfills in id order. The
 *  injured are off shift — eligible for neither pass. Surplus colonists idle at a hab. */
function assign(s: ColonyState): void {
  const slots: { uid: number; defId: string }[] = [];
  for (const b of productionOrder(s.buildings)) {
    const d = DEFS[b.defId];
    if (!d || d.staffing <= 0 || !b.online || !b.staffed || !b.fed) continue;
    for (let k = 0; k < d.staffing; k++) slots.push({ uid: b.uid, defId: b.defId });
  }
  const byUid = [...s.buildings].sort((a, b) => a.uid - b.uid);
  const habs = byUid.filter((b) => (DEFS[b.defId]?.popCap ?? 0) > 0);
  // …the rest of assign() unchanged
```
`colonistViews`: add `workUid: c.workUid ?? null,`.

- [ ] **Step 4: Run** — `npx vitest run src/engine src/agent src/render/three/badges.test.ts src/ui/components/alerts.test.ts` → pass; `npm run typecheck` → clean; `npm test` → all pass. If a roster test that pinned the old posting fails, confirm the failing case posts a colonist to a building that did not run, update its expectation, and note the ruling in a comment.

- [ ] **Step 5: Commit** — `feat(engine): FIRST buildings get crew first, OFF ones do nothing` + the Claude-Session line.

### Task 3: Printers replace the Fabricator

**Files:**
- Modify: `shared/types.ts` (`printsLowest`; delete `replicates`, `replicateT`, `"fabricator_ready"`, `"fabricator_stalled"`)
- Create: `src/engine/printers.ts`, `src/engine/printers.test.ts`
- Modify: `src/engine/defs.ts`, `src/engine/tick.ts`, `src/engine/unlocks.ts`, `src/engine/tuning.ts`, `src/engine/grid.ts`, `src/engine/colony.ts`
- Delete: `src/engine/fabricator.ts`, `src/engine/fabricator.test.ts`
- Modify: `src/agent/sentinel/features.ts`, `src/agent/lines.ts`, `src/ui/audio/map.ts`, `src/ui/components/EndScreen.vue`, `src/ui/components/ResourceRail.vue`, `src/ui/hints.ts`, `src/ui/components/Palette.vue`, `src/render/renderer.ts`, `src/render/three/kit/index.ts`, `src/render/three/kit/facility.ts`
- Test: `src/engine/unlocks.test.ts`, `src/agent/sentinel/sentinel.test.ts`, `src/ui/audio/map.test.ts`, `src/agent/council/council.test.ts`, `src/render/three/kit/facility.test.ts`, `src/engine/generation.test.ts`

**Interfaces — Produces:**
```ts
// BuildingDef
printsLowest?: { oxygen: number; water: number; food: number; materials: number };
// src/engine/printers.ts
export type PrintTarget = "oxygen" | "water" | "food" | "materials";
export function lowestPrintTarget(s: Pick<ColonyState, "pools" | "materials">): PrintTarget;
// src/engine/unlocks.ts
export const GATE_HINTS: Record<string, string>;
// src/engine/grid.ts
export function rebuildGrid(s: ColonyState): void;
```

- [ ] **Step 1: Failing tests** (`src/engine/printers.test.ts`)

```ts
import { describe, expect, it } from "vitest";
import { Colony } from "./colony";
import { DEFS } from "./defs";
import { lowestPrintTarget } from "./printers";
import { moraleMult } from "./morale";
import type { ColonyState } from "./state";

const stateOf = (c: Colony) => (c as unknown as { s: ColonyState }).s;
const fill = (s: ColonyState, o: number, w: number, f: number, m: number) => {
  s.pools.oxygen.amount = s.pools.oxygen.capacity * o;
  s.pools.water.amount = s.pools.water.capacity * w;
  s.pools.food.amount = s.pools.food.capacity * f;
  s.materials.amount = s.materials.capacity * m;
};

describe("lowestPrintTarget", () => {
  it("picks the pool lowest as a share of its capacity", () => {
    const s = stateOf(new Colony(7));
    fill(s, 0.9, 0.2, 0.5, 0.7);
    expect(lowestPrintTarget(s)).toBe("water");
    fill(s, 0.9, 0.9, 0.9, 0.1);
    expect(lowestPrintTarget(s)).toBe("materials");
  });
  it("breaks ties oxygen, water, food, materials", () => {
    const s = stateOf(new Colony(7));
    fill(s, 0.5, 0.5, 0.5, 0.5);
    expect(lowestPrintTarget(s)).toBe("oxygen");
    fill(s, 0.9, 0.5, 0.5, 0.5);
    expect(lowestPrintTarget(s)).toBe("water");
  });
  it("counts a pool with no capacity as full", () => {
    const s = stateOf(new Colony(7));
    fill(s, 0.5, 0.5, 0.5, 0.5);
    s.pools.oxygen.capacity = 0;
    expect(lowestPrintTarget(s)).toBe("water");
  });
});

describe("the printers in the tick", () => {
  /** a colony at noon with plenty of power, and a printer of `defId` placed and unlocked */
  function withPrinter(defId: string) {
    const c = new Colony(7);
    const s = stateOf(c);
    s.unlocked.push(defId);
    s.materials.amount = 300;
    s.tod = 0.5;
    s.pools.power.amount = s.pools.power.capacity;
    const hub = s.buildings.find((b) => b.defId === "hub")!;
    expect(c.place(defId, hub.gx - 5, hub.gy - 5)).toBe(true);
    return { c, s, printer: s.buildings.at(-1)! };
  }

  it("the Bio Printer turns water into food with no crew", () => {
    const { c, s, printer } = withPrinter("bioprinter");
    s.population = 0; // nobody to staff anything
    s.pools.water.amount = s.pools.water.capacity;
    s.pools.food.amount = 0;
    c.tick(0.2);
    expect(printer.util).toBe(1);
    expect(s.pools.food.amount).toBeGreaterThan(0);
    expect(DEFS.bioprinter).toMatchObject({ staffing: 0, consumes: { power: 8, water: 2 }, produces: { food: 3 } });
  });

  it("the Atomic Printer makes the lowest resource, scaled by morale", () => {
    // the same colony with and without it: the difference in water flow is its output
    const flowWater = (withAtomic: boolean) => {
      const { c, s, printer } = withPrinter("atomic");
      if (!withAtomic) c.removeAt(printer.gx, printer.gy);
      fill(s, 0.9, 0.1, 0.9, 0.9); // water is lowest
      const eff = moraleMult(s);
      c.tick(0.2);
      return { water: s.flow.water, eff };
    };
    const a = flowWater(false);
    const b = flowWater(true);
    expect(b.water - a.water).toBeCloseTo(DEFS.atomic.printsLowest!.water * b.eff, 6);
  });

  it("all full: it picks oxygen and the pool stays at capacity", () => {
    const { c, s } = withPrinter("atomic");
    fill(s, 1, 1, 1, 1);
    c.tick(0.2);
    expect(s.pools.oxygen.amount).toBeLessThanOrEqual(s.pools.oxygen.capacity);
  });

  it("unlocks: Bio with a Hydroponics or at sol 6; Atomic with a reactor", async () => {
    const { GATES } = await import("./unlocks");
    const s = stateOf(new Colony(7));
    expect(GATES.bioprinter(s)).toBe(false);
    s.sol = 6;
    expect(GATES.bioprinter(s)).toBe(true);
    s.sol = 1;
    s.buildings.push({ ...s.buildings[0], uid: 900, defId: "greenhouse" });
    expect(GATES.bioprinter(s)).toBe(true);
    expect(GATES.atomic(s)).toBe(false);
    s.buildings.push({ ...s.buildings[0], uid: 901, defId: "reactor" });
    expect(GATES.atomic(s)).toBe(true);
  });
});

describe("the Fabricator is gone", () => {
  it("has no def and no gate", async () => {
    const { GATES } = await import("./unlocks");
    expect(DEFS.fabricator).toBeUndefined();
    expect("fabricator" in GATES).toBe(false);
  });

  it("a save with fabricators loads without them: cells free, no refund, not unlocked", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    const data = c.serialize();
    const hub = s.buildings.find((b) => b.defId === "hub")!;
    const cell = { gx: hub.gx - 6, gy: hub.gy - 6 };
    data.state.buildings.push({ ...data.state.buildings[0], uid: 950, defId: "fabricator", gx: cell.gx, gy: cell.gy, replicateT: 12 } as never);
    (data.state.grid as unknown as number[])[cell.gy * data.state.N + cell.gx] = 950;
    data.state.unlocked.push("fabricator");
    const materials = data.state.materials.amount;
    const loaded = Colony.load(data);
    const ls = stateOf(loaded);
    expect(ls.buildings.some((b) => b.defId === "fabricator")).toBe(false);
    expect(ls.grid[cell.gy * ls.N + cell.gx]).toBe(0);
    expect(ls.unlocked).not.toContain("fabricator");
    expect(ls.materials.amount).toBe(materials);
    expect(ls.buildings.every((b) => !("replicateT" in b))).toBe(true);
    ls.materials.amount = 100;
    expect(loaded.place("battery", cell.gx, cell.gy)).toBe(true); // the cell is buildable
  });
});
```

If `serialize()` stores `grid` as a typed array, set the cell through `data.state.grid[...] = 950` (both work on arrays and typed arrays); keep the assertion that it is 0 after load.

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/engine/printers.test.ts` fails (module missing).

- [ ] **Step 3: Engine implementation**

`shared/types.ts`: delete the `replicates` field and its comment, the `replicateT` field and its comment, and the two fabricator event types with their comments. Add to `BuildingDef` after `producesMat`:
```ts
  /** the Atomic Printer: each tick, output this rate of whichever listed
   *  resource is lowest as a share of its capacity (ties in listed order) —
   *  pass 4, × eff, like produces / producesMat */
  printsLowest?: { oxygen: number; water: number; food: number; materials: number };
```

`src/engine/printers.ts`:
```ts
/* ============================================================================
   The Atomic Printer's choice: whichever of oxygen, water, food, or materials
   is lowest as a share of its capacity (ties in that order; a pool with no
   capacity counts as full). Pure, no RNG.
   ============================================================================ */
import type { ColonyState } from "./state";

export type PrintTarget = "oxygen" | "water" | "food" | "materials";
const ORDER: readonly PrintTarget[] = ["oxygen", "water", "food", "materials"];

export function lowestPrintTarget(s: Pick<ColonyState, "pools" | "materials">): PrintTarget {
  let best: PrintTarget = ORDER[0];
  let bestFill = Infinity;
  for (const k of ORDER) {
    const p = k === "materials" ? s.materials : s.pools[k];
    const f = p.capacity > 0 ? p.amount / p.capacity : Infinity;
    if (f < bestFill) { bestFill = f; best = k; }
  }
  return best;
}
```

`src/engine/defs.ts`: remove the `FAB_*` import; replace the `printer` entry's `name`, `glyph`, and `desc` (name "3D Printer", glyph "3DP"); delete the `fabricator` entry; add after `printer`:
```ts
  bioprinter: {
    id: "bioprinter", name: "Bio Printer", glyph: "BIO",
    foot: [1, 1], h: 18, color: "#3d4a3a",
    cost: { power: 0 }, matCost: 35,
    staffing: 0, consumes: { power: 8, water: 2 }, produces: { food: 3 },
    requiresPressure: false, priority: 28,
    desc: "<Bio Printer row of the spec's Descriptions table>",
  },
  atomic: {
    id: "atomic", name: "Atomic Printer", glyph: "ATM",
    foot: [2, 2], h: 24, color: "#3a3850",
    cost: { power: 0 }, matCost: 120,
    staffing: 0, consumes: { power: 30 }, produces: {},
    printsLowest: { oxygen: 6, water: 8, food: 4, materials: 1 },
    requiresPressure: false, priority: 10,
    desc: "<Atomic Printer row of the spec's Descriptions table>",
  },
```
(the `desc` placeholders above mean: paste that row's text verbatim). Replace every def's `desc` with its row from the spec's table. `ORDER`: replace `"printer", "roverbay", "roboticsbay", "fabricator", "ptp"` with `"printer", "bioprinter", "atomic", "roverbay", "roboticsbay", "ptp"`.

`src/engine/tick.ts`: delete the `updateFabricatorReplication` import and call (and its comment); import `lowestPrintTarget`; in pass 4 after the `producesMat` block:
```ts
    if (d.printsLowest) {
      const target = lowestPrintTarget(s);
      if (target === "materials") {
        s.materials.amount = Math.min(s.materials.capacity, s.materials.amount + d.printsLowest.materials * eff * dt);
      } else {
        addPool(s, target, d.printsLowest[target] * eff * dt);
        net[target] += d.printsLowest[target] * eff;
      }
    }
```

`src/engine/unlocks.ts`: delete the `fabricator` gate and its comment; add
```ts
  // a crewless food source for colonies short of hands: open once Hydroponics
  // is known, or by sol 6
  bioprinter: (s) => s.sol >= 6 || s.buildings.some((b) => b.defId === "greenhouse"),
  // power into whatever is running out: a reactor-era machine
  atomic: (s) => s.buildings.some((b) => b.defId === "reactor"),
```
and after `GATES`:
```ts
/** each gate, as the palette's locked tooltip says it — kept beside the rules
 *  so the two change together */
export const GATE_HINTS: Record<string, string> = {
  windturbine: "sol 4, or survive a dust storm",
  geothermal: "sol 6",
  reactor: "population 8 + 150 materials",
  printer: "population 6",
  roverbay: "sol 3, or stockpile 80 materials",
  roboticsbay: "build a reactor, or population 10 + 200 materials",
  awg: "sol 5, or population 6",
  aquifer: "sol 8 — must sit on an aquifer site",
  reclaimer: "population 6, or build a Hydroponics",
  bioprinter: "sol 6, or build a Hydroponics",
  atomic: "build a Fission Reactor",
  ptp: "prove the outpost, build a reactor, and reach 12 colonists",
};
```

`src/engine/tuning.ts`: delete `FAB_BUILD_S`, `FAB_MAT_COST`, `FAB_MAX_LINEAGE` and their block comment. Delete `src/engine/fabricator.ts` and `src/engine/fabricator.test.ts` (`git rm`).

`src/engine/grid.ts`:
```ts
/** rebuild the occupancy grid from the building list (cells outside the grid
 *  and buildings of unknown defs are skipped) */
export function rebuildGrid(s: ColonyState): void {
  s.grid.fill(0);
  for (const b of s.buildings) {
    const def = DEFS[b.defId];
    if (!def) continue;
    for (const [x, y] of cellsFor(def, b.gx, b.gy)) if (inBounds(s.N, x, y)) s.grid[idx(s.N, x, y)] = b.uid;
  }
}
```
and in `migrateGrid`, after creating the new grid of `newN`, assign it and call `rebuildGrid(s)` instead of the inline loop (same behaviour).

`src/engine/colony.ts`, in `Colony.load`, right after `c.s = { … }` (before the vent/aquifer backfill):
```ts
    // the Fabricator was removed (2026-09): drop any a save still holds, with no refund
    if (c.s.buildings.some((b) => b.defId === "fabricator")) {
      c.s.buildings = c.s.buildings.filter((b) => b.defId !== "fabricator");
      rebuildGrid(c.s);
    }
    c.s.unlocked = c.s.unlocked.filter((id) => id !== "fabricator");
    for (const b of c.s.buildings) delete (b as { replicateT?: number }).replicateT;
```

- [ ] **Step 4: Main-thread removal**

- `src/agent/sentinel/features.ts`: label `"the crew at work"` replaces `"the fabricators"`; value `const atWork = s.labor > 0 ? clamp01(s.laborUsed / s.labor) : 0;` replaces `fabs`; update the comment. Update `sentinel.test.ts`'s index-10 test to: the feature is `laborUsed / labor`, 0 with no labor, and the vector has 11 entries.
- `src/agent/lines.ts`: delete the `fabricator_ready` / `fabricator_stalled` entries (severity map and line banks). `council.test.ts`: remove the two event types from its lists and delete the stalled-line test.
- `src/ui/audio/map.ts`: delete the `fabricator_ready` entry; `map.test.ts`: delete the two fabricator rows.
- `src/ui/components/EndScreen.vue`: delete the `fabricator_ready` tally entry.
- `src/ui/components/ResourceRail.vue`: delete the FABRICATORS block, its computeds, and the `Tuning` import if unused.
- `src/ui/hints.ts`: remove `"unlock_fabricator"` from `HintId` and `HINTS`; add `"unlock_bioprinter" | "unlock_atomic"` and entries:
  - `unlock_bioprinter`: title `"NEW SCHEMATIC: BIO PRINTER"`, body `"Makes food from water with power and no crew. Less food per watt than Hydroponics, but it runs when your colonists are busy."`
  - `unlock_atomic`: title `"NEW SCHEMATIC: ATOMIC PRINTER"`, body `"Turns a lot of power into whichever of oxygen, water, food, or materials is lowest. Feed it from the reactor; it is the first thing cut in a brownout."`
  - `unlock_printer`: title `"NEW SCHEMATIC: 3D PRINTER"`, body `"Turns regolith into building materials with power, so your colonists spend less time in the ore field."`
- `src/ui/components/Palette.vue`: delete `UNLOCK_HINTS` and its comment; `import { GATE_HINTS } from "@/engine/unlocks";` and use `GATE_HINTS[hovered.id]`.
- `src/render/renderer.ts`: delete the fabricator count, `lineageFull`, the `replicates` fill branch, and `FAB_MAX_LINEAGE` from the tuning import; `fill` becomes the battery charge only and `working` becomes `st.alive && (b.defId !== "roboticsbay" || snap.robots.length < ROBOT_CAP)`.
- `src/render/three/kit/index.ts`: route `printer`, `bioprinter`, `atomic`, `roverbay`, `roboticsbay`, `reclaimer` to `buildFacility`.
- `src/render/three/kit/facility.ts`: kind union `"printer" | "roverbay" | "roboticsbay" | "atomic"`; `specFor`: `"bioprinter"` → `{ kind: "printer", metal: "#6f8a6a" }`, `"atomic"` → `{ kind: "atomic", metal: "#6e6a8a" }`; rename the fabricator branch to `atomic`, scale its fixed `cell * …` sizes by `Math.min(w, d)` so a 2×2 reads right, and make its four front segments chase like the printer's (there is no progress to gauge); drop every `fill`-gauge special case; update the header comment. `facility.test.ts`: replace the fabricator cases with atomic ones (the extruder part still moves while working; the segments chase while alive and dim when not) and add a bioprinter case (builds the printer body).
- `src/engine/generation.test.ts`: fix any assertion that names the printer "Materials Printer" or pins `ORDER` past `printer`.

- [ ] **Step 5: Run** — `npx vitest run src/engine/printers.test.ts` → pass; `npm run typecheck` → clean; `npm test` → all pass.

- [ ] **Step 6: Commit** — `feat: 3D, Bio, and Atomic printers replace the Fabricator` (body: printers, the removal list, saves drop fabricators without a refund) + the Claude-Session line.

**Phase 1 checkpoint:** `npm run typecheck && npm test && npm run build`; read `git diff` for Tasks 1–3.

### Task 4 (subagent): Building facts and status text (pure)

**Files:** create `src/ui/buildingFacts.ts`, `src/ui/buildingFacts.test.ts`. Touch nothing else.

**Interfaces — Consumes:** `BuildingDef`, `BuildingState`, `Snapshot`, `OffReason` (`@shared/types`); `OFF_REASON_LABEL` (`@shared/offReason`); `modesFor` (`@/engine`); `BUILDING_ROLE` (`@/engine/roster`); `ColonistView.workUid`. **Produces:**
```ts
export interface BuildingFacts { makes: string[]; uses: string[]; needs: string[] }
export function buildingFacts(def: BuildingDef): BuildingFacts;
export function statusLabel(b: BuildingState): string | null;
export function statusLine(b: BuildingState, snap: Snapshot): string | null;
```

Rules:
- Numbers: `n` formatted with up to two decimals, trailing zeros dropped (`5`, `0.4`, `0.35`).
- `makes`: each `produces` as `"<n> <res>/s"`; `producesMat` as `"<n> materials/s"`; `solar` as `"up to <n> power/s in full sun"`; `wind` as `"up to <n> power/s in full wind"`; `steady` as `"<n> power/s, day and night"`; `printsLowest` as `"the lowest of <o> oxygen/s, <w> water/s, <f> food/s, or <m> materials/s"`; each `caps` as `"stores <n> <res>"`; `popCap` as `"beds for <n>"`; `reclaim` as `"returns <frac×100>% of the water the colony uses, up to <max>/s"`.
- `uses`: each `consumes` as `"<n> <res>/s"`.
- `needs`: `staffing > 0` → `"<n> crew"`, followed by a role note when `BUILDING_ROLE[def.id]` exists: `"a <role> makes 25% more"` if the def has `produces` or `producesMat`, `"a medic heals faster"` for `medbay`, nothing otherwise; `requiresPressure` → `"the pressure seal"`; `needsVent` → `"a vent"`; `needsAquifer` → `"an aquifer site"`.
- `statusLabel`: `OFF_REASON_LABEL[b.offReason]` when set; else `"WORKING"` when the def has `modesFor(def).length > 0` or `solar`/`wind`/`steady`; else `null`.
- `statusLine`: `null` when `statusLabel` is null. By reason: `crew` → `"no free colonist (<laborUsed> of <labor> busy)"`; `power` → `"not enough power"`; `seal` → `"cut off from the pressure network"`; `damaged` → `"damaged · repairs itself over time"`; `faulted` → `"flare fault · electronics recovering"`; `water`/`oxygen`/`food` → `"out of <reason>"`; `off` → `"switched off"`. Working: for a staffed def, the colonist whose `workUid === b.uid` → `"working · <name>, <role>"`, plus `", +25%"` when their role matches `BUILDING_ROLE[def.id]` and the def has `produces` or `producesMat`; `"working"` when nobody is posted there or the def has no crew.

Tests: `buildingFacts` for hydroponics (makes food and oxygen, uses power and water, needs 1 crew + botanist note + seal), solar, battery (stores), habitat (beds), the aquifer well (aquifer site), the medbay (medic note), the robotics bay (no role note), and the Atomic Printer (the lowest-of line). `statusLabel` for an off reason, a working recipe building, a generator, and a battery (null). `statusLine` for every reason, for working with a matching botanist (`+25%`), a non-matching colonist, and no colonist. Build snapshots with a small helper (only the fields read: `labor`, `laborUsed`, `colonists`).

Verify `npx vitest run src/ui/buildingFacts.test.ts` and `npm run typecheck`. Commit `feat(ui): building facts and status text from the game's data` + the Claude-Session line.

### Task 5: The card and its wiring (main session)

**Files:** `src/ui/stores/colony.ts`, `src/render/three/placement.ts` (+ test), `src/ui/components/Inspector.vue`, `src/ui/components/Crew.vue`, `src/ui/components/BuildingCard.vue` (new), `src/ui/App.vue`, `src/ui/style/hud.css`.

- **5a (parallel with Task 4):**
  - Store: `controls.setMode(uid: number, mode: BuildingMode): void` — `if (!capabilities.value.canBuild) return; audio.uiTick(); bridge?.setMode(uid, mode);`
  - `placement.ts`: `HoverInfo` gains `uid?: number`; `emitHover` includes `b?.uid` in the info and the dedupe key. Update the placement test that asserts hover payloads, if any.
  - `Crew.vue`: `const waiting = computed(() => s.value?.buildings.filter((b) => b.offReason === "crew").length ?? 0);` and after `/{{ s.labor }} assigned` render `<span v-if="waiting" class="crew-sub"> · {{ waiting }} waiting</span>`.
  - Commit `feat(ui): setMode control, hover carries the building, labor shows who is waiting` + the Claude-Session line.
- **5b (after Task 4 merges):**
  - `BuildingCard.vue`: shown when `selected` is set, `capabilities.canBuild`, and the building exists in `snapshot`; content per the spec (name + status label; `def.desc`; makes/uses/needs lines, each omitted when empty; the now line when non-null; buttons from `modesFor(def)`: FIRST / NORMAL / OFF, or ON (sends `"normal"`) / OFF; the current setting has `aria-pressed="true"`; the group has `aria-label="Crew setting"`). Style: the right-column panel look (`var(--panel)`, hairline border, 11px mono, cyan setting buttons, rust status when off).
  - `App.vue`: `<BuildingCard />` in `.right-col` after `<Alerts />`.
  - `Inspector.vue`: hover chip for a placed building adds `· <statusLabel>` when non-null (find the building by `hover.uid` in `snapshot`).
  - Playwright check: select the seed electrolysis, see the card; press OFF, see the OFF badge; press NORMAL.
  - Commit `feat(ui): a card for the selected building` + the Claude-Session line.

### Task 6: Docs and e2e (main session)

- `docs/gameplay.md`: a "Crew" section (FIRST / NORMAL / OFF, the card, who gets crew); printers in the building order and the palette table; drop the Fabricator.
- `docs/engine.md`: the building table gains AWG, Aquifer Well, Water Reclaimer, the three printers, and the Transport Pod; the tick's pass-4 text notes FIRST order and OFF; replace the Fabricator prose with the printers (`printsLowest`); `modes.ts`.
- `docs/rendering.md`: the facility kit's printer and atomic variants.
- `CLAUDE.md`: the homeostasis bullet's Fabricator description becomes the printers; mention the crew setting (`BuildingState.mode`, `modesFor`, `productionOrder`, `setMode`); the Sentinel's feature 10 is the crew at work.
- `docs/add-ons/fabricator-spec.md`: a first line "Removed 2026-09-26: replaced by the 3D, Bio, and Atomic printers (docs/superpowers/specs/2026-09-26-crew-printers-building-info-design.md)."
- `docs/README.md`: add the spec row.
- `e2e/building-card.spec.ts` (desktop only): start a colony (paused); click the seed electrolysis cell through the canvas with the loop frozen; the card shows "ELECTROLYSIS UNIT" and a makes line; press OFF → `bridge.latest` building `mode === "off"` after a tick (unpause briefly) and its `offReason === "off"`, a visible OFF badge, and no "OFF" HUD fault line; press FIRST → `mode === "first"`; the palette has no Fabricator tile and has Bio Printer and Atomic Printer tiles.
- Commit `docs: crew settings, printers, and the building card` and `test(e2e): the building card and crew setting` + the Claude-Session line.

**Phase 3 checkpoint:** typecheck, full tests, build, full e2e locally; read the diff.

### Task 7: Review and ship

- Adversarial review: two reviewers (engine; main thread) against the spec, this plan, and the diff; confirm each finding in code; one fix wave.
- Final audit: read the full diff; run typecheck, tests, build, build:egg, server:build, full e2e.
- Ship: push `main`; wait for CI green; `gh workflow run sync-vivarium.yml -R BradA1878/bradanderson.org`; confirm the pin and that the live renderer chunk contains a string only this build has (e.g. `atomic`'s kit name `facility:atomic`).
