# The Living Environment — Mars as a Learning Antagonist

## Goal
Evolve the environment intelligently. The player plays the colony; an AI
**Director** studies it and aims hazards at its weak seam, and *learns how this
player dies* across runs. Mars stops being a dumb weather timer.

## Architecture (the "alive" path)
- **Hazards live in the engine** (deterministic): a data-driven event system with
  a lifecycle (telegraph → active → clear), intensity, duration, and mechanical
  effects applied in the tick. A **seeded scheduler** runs hazards on its own, so
  the engine is still standalone + replayable (and the determinism tests stay
  green when no Director is attached).
- **The Director lives in the agent layer** (main thread, like the Council). It
  reads snapshots + the causal world model + ML, and **proposes** hazards via a
  `triggerHazard` command. The engine applies it and emits it as a logged event.
  Live play is non-deterministic (a learning antagonist); pure-engine replay is
  not — accepted trade.
- When a Director is attached (`setDirector(true)`), the engine's auto-scheduler
  stands down and hazards come only from the Director.

## Phase 1 — Hazard system + damage (engine + render + HUD)
- `engine/hazards.ts`: `HazardKind`, `HazardInstance`, lifecycle, seeded
  scheduler, `triggerHazard`. `hazardMods(s)` → solar factor, hab-power mult,
  power drain. Dust refactored into this; `weather`/`solarMul`/`stormT` derived
  for back-compat so existing renderer/HUD keep working.
- **Damage model:** `BuildingState.integrity` (1→0) + `faulted` timer. Below a
  threshold or while faulted, a building is non-functional; integrity self-repairs
  slowly; integrity 0 destroys it. Production gate respects it.
- **Hazards:** dust (have), **meteor** (seeded strikes damage/destroy buildings &
  corridors), **solar flare** (power siphon + electronics fault; batteries buffer
  it), cold snap (hab heating raises power draw), marsquake (corridor damage →
  seal loss).
- New events: `hazard_warn` (telegraph), `hazard_start`, `hazard_end`, `strike`,
  `building_damaged`, `building_destroyed`. Council/Watcher narrate them.
- Snapshot gains `hazards: HazardView[]` (kind/phase/intensity/remaining) for the
  HUD telegraph + alerts. Worker `triggerHazard`/`setDirector` commands.
- Render: meteor streaks + impact flashes + craters; flare sky-flash + arcing;
  building damage (smoke/sparks/integrity dimming); a telegraph marker. (Subagents
  per visual.) HUD: incoming-hazard alerts with countdown.

## Phase 2 — Rule-based Director (agent layer)
- `agent/director/`: observes snapshots; scores each hazard by how much pressure
  it would create given the colony's shape (uses `worldmodel` risks/diagnose:
  power-fragile → flare/coldsnap; sprawling seals → meteor/quake). Paces itself
  (budget, cooldowns, escalating intensity over sols). Issues `triggerHazard`.
  Store enables it + `setDirector(true)`.

## Phase 3 — ML brain + cross-run memory (the learning antagonist)
- **Anticipation:** a TF model over colony telemetry that predicts the player's
  brittle axis a few sols out, so the Director sets up combos.
- **Novelty-seeking:** invert the Sentinel autoencoder — push the colony toward
  states that are *novel/stressful for it*.
- **Cross-run memory:** persist the player's failure signature (which hazard/axis
  ends their runs) to localStorage/Mongo; the Director adapts its opening across
  runs — the genuine job for the deferred persistent model. `agent/director/brain`
  (TF, lazy) + `agent/director/memory` (persisted). (Subagent for the TF model.)

## Determinism guardrails
- Nothing non-deterministic in `src/engine/` (no Math.random/Date/async/tf). The
  Director and brain are agent-layer only and reach the engine solely through the
  `triggerHazard` command. Engine determinism tests must stay green.

## Build order
Phase 1 engine core → damage → hazard effects → tests; then render visuals
(subagents) + HUD + narrator lines; then Phase 2 Director; then Phase 3 ML+memory.
Commit + verify (typecheck/test/Playwright) per step.
