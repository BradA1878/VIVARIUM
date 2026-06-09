# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

VIVARIUM is a 3D Mars-colony survival sim (a hidden Easter egg for bradanderson.org), narrated by a council of AI voices. It is a Vite + Vue 3 + TypeScript app with a three.js renderer, a sim that runs in a Web Worker, optional ML, and an optional Node/Hono backend.

## Commands

```bash
npm run dev            # Vite dev server → http://localhost:5180 (game is fully playable with no backend)
npm run server         # Hono backend on :8787 (live narrator + Mongo); Vite proxies /api → here
npm test               # Vitest: all *.test.ts under src/ and shared/
npx vitest run src/engine/engine.test.ts          # one test file
npx vitest run -t "brownout sheds the lowest"     # tests matching a name
npm run typecheck      # vue-tsc --noEmit  (run this after edits — it covers src/, shared/, server/)
npm run build          # typecheck + vite build
```

The game needs no backend or keys. Backend env (all optional, see `.env.example`): `ANTHROPIC_API_KEY` enables the live narrator (server-side only); `VITE_LIVE_NARRATOR=1` opts the *client* into calling it; `MONGODB_URI` enables networked saves (falls back to localStorage). Mongo currently runs locally on this machine.

## The one architectural rule everything hangs on

There is a **hard wall** between two layers, and almost every design decision follows from it:

1. **The Engine** (`src/engine/`) — a **deterministic, synchronous** simulation. Same seed + same inputs → same future. It runs inside a **Web Worker** and imports **no** three.js, Vue, DOM, `fetch`, `await`, `Math.random`, `Date.now`, or `@tensorflow/*`. This purity is load-bearing: it powers replay, exact save/resume, and the determinism tests. **Adding any of those to `src/engine/` breaks the guarantees and the tests will catch you.** Use the seeded RNG (`engine/rng.ts`), not `Math.random`.
2. **The Agent layer + UI** (everything else, main thread) — only ever *observe* the worker's output (a serializable `Snapshot` + a `ColonyEvent` stream) and issue typed `Command`s back. They never reach into the tick.

`shared/types.ts` is the neutral vocabulary spoken across the wall (`Snapshot`, `ColonyEvent`, `BuildingDef`, `Side`, …) — it imports nothing from either side.

## Data flow

```
worker (sim.worker.ts → SimHost → Colony)        main thread
  Colony.tick() mutates ColonyState     ──snapshot/events──▶  SimBridge ──▶ renderer (three.js) + Vue store + Council
  applies Commands (place/route/...)    ◀──── Command ───────  store.controls / placement / palette
```

- `worker/protocol.ts` defines every `Command` (place, remove, rotate, move, route, triggerHazard, setDirector, possess, moveIntent, respondTrade, setPaused, setSpeed, forceStorm, reset, load, save, start) and `Outbound` message. **To add a player/agent action, add a Command here, handle it in `worker/host.ts`, expose it on `worker/bridge.ts`.** The worker is authoritative; the main thread predicts (e.g. `engine/predict.ts`, `engine/route.ts`) only for ghost previews.
- The Vue side is one reactive store: `src/ui/stores/colony.ts` (module singletons, `useColony()`). Components read `snapshot`; `controls.*` issue commands. There is no Pinia.
- The renderer (`src/render/renderer.ts`) reconciles building meshes against each snapshot and never touches the worker except through `SimBridge`.

## Key subsystems

- **Buildings are data, not code.** The whole tech tree is `src/engine/defs.ts`; all balance knobs live in `src/engine/tuning.ts`. The engine just runs recipes against resource pools. Edit numbers, not engine logic, to rebalance.
- **The tick** (`engine/tick.ts`) is ordered passes (solar → power-by-priority brownout shedding → production gates → colonist demand → shortfall→grace-timer→casualty → resupply → campaign win/lose), not one equation. Buffers (pools) decouple the passes.
- **The Council** (`src/agent/council/`) is the narrator: four voices (VIVARIUM/Watcher/Strategist/Chronicler), each a stateless `Voice.consider(ctx)`; `Council` (index.ts) arbitrates by severity + cooldowns. Live generation goes through `agent/client.ts` → Hono `/api/narrate` with a **per-persona** prompt (`server/mxf/prompt.ts`); it falls back to scripted lines on any failure and has a circuit breaker, so the game never depends on it.
- **Causal world model** (`src/agent/worldmodel/`) — pure, deterministic graph of the colony; `diagnoseShortfall()` traces a shortfall to its root cause down the cascade. The Watcher narrates from it.
- **Sentinel / TensorFlow.js** (`src/agent/sentinel/`) — an autoencoder that learns "normal" telemetry and flags anomalies. It is **non-deterministic and main-thread only** (never in the engine); tf.js is lazy-imported so it stays out of the main bundle. Degrades to a no-op if it fails to load.
- **The Director** (`src/agent/director/`) — the antagonist, and the cleanest illustration of the wall. It watches snapshots and, on its own pacing, picks the hazard that presses the colony's weakest seam, escalating gap + intensity over the sols — biased by cross-run **memory** (`director/memory.ts`) of how this player tends to die and by the Sentinel's **comfort** signal (it presses harder when you're settled). Because it is *not* the engine it may use `Math.random`; it proposes via a `triggerHazard` Command (toggle the whole thing with `setDirector`) that the deterministic tick applies and logs — so the core stays pure even though its adversary improvises.
- **Doors / rotation / corridors** — pressure buildings have a `door` side (`engine/doors.ts`) that turns with `BuildingState.rot`; the Corridor palette tile is a 2-click auto-route mode (`engine/route.ts`, BFS door→door). Corridors render as neighbour-aware arms (`render/three/kit/corridor.ts`), not fixed meshes. Doors are routing + visual only; the engine's pressure-seal rule is unchanged.
- **Embodied colony** — colonists are real engine entities (`engine/colonists.ts`): `ColonistInstance` with continuous grid coords, count == population. Press **F** to possess the nearest one; **WASD** sends a continuous `moveIntent` Command the tick integrates; the possessed colonist auto-mines surface **deposits** (`engine/deposits.ts`: ice→water, ore→materials, cache→food) and auto-unloads at the hub. Unpossessed colonists follow a tod/hazard AI and **route around buildings** via a deterministic BFS (`engine/pathfind.ts`) to a building's door/access cell. WASD is **camera-aligned** (App.vue rotates the input to the iso basis). **Materials** is a build currency (`BuildingDef.matCost`, gated in `grid.ts canPlace`/`predict.ts`). **Alien traders** (`engine/trade.ts`) arrive on a window like resupply; `respondTrade{accept}` swaps pools or grants permanent **alien tech** (`engine/techs.ts`: capacity/passive-power/demand upgrades, bought with materials, applied via `caps.ts` + the tick). Takes are clamped to storable capacity. Determinism is preserved by a **separate env-RNG** (deposits + trades) so the main hazard/arrival stream is byte-identical, and movement/pathing use no RNG. The renderer (`render/three/kit/astronaut.ts`, `kit/deposit.ts`, `alienship.ts`) interpolates colonist positions and runs a follow-cam off `snapshot.possessed`.

## Verifying changes

The fastest correctness loop is `npm run typecheck && npm test`. For anything visual or interactive, drive the real app with Playwright against `npm run dev`: a dev-only hook exposes `window.__viv = { renderer, bridge }` (and `window.__sentinel`) so you can call `bridge.place/route/rotate/reset`, read `bridge.latest`, and screenshot. This is how the renderer, placement, narrator, and campaign were validated — prefer it over assuming UI/3D behaviour.

## Scope note

Treat `docs/planning/vivarium-design.md` as the project's *starting point*, not a spec — the codebase has deliberately grown past it. The deeper guides in `docs/` (architecture, engine, agent-layer, gameplay, rendering, development — indexed in `docs/README.md`) document the system as it actually is. Don't gate ideas as "out of scope." Surface genuine engineering tradeoffs (above all, anything that would compromise engine determinism) as informed choices, not vetoes.
