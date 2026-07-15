# Fabricator — Design & Requirements Spec

**Working title:** Fabricator (rename freely; `FAB` fits the existing three-letter glyph convention with no collisions)
**One-liner:** A building that builds a copy of a target building on completion, including a copy of itself. Point it at itself and it replicates.
**Baseline:** VIVARIUM as it exists today, confirmed against the live repo, not the planning doc. `docs/planning/vivarium-design.md` predates most of what this spec builds on. Specifically: the 11-pass deterministic tick (`engine/tick.ts`), the Rover Bay / Robotics Bay countdown-fabrication pattern (`engine/rover.ts`, `engine/robots.ts`), the causal world model (`agent/worldmodel/graph.ts`), the Sentinel autoencoder (`agent/sentinel/features.ts`), the Director (`agent/director/director.ts`, `scoring.ts`), and the Council (`agent/council/watcher.ts`, `agent/lines.ts`).

---

## 0. Vision

Buildings are already data (`engine/defs.ts`) run by a generic engine that has no idea what a greenhouse is. That's most of the genotype/phenotype split a self-replicator needs. This spec doesn't add a new subsystem — it generalizes one that already exists twice: the Rover Bay and Robotics Bay both fabricate a unit on a materials-gated countdown. The Fabricator does the same thing, except the thing it fabricates is a placed `BuildingState` rather than a mobile actor, and the target can be its own `defId`. Self-targeting is the whole mechanic.

## 1. Goals

- A building that autonomously constructs a copy of a target `BuildingDef` (including itself) on the grid, gated by materials and power exactly like every other building.
- Growth that self-limits from things that already exist — the finite `GRID_N=25` grid, the power-priority brownout system — rather than a bespoke throttle.
- Player retains a kill switch for free: `remove` already works on any `BuildingState`.
- Reuse existing generic mechanisms (world model, Sentinel, Director, Council) wherever they're already generic enough to absorb this. Where they aren't, say so precisely instead of hand-waving it as "the AI will just know."

## 2. Non-goals (v1)

- Not a literal 29-state von Neumann CA. This runs on the existing recipe engine, in the spirit of Langton/Evoloop-style abstraction, not a CA reimplementation.
- Not extending `HazardKind`. "The Director becomes a rogue Fabricator lineage" was my framing in conversation before I'd read `director.ts` — `Director.decide()` only ever returns a kind from the existing closed union (`dust | meteor | flare | coldsnap | quake`). Adding a new kind touches hazard scheduling, the `HAZARD_WARN` banks, and telegraph/active rendering. Real work, correctly a separate epic. Flagged in §11 as a Phase 3 idea, not committed.
- Not extending `diagnoseShortfall()` to trace materials-pool causality. Materials is a `Pool`, not a tracked `Resource` (`power | water | oxygen | food`) — it's outside the causal graph entirely today. Noted in §9, not solved here.
- No mutation/evolution on `replicates.targetDefId`. A natural v2 hook (Evoloop's whole trick is copy errors accumulating into selection), but v1 ships exact copies.

## 3. Core mechanic

One new optional `BuildingDef` field:

```typescript
// shared/types.ts, on BuildingDef
/** on completion, places a copy of DEFS[targetDefId] in an adjacent valid cell.
 *  Mirrors the Rover Bay / Robotics Bay countdown pattern, but the output is a
 *  placed BuildingState, not a mobile actor. targetDefId === own id → replication. */
replicates?: {
  targetDefId: string;
  buildS: number;
  matCost: number;
};
```

The Fabricator def sets `replicates.targetDefId: "fabricator"`. Nothing else about the field is Fabricator-specific — any building could theoretically get a `replicates` block pointed at something else. v1 ships exactly one new def.

Same idioms as `robots.ts`, deliberately:

- Countdown pauses while unpowered or unstaffed. Never resets.
- The materials fee is charged **at completion**, not at start. An unaffordable copy holds at zero until the stock covers it — same as an unaffordable robot chassis.
- No RNG anywhere in the new code path.

**Where it diverges from the Rover/Robot precedent, and why it has to:** `roverFab` and `robotFab` are single colony-wide scalars on `ColonyState`, because there's one shared fleet cap (1 rover, 3 robots) regardless of how many bays exist. That doesn't work here — the entire point is N independent lineages ticking independently, which is what makes growth exponential instead of linear. So the countdown has to live **per instance**, not colony-wide:

```typescript
// shared/types.ts, on BuildingState
/** seconds until this instance's replication completes; undefined until it
 *  first starts. Per-instance (unlike roverFab/robotFab), because each
 *  Fabricator lineage ticks independently — that's what makes growth
 *  exponential rather than linear. */
replicateT?: number;
```

## 4. Engine integration

New file `engine/fabricator.ts`, same shape as `robots.ts`:

```typescript
const FAB_ID = "fabricator";

export function updateFabricatorReplication(s: ColonyState, dt: number, emit: Emit): void {
  const lineage = s.buildings.filter((b) => b.defId === FAB_ID);
  if (lineage.length >= FAB_MAX_LINEAGE) return; // colony-wide safety valve

  for (const b of lineage) {
    const def = DEFS[b.defId];
    const rep = def.replicates;
    if (!rep) continue;
    if (!b.online || !buildingFunctional(b)) continue;
    if (def.staffing > 0 && !b.staffed) continue; // see §12 — proposing staffing: 0

    b.replicateT = (b.replicateT ?? rep.buildS) - dt;
    if (b.replicateT > 0) continue;

    if (s.materials.amount < rep.matCost) continue; // holds at zero, like the robot fee

    const site = findAdjacentSite(s, b, DEFS[rep.targetDefId]);
    if (!site) continue; // boxed in — holds at zero, same idiom, no new stall state

    s.materials.amount -= rep.matCost;
    const child = emptyBuilding(s.uidCounter++, rep.targetDefId, site.gx, site.gy);
    s.buildings.push(child);
    for (const [x, y] of cellsFor(DEFS[rep.targetDefId], site.gx, site.gy)) {
      s.grid[idx(s.N, x, y)] = child.uid;
    }
    b.replicateT = rep.buildS;
    emit({ type: "fabricator_ready", defId: rep.targetDefId, gx: site.gx, gy: site.gy });
  }
}
```

Call site: `tick.ts`, section "7b. Embodied colony," directly after `updateRobotFab(s, dt, emit); stepRobots(s, dt, claims);` and before "7d. Abundance unlocks." Same neighborhood the other fabrication lines already live in.

**Growth is per-instance multiplicative, not per-tick additive.** One Fabricator produces one child every `buildS` seconds — linear, on its own. But the child is a full instance of the same def with the same `replicates` field, so it immediately starts its own independent countdown. 1 → 2 → 4 → 8. The exponential curve isn't a special case in the code above; it falls out of every instance running the identical loop.

## 5. Placement search

Candidate cells are the footprint-adjacent neighbors of the parent, not a global search:

```typescript
function findAdjacentSite(s: ColonyState, parent: BuildingState, targetDef: BuildingDef)
  : { gx: number; gy: number } | null {
  const [w, h] = DEFS[parent.defId].foot;
  const candidates: [number, number][] = [
    [parent.gx, parent.gy - h], [parent.gx + w, parent.gy],
    [parent.gx, parent.gy + h], [parent.gx - w, parent.gy],
  ]; // N, E, S, W — fixed order, determinism-preserving (see §6)
  for (const [gx, gy] of candidates) {
    if (canPlace(s, targetDef, gx, gy)) return { gx, gy };
  }
  return null;
}
```

Local-neighbor growth over a global placement search on purpose: it's the more faithful reading of a cellular automaton (cells replicate into their neighborhood, not teleport anywhere with free space), it reuses `canPlace()` completely unmodified, and it's what actually produces the "creeping" visual — a lineage spreading across the colony rather than popping up at a random empty tile across the map. It also means a boxed-in Fabricator (surrounded on all four sides) stalls on its own, for free, no new state.

**One real accounting question `canPlace()` surfaces that I don't think should be glossed over:** `canPlace()` independently checks `def.matCost > s.materials.amount` against the *target's own* `matCost` field. If `replicates.matCost` is meant to be the full charge for autonomous construction, this is a double-accounting risk — either the fee gets checked (and could fail) twice, or the two numbers silently need to be kept equal by convention. Two clean ways out: (a) set `replicates.matCost === DEFS[targetDefId].matCost` by convention and treat the duplication as intentional, or (b) skip full `canPlace()` for the autonomous path and call a trimmed version (bounds, occupancy, `needsVent`/`needsAquifer` only — affordability was already checked against `replicates.matCost` above). I'd lean (b), since it keeps `replicates.matCost` as the single source of truth for what a copy costs, but this is a real implementation decision, not a detail to paper over.

## 6. Determinism

Same discipline as everywhere else in `src/engine/`: no `Math.random`, no `Date.now`, no `await`, nothing outside the seeded RNG streams — and here, no RNG at all, since neither the countdown nor the placement search draws one. The N/E/S/W candidate order in §5 is fixed specifically so replay stays byte-identical; an unordered or iteration-order-dependent search would be exactly the kind of subtle non-determinism `engine.test.ts` exists to catch.

## 7. Causal world model — what's free and what isn't

`buildGraph()` (`agent/worldmodel/graph.ts`) iterates `s.buildings` generically off `DEFS[b.defId]` and wires up `feeds`/`draws` edges from whatever's in `produces`/`consumes`. **Free:** every Fabricator instance becomes a graph node automatically, zero new code, as long as the def uses those fields normally.

**Not free:** `diagnoseShortfall()` and `risks()` are scoped to `power | water | oxygen | food`. Materials sits outside that graph entirely. If the failure mode you actually want the Watcher to narrate is "materials cratered because a lineage got away from you," that's not covered by anything that exists today — it would need a new node kind for the materials pool, or a parallel lightweight check. Flagged as Phase 3 (§17), not assumed.

**Practical v1 recommendation:** give the Fabricator a real `consumes.power` cost, not zero. That routes runaway replication through the power-priority system, which the world model, the brownout narration, and (see §9) the Director's scoring already handle well — for free.

## 8. Sentinel — what's free and what isn't

`featureVector()` (`agent/sentinel/features.ts`) is a fixed 10-length vector: 4 pool fills, 4 pool flows, sun, population/24. No building-count feature exists today, and no materials feature either.

**Free:** if Fabricators draw power (§7), their aggregate draw shows up in the power fill/flow features already in the vector. The autoencoder will flag an unusual power signature from runaway replication with zero code changes.

**Not free, but small:** it'll read as generic power weirdness, not "fabricators." To have Sentinel name the actual cause — or to catch a materials-only runaway that never stresses power — add one feature: `fabricatorCount / NORMALIZER` to `featureVector()` and `FEATURE_LABELS`. One line in each, not a redesign, but it is new code.

Either way, narration is already covered: the generic `anomaly` `EventType` and the existing `ANOMALY` bank in `watcher.ts` handle any `detail` string Sentinel hands them. No new Watcher code needed for the anomaly report itself.

## 9. Director — what's free and what's explicitly out of scope

`scoreHazards()` / `colonyShape()` (`agent/director/scoring.ts`) tally `sealed`, `corridorCount`, and `solar` by iterating `s.buildings` off `DEFS[...]`. **Free:** if the Fabricator def sets `requiresPressure: true`, a sprawling lineage shifts those tallies automatically, and the Director's existing targeting (more meteor/quake appeal for more built surface) reacts to fabricator sprawl with zero new Director code.

**Explicitly out of scope for v1:** the Director literally becoming a rogue lineage, or firing some new "outbreak" hazard. As noted in §2, `Director.decide()` can only return an existing `HazardKind`. Real, separate scope — see §17.

## 10. Council integration

Two new `EventType` entries (extending the closed union in `shared/types.ts`):

- `fabricator_ready` — mirrors `rover_ready` / `robot_ready` exactly. Proposing severity 2.
- `fabricator_stalled` — optional; fires when a completed cycle can't place (boxed in) or can't afford the fee. Open question in §17: every stall tick is spammy, so this probably wants either a once-per-stall-episode edge trigger, or no event at all (the robot fee-hold precedent emits nothing while holding — silence may be the right call here too).

New scripted lines join `agent/lines.ts`'s existing ≤140-character dry-register, substring-tested banks — write these with the tests open, per the project's own stated practice. `fabricator_ready` reads more like VIVARIUM's own voice (first-person status, the way rover/robot completions already report) than the Watcher's diagnostic register, unless the completion crosses some lineage-size threshold worth flagging distinctly.

## 11. Unlock gate

New `GATES.fabricator` entry, same idiom as the rest of `unlocks.ts`:

```typescript
// unlocks.ts GATES table
fabricator: (s) =>
  s.buildings.some((b) => b.defId === "roboticsbay") && s.materials.amount >= 250,
```

Gated behind a built Robotics Bay, mirroring how `roboticsbay` itself gates on a built reactor. Numbers are starting guesses, not final — same "design open question" status the `ptp` gate's own comment already carries. Add `"fabricator"` to `ORDER` for palette display.

## 12. Balance and the safety valve

Proposed `tuning.ts` block, sitting beside `ROBOT_*`:

```typescript
export const FAB_BUILD_S = 70;       // countdown per replication cycle
export const FAB_MAT_COST = 22;      // materials per copy
export const FAB_MAX_LINEAGE = 50;   // hard colony-wide cap — non-negotiable
```

`FAB_MAX_LINEAGE` isn't a balance nicety, it's a technical constraint: unbounded `s.buildings` growth eventually stresses the renderer's instanced-mesh count and the ~12fps-throttled snapshot payload (`worker/host.ts` serializes the whole buildings array every frame). Start conservative and tune by feel and a perf profile, the same spirit as `ROBOT_CAP = 3`.

The finite `GRID_N = 25` grid (625 cells) is a second, free saturation limit — once local neighbor cells run dry, lineages stall on their own via the existing hold-at-zero idiom. No new code. This is the literal "petri dish" property from our conversation, and it falls out of the engine you already have.

The player already has a kill switch: the existing `remove` Command works on any `BuildingState`, Fabricators included. No new Command needed for one-by-one lineage control. A coarser `setDirector`-style global toggle is a reasonable v2 ask if one-by-one turns out to be too slow to matter in practice — not required for v1.

**Why the exponential curve is real despite modest per-unit numbers:** at `FAB_MAT_COST = 22` against a starting stock of 90 and a single printer's 0.35/s income, doubling every ~70s outpaces the colony's materials economy within a handful of generations if left alone. That compounding, not the per-unit cost, is the actual design lever — and it's exactly why §7-9 matter: the systems that are supposed to notice and press back need to actually see it.

## 13. Open question: staffing

Proposing `staffing: 0` for the Fabricator, not staffed like the Robotics Bay. Reasoning: staffing ties replication rate to population/labor, which every other late-game building already competes for; stacking a second labor draw on top of an already-dangerous exponential system compounds the danger in the wrong direction. Unstaffed also reads truer to the premise — the whole point of a universal constructor is not needing hands. Flagged as Brad's call, not locked in.

## 14. UI/UX surface

The unlock moment (padlock, toast, council note, chime) is inherited automatically once gated via `GATES` — zero new UI code there. Since replication itself is autonomous, only the *first* instance is player-placed; a visible in-progress state on `replicateT` (a pulse, a progress ring) matters more here than it does for the single colony-wide rover/robot countdown, since there can be many running at once. Worth checking however the existing UI already surfaces `roverFab`/`robotFab` progress and mirroring that pattern rather than inventing a new one — I haven't read the Vue layer, so this is a pointer, not a spec.

A HUD readout for lineage count against `FAB_MAX_LINEAGE` (same register as the existing pool/materials readouts) would give the player visibility into how close they are to the cap. Nice-to-have, not load-bearing — the Council narration plus `remove` already provide feedback and control without it.

## 15. Testing

A `fabricator.test.ts` alongside `robots.test.ts`, covering: countdown pauses when unpowered (never resets); materials-hold-at-zero on an unaffordable cycle; the `FAB_MAX_LINEAGE` cap actually stops growth; a boxed-in stall recovers once a neighbor cell frees up (e.g. after a `remove`); and determinism — same seed, same lineage shape, every run.

## 16. Phased build order

**Phase 1 (MVP):** the def, the `replicates` field, `updateFabricatorReplication`, the hard cap, the unlock gate, `remove` as the only control surface, minimal scripted lines even if placeholder. No Sentinel or Director changes yet. Feel it out with the real app before layering anything on — same "drive it with Playwright, don't assume" discipline the rest of the project already follows.

**Phase 2:** the Sentinel feature, real scripted-line copy, a HUD lineage counter.

**Phase 3 (stretch, not committed):** materials-aware world-model extension so the Watcher can trace a materials crisis to a lineage by name; a `HazardKind` extension if the Director-becomes-the-threat idea is still wanted after Phase 1 shows how it actually feels; mutation on `replicates.targetDefId` drift, Evoloop-style, if exact copies turn out to be less interesting than imperfect ones.

## 17. Open questions

1. `matCost` double-accounting at autonomous placement — bypass `canPlace()`'s own check, or keep the two numbers equal by convention (§5).
2. `fabricator_stalled` — emit once per stall episode, or stay silent like the robot fee-hold precedent (§10)?
3. `FAB_MAX_LINEAGE` starting value needs playtesting and a perf profile, not a guess (§12).
4. Staffed or unstaffed (§13) — proposing unstaffed, Brad's call.
5. Unlock-gate thresholds in §11 are placeholders.

## 18. Resolutions (implemented 2026-07-14, Phase 1 + 2)

1. **matCost (§17-1): resolved by construction — `replicates.matCost` was dropped.** The field shipped as `{ targetDefId, buildS }`; the completion fee is `DEFS[targetDefId].matCost ?? 0`, so `canPlace()`'s own affordability check is the *same number* and the double-accounting question dissolves. Neither option (a) nor (b): one field fewer than both. `FAB_MAT_COST` feeds the def's `matCost`, single-sourced in `tuning.ts`.
2. **Stall event (§17-2): once per stall episode**, edge-triggered with **no stored flag** — `before > 0` on the crossing tick is the edge; the countdown then sits at exactly 0, and the only exit from 0 is a successful spawn, which re-arms both. A save mid-stall reloads at 0 and stays silent. Carries `detail: "materials short" | "no clear ground"` (fee checked before the site search so the reason attributes cleanly). Chosen over silence because the filed homeostasis backlog already flags that silent fab pauses read as hangs.
3. **`FAB_MAX_LINEAGE` = 50** shipped as the starting value; countdowns freeze at the valve (robot-cap idiom, silent — the HUD lineage cell carries the why). Still a playtest number.
4. **Unstaffed** (`staffing: 0`), as proposed.
5. **Gate shipped as proposed** (`roboticsbay built && materials ≥ 250`) — thresholds remain tuning targets.

Corrections to the spec discovered against the live repo during implementation:
- **§9's `requiresPressure: true` idea is not viable**, not merely optional: an engine-spawned sealed child starts `connected: false` → the tick keeps it offline → its countdown never starts — the lineage dies at generation 1. Shipped `requiresPressure: false`; Director pressure arrives through brownouts and ordinary strike damage instead (`colonyShape` tallies nothing a fabricator carries).
- **§4's pseudocode drifted `replicateT` negative** while blocked; shipped with the robot clamp (`Math.max(0, …)`), holding at exactly 0.
- **§12's "instanced-mesh count" is a misnomer** — the renderer is per-uid meshes (draw calls), not `InstancedMesh`. The concern stands; the mechanism named was wrong.
- **§14's "mirror the existing fab-progress UI" had no referent** — `roverFab`/`robotFab` never reach the snapshot; `replicateT` is the first fabrication progress the UI has ever seen. Shipped: the facility kit's front bars act as a fill gauge off `BuildingStatus.fill`, plus a `FABRICATORS n / 50` cell in the resource rail (rendered only once one exists).
- **Same-tick cap overshoot** (K completions at cap−1) is guarded by a live in-loop count, not just the per-tick check.
- **`recomputeCaps(s)` runs after every autonomous spawn** (pure `caps.ts` function; in-tick precedent already existed in `hazards.ts`/`trade.ts`) so a future `replicates` target with `caps`/`popCap` stays correct.
- **Co-op note:** guests' build commands are dropped by the host relay, so only the architect can prune a runaway lineage — consistent with the existing role split, and intended.

## See also

- [engine.md](../docs/engine.md) — the tick this hooks into
- [agent-layer.md](../docs/agent-layer.md) — the Council, world model, Sentinel, Director this spec extends or deliberately doesn't
