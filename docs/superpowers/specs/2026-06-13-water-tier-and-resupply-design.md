# Water-tech tier + resupply that lands — design

- **Date:** 2026-06-13
- **Status:** approved in brainstorming, pending spec review
- **Origin:** playtest feedback — "I harvested all the ice but ran out of water; we need something that extracts water from the atmosphere or works like a well," and "how do supply windows work? I see the popup but nothing happens."

## Problem

Two findings from tracing the code:

1. **Water has no *intentional* renewable source.** The Ice Extractor (`defs.ts:54-61`) is flavored "sublimes subsurface ice" but its only input is power (5 power/s → 4 water/s) — it never depends on an ice deposit. So a colony technically keeps making water after the ice is gone, but only by accident, and a single extractor's 4/s is dwarfed by a grown colony's water sinks (Electrolysis 2.5/s, Hydroponics 3/s, plus crew demand 0.16/s/person). The player who "ran out after harvesting the ice" hit exactly this: they leaned on hauling ice, and nothing deliberate carried them past it.

2. **Resupply works but reads as dead.** Earth resupply is fully automatic (first window ~180s, then every ~280s, open ~22s, delivering power 40 / water 60 / oxygen 30 / food 45 over the window — `tick.ts:89-103`, `tuning.ts:64-71`). It feels like nothing happens because (a) nothing renders — no lander or pod, the world looks identical; and (b) each tick's top-up is clamped to capacity (`addPool`, `tick.ts:41-44`) and the batch sizes sit right against the small base caps (water drop 60 = water cap 60), so a healthy pool's needle barely moves. It's a UX gap, not a logic bug.

## Goals

- Add a deliberate **water-tech tier**: three buildings that each solve a *different* water problem, so they stack rather than duplicate.
- Make **resupply read as a real event**: visible delivery, honest feedback on what landed, and a basket that actually helps.
- Preserve the engine's determinism wall exactly (the load-bearing rule in CLAUDE.md §"The one architectural rule").

## Non-goals

- No new survival resource kind (everything produces/relabels the existing `water` pool).
- No rework of the existing Ice Extractor mechanic (only an honest description tweak).
- No change to hazard pacing, trade, or the council beyond a resupply toast.

## The water-tech tier

| Building | Problem it solves | Mechanic | New machinery |
|---|---|---|---|
| Ice Extractor *(exists)* | Get started cheaply | Power → water, flat | — |
| **Atmospheric Water Generator** | Scale water as the colony grows | Power → water, renewable, build as many as you can power | None — pure data |
| **Aquifer Well** | Endgame "water solved" | Seats only on an aquifer site; huge output, almost no power | Aquifer-site terrain (mirrors vents) |
| **Water Reclaimer** | Stretch what you already have | Returns a fraction of the water the colony consumes | One pure tick pass |

A scaling source, a location jackpot, and an efficiency multiplier.

## 1. Atmospheric Water Generator (data-only)

A condenser that wrings trace vapor from the thin Martian air. Modeled directly on the Ice Extractor def: power in, water out, placeable anywhere, never deposit-gated. It is the dependable workhorse — higher output than the extractor but noticeably power-hungry, so it's something you build once your grid can feed it.

- **Def (`src/engine/defs.ts`):** new `DEFS` entry `awg` (or `condenser`), copied from `extractor` with `consumes: { power: 12 }`, `produces: { water: 8 }`, `matCost: 45`, `staffing: 1`, `requiresPressure: false`, `priority: 44`, distinct `glyph`/`color`/`desc`. Append `"awg"` to the `ORDER` array (`defs.ts:161-165`).
- **Unlock (`src/engine/unlocks.ts`):** add a `GATES` entry, e.g. `awg: (s) => s.sol >= 5 || s.population >= 6`. Pure predicate, latches once.
- **Render:** add `awg` to the `buildTank` branch in `render/three/kit/index.ts:19-32`, with an optional `specFor` case in `kit/tank.ts` (a tall condenser silhouette). Falls back to a generic tank if skipped.
- **Everything else is automatic** — placement, ghost preview, palette, production pass, and the agent layer are all generic over `DEFS`. No `tick.ts` / `grid.ts` / `predict.ts` / protocol changes.

## 2. Aquifer Well (terrain-gated)

Taps a subsurface brine aquifer. Like the geothermal tap only seats on a vent, the well seats only on an **aquifer site**. Reward for the constraint: very high output for almost no power — but you can build only as many as the map gives you.

This is the one building with new machinery, and it **mirrors the geothermal vent system one-for-one** so determinism is preserved by an already-proven path:

- **Terrain type (`src/engine/state.ts`):** add `AquiferInstance { id, gx, gy }` next to `VentInstance` (state.ts:92-97), and an `aquifers: AquiferInstance[]` field on `ColonyState` (next to `vents`, state.ts:151).
- **Seeding (`src/engine/deposits.ts`):** add `seedAquifers(s, rng)` mirroring `seedVents` (deposits.ts:65), with `AQUIFER_COUNT` (start at **2** — rarer than the 3 vents, so it's a jackpot), `AQUIFER_EDGE`, `AQUIFER_SPACING`, `AQUIFER_CLEAR`, `AQUIFER_BACKFILL_SALT` constants in `tuning.ts`. Call `seedAquifers(this.s, this.envRng)` in `colony.ts` world-gen (colony.ts:234-235), seeded **off the env-RNG**, before deposits so deposits avoid aquifer cells.
- **Determinism (the rule to hold exactly):** aquifer sites come from the **separate env-RNG stream** so the hazard/arrival timeline stays byte-identical. Save/load round-trips `aquifers` (colony.ts:323, 360). A legacy save with no `aquifers` **backfills from a derived `RNG(seed ^ AQUIFER_BACKFILL_SALT)`** — never the live env-RNG — exactly as vents do (colony.ts:384-387). Snapshot surfaces `aquifers` (colony.ts:257) with an `AquiferView` type mirroring `VentView`.
- **Def (`src/engine/defs.ts`):** new `DEFS` entry `aquifer` (well) with `consumes: { power: 3 }`, `produces: { water: 14 }`, `matCost: 60`, `staffing: 1`, `priority: 46`, and a new `needsAquifer: true` flag (parallel to `needsVent`). Append to `ORDER`.
- **Placement (`src/engine/grid.ts` + `predict.ts`):** add a `needsAquifer` check mirroring the `needsVent` check (grid.ts:33-34, predict.ts:35-36) — true only when a footprint cell sits on an `s.aquifers` / `snap.aquifers` site. Add `def.needsAquifer` to `shared/types.ts` `BuildingDef`.
- **Render:** draw an aquifer ground marker mirroring the vent marker, and a pumpjack/derrick mesh via the `buildTank` derrick topper.
- **Unlock:** `GATES` entry `aquifer: (s) => s.sol >= 8`.
- **Scope toggle (easy cut):** if the terrain work isn't worth it, drop the site system and make the well placeable anywhere with lower output (≈10 water/s) — it then collapses to a second data-only building. Keeping the site system is the approved default.

## 3. Water Reclaimer (one pure tick pass)

A greywater loop: it recovers a fraction of the water the colony *consumes* each tick (crew demand + Hydroponics + Electrolysis + reactor draw) and returns it to the pool. This is the only building whose output can't be a flat `produces` number — it's proportional to demand — so it needs a small, deterministic tick addition.

- **Def field (`shared/types.ts`):** add `reclaim?: { frac: number; max: number }` to `BuildingDef`. `frac` = fraction of colony water draw captured; `max` = ceiling in water/s per building.
- **Def (`src/engine/defs.ts`):** `reclaimer` entry with `consumes: { power: 6 }`, `reclaim: { frac: 0.45, max: 2.5 }`, `matCost: 40`, `staffing: 1`, `priority: 40`, `requiresPressure: true`, a door side. Append to `ORDER`.
- **Tick pass (`src/engine/tick.ts`):** accumulate gross **water sunk this tick** (`waterSunk`) across building consumption (pass 4) and colonist demand (the pass at ~200-207). After demand, for each **online** reclaimer add back `min(def.reclaim.max * dt, def.reclaim.frac * waterSunk / nReclaimers)` to the water pool via `addPool` (clamped to capacity), and credit `net.water`. Pure arithmetic, no RNG.
- **Unlock:** `GATES` entry `reclaimer: (s) => s.buildings.some(b => b.defId === "greenhouse" || b.defId === "electrolysis")` — thematically, you recycle their output.
- **Why it's distinct:** it can't bootstrap from empty (no sinks → nothing to reclaim), but it multiplies the value of every water source you have — the opposite end of the design from the generator and the well.

## 4. Resupply that lands

Three parts, matching what the player noticed:

- **Visible delivery (render-only, main thread).** A supply pod descends into the world when a window is open, keyed off `snapshot.resupplyT > 0`, mirroring how the alien ship already gets a mesh (`render/three/kit/alienship.ts`). Lands near the base/depot, sits for the window, lifts/fades at close. No engine involvement — stays on the correct side of the wall.
- **Adaptive basket + honest totals (engine).** At window open, weight the delivery toward the colony's **most-depleted pools** (computed from pool fill fractions — deterministic, no RNG), so resupply always does something useful instead of pouring water into a full tank. During the window, accumulate the **actual** per-resource amount banked (post-clamp). At window close, emit a new `resupply_done` event carrying those totals.
  - **Types (`shared/types.ts`):** add `"resupply_done"` to `EventType` and `amounts?: Partial<Record<Resource, number>>` to `ColonyEvent`.
  - The existing `resupply` event stays as the "inbound" announce at open (the Chronicler line and the banner are unchanged).
- **Feedback (UI).** A toast reads the `resupply_done` `amounts` — e.g. "Resupply landed: +24 water, +30 food" — and notes vented overflow when a basket couldn't fit. The existing `Alerts.vue` inbound banner (`Alerts.vue:86-94`) stays.

## 5. Honesty fixes (low-risk, optional)

- Reword the Ice Extractor `desc` (`defs.ts:60`) so it no longer implies it needs ice — say plainly it runs on power. This is what made the "ice gone → no water" dead-end feel real.
- Aquifer sites need a ground marker so the player can find where to drill (mirror the vent marker render).

## Determinism (the hard wall — non-negotiable)

- Atmospheric Water Generator and Water Reclaimer are deterministic by construction (data + pure arithmetic, no RNG, no async, no DOM).
- Aquifer sites use the **env-RNG** at world-gen and **derived-RNG backfill** for legacy saves — never the live hazard stream — so every existing determinism/replay/save test stays green and the hazard timeline is byte-identical.
- The resupply pod is **render-only**; the adaptive basket and banked-total accounting are pure tick arithmetic.
- The reclaim pass and the basket weighting take **zero RNG draws**.

## Balance (starting numbers — all tunable in `defs.ts` / `tuning.ts`)

| Building | Power in | Output | Mat cost | Staff | Priority | Unlock |
|---|---|---|---|---|---|---|
| Ice Extractor *(exists)* | 5/s | 4 water/s | 18 | 1 | 45 | founding |
| Atmospheric Water Generator | 12/s | 8 water/s | 45 | 1 | 44 | sol 5 / pop 6 |
| Aquifer Well | 3/s | 14 water/s | 60 | 1 | 46 | aquifer site + sol 8 |
| Water Reclaimer | 6/s | ≤2.5/s, = 45% of water sunk | 40 | 1 | 40 | greenhouse or electrolysis built |

Aquifer terrain: `AQUIFER_COUNT = 2`, edge/spacing/clearance mirroring the vent constants.

## Testing

- **Engine (`src/engine/*.test.ts`):**
  - AWG produces water with **no deposits present** (proves deposit-independence).
  - Reclaimer returns `frac × waterSunk`, never exceeds `max`, and contributes 0 when there are no sinks.
  - Aquifer placement: `canPlace`/`canPlacePredict` refuse off-site, accept on-site (mirrors the geothermal test, generation.test.ts:200-231).
  - Aquifer determinism: sites are static over time, survive a save round-trip, and a legacy save with no `aquifers` backfills to identical sites and an identical future (mirrors generation.test.ts:157-191).
  - Resupply: `resupply_done` carries the actual banked totals; the adaptive basket favors the most-depleted pool; a full pool reports vented overflow.
  - Determinism suite stays green (the real guard).
- **Playwright (`window.__viv`):** place each new building and confirm it renders and moves water; watch a supply pod land during a window and the toast fire.

## Files touched (consolidated)

**Required**
- `shared/types.ts` — `BuildingDef.needsAquifer`, `BuildingDef.reclaim`, `EventType += "resupply_done"`, `ColonyEvent.amounts`, `AquiferView`, `Snapshot.aquifers`.
- `src/engine/defs.ts` — three new `DEFS` entries + three `ORDER` appends; Ice Extractor `desc` tweak.
- `src/engine/tuning.ts` — aquifer constants; any named water knobs.
- `src/engine/state.ts` — `AquiferInstance`, `aquifers` field.
- `src/engine/deposits.ts` — `seedAquifers` (+ legacy backfill helper).
- `src/engine/colony.ts` — seed/snapshot/save/load/backfill `aquifers`; resupply banked accounting + `resupply_done` emit + adaptive basket.
- `src/engine/tick.ts` — reclaim pass; adaptive basket allocation; banked-amount accumulation.
- `src/engine/grid.ts` + `src/engine/predict.ts` — `needsAquifer` placement check.
- `src/engine/unlocks.ts` — `GATES` entries for `awg`, `aquifer`, `reclaimer`.

**Render / UI**
- `src/render/three/kit/index.ts` (+ `kit/tank.ts`) — new building meshes (or accept fallback).
- `src/render/three/kit/` — supply-pod mesh + aquifer ground marker.
- `src/render/renderer.ts` — drive the pod off `resupplyT`; draw aquifer markers (mirror vents).
- `src/ui/components/Alerts.vue` / toast — `resupply_done` feedback.
- `src/ui/components/Palette.vue` + `src/ui/hints.ts` — `UNLOCK_HINTS` for the three gated buildings.

## Open questions / toggles

1. **Aquifer terrain vs placeable-anywhere** — approved default is the site system; the fallback (placeable anywhere, ~10 water/s) is a clean cut if the terrain work runs long.
2. **`AQUIFER_COUNT`** — 2 makes it a jackpot; 3 makes it reliable. Start at 2.
3. **Reclaimer `frac`/`max`** — 0.45 / 2.5 is a guess; tune against a grown colony's real water draw.
4. **Resupply basket** — fully adaptive (all mass to the lowest pool) vs lightly weighted. Start lightly weighted so it stays a basket, not a single-resource drop.
