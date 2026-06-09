# VIVARIUM

A 3D Mars-colony survival sim, narrated by the colony AI that keeps it alive —
**VIVARIUM**. Resource balance is the whole game: **power → water → oxygen → food**,
with batteries and tanks as the buffers that carry the colony through the dark. A
council of AI voices narrates your watch, and the planet's tactician picks the
hazard that presses your weakest seam. Built as a hidden Easter egg for
bradanderson.org.

> Vite + Vue 3 + TypeScript · three.js renderer · a deterministic sim in a Web
> Worker · optional TensorFlow.js · optional Node/Hono backend.

## Quick start

```bash
npm install
npm run dev          # Vite dev server → http://localhost:5180
```

The game is **fully playable with no server and no env vars** — the narrator falls
back to scripted lines and saves go to localStorage. The heavy three.js renderer is
lazy-loaded behind the colony view, so it never lands on the host page until opened.

## The one rule everything hangs on

Two layers, with a **hard wall** between them:

1. **The Engine** (`src/engine/`) — a **deterministic, synchronous** simulation.
   Same seed + same inputs → same future. It runs inside a **Web Worker** and
   imports no three.js, Vue, DOM, `fetch`, `await`, `Math.random`, `Date.now`, or
   `@tensorflow/*`. This purity powers replay, exact save/resume, and the
   determinism tests. Fully playable on its own.
2. **The Agent layer + UI** (everything else, main thread) — only ever *observe*
   the worker's `Snapshot` + `ColonyEvent` stream and issue typed `Command`s back.
   They never reach into the tick; the engine never `await`s them.

Almost every design decision in the codebase follows from this. See
[docs/architecture.md](docs/architecture.md).

## Architecture

```
src/
  engine/        pure deterministic sim (no DOM / three / async) — runs in the worker
  worker/        sim.worker.ts hosts the engine; bridge.ts is the main-thread client
  render/        three.js renderer — iso camera, Mars terrain, procedural building kit
  ui/            Vue 3 HUD overlay reading a single reactive store (stores/colony.ts)
  agent/         the agent layer:
    council/     the Council — VIVARIUM, Watcher, Strategist, Chronicler
    worldmodel/  causal graph of the colony; diagnoseShortfall()
    sentinel/    TensorFlow.js anomaly detection (lazy-loaded, degrades to no-op)
    director/    the antagonist — picks hazards, escalates, cross-run memory
  persistence/   save serialization, localStorage + Mongo adapters
server/          Node + Hono — live MXF narrator endpoint + Mongo persistence
shared/          the neutral vocabulary spoken across the wall (types.ts)
```

## What's in the box

- **A colony that's a system, not an equation.** The tick is *ordered passes* —
  solar → power-by-priority brownout shedding → production gates → colonist demand →
  shortfall/grace/casualty → resupply → campaign. Pools (batteries, cisterns, tanks)
  are buffers that decouple the passes. The whole tech tree is **data** in
  `engine/defs.ts`; balancing is editing numbers, never engine logic.
- **An embodied crew.** Colonists are real entities. Press **F** to possess the
  nearest one and **WASD** to drive it; it auto-mines surface deposits
  (ice → water, ore → materials, cache → food) and unloads at the hub. **Materials**
  is the build currency, so going out to gather funds your expansion.
- **Pressure, corridors, and doors.** The seal flood-fills from a Pressure Hub
  through corridors; pressurized buildings have a rotatable door, and the Corridor
  tile is a 2-click door-to-door auto-router.
- **Alien traders.** A ship arrives on a window and offers a resource swap or
  permanent **alien tech** (capacity / passive-power / demand upgrades) for
  materials. Accept or decline while it's on the ground.
- **A council, not a voice.** Four AI narrators — **VIVARIUM** (the keeper), the
  **Watcher** (reads a causal world model and a TF.js anomaly Sentinel to say *why*
  a pool is failing), the **Strategist** (what to build next), and the **Chronicler**
  (the long memory). They arbitrate so one speaks per beat.
- **The Director.** A non-deterministic antagonist that watches the colony and picks
  the hazard that presses your weakest seam, escalating over the sols — yet stays
  outside the wall, proposing hazards via a `Command` the deterministic engine logs.
- **The campaign.** Earth's launch window closes at the start of **Sol 22**. Grow to
  a real settlement — the target population, self-sustaining on all life support
  without resupply for a sustained stretch — before then, and you win. Let the window
  close, or lose everyone, and the watch ends.

For how it all plays, see [docs/gameplay.md](docs/gameplay.md).

## Documentation

Full docs live in [`docs/`](docs/README.md):

- [**Architecture**](docs/architecture.md) — the hard wall, data flow, and the worker protocol.
- [**The Engine**](docs/engine.md) — buildings-as-data, the ordered tick, the seeded RNG, save/resume.
- [**The Agent Layer**](docs/agent-layer.md) — the Council, world model, Sentinel, Director, and live narrator.
- [**Gameplay**](docs/gameplay.md) — the loop, building order, possession & mining, trade, the campaign.
- [**Rendering**](docs/rendering.md) — the three.js renderer, the procedural kit, the camera.
- [**Development**](docs/development.md) — commands, layout, extension recipes, testing, the Playwright hook.
- [**Design doc**](docs/planning/vivarium-design.md) — the original starting point (the codebase has grown past it).

## Optional: live narrator + Mongo persistence

```bash
cp .env.example .env   # then fill in the values below
npm run server         # Node + Hono on :8787 (Vite proxies /api → here)
```

| Env var | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the live MXF narrator (server-side only — never shipped to the client). Without it, `/api/narrate` 503s and the client uses scripted lines. |
| `NARRATOR_MODEL` | Override the model (default `claude-opus-4-8`; e.g. `claude-haiku-4-5` for a cheap public build). |
| `VITE_LIVE_NARRATOR` | Set to `1` to opt the **client** into live generation (default off → pure scripted, no network). |
| `MONGODB_URI` / `MONGODB_DB` | Networked save state. Falls back to localStorage if unreachable. |

The narrator `gate()` short-circuits on event type / severity / cooldown **before**
any model call, and the endpoint is rate-limited and caches by event signature — so a
public, auth-free toy can't become a cost faucet. See
[docs/agent-layer.md](docs/agent-layer.md).

## Test & build

```bash
npm test             # Vitest — engine determinism, worker loop, narrator gate, save round-trip
npm run typecheck    # vue-tsc (covers src/, shared/, server/)
npm run build        # type-check + production build
```

The engine is deterministic and replayable: same seed + same `dt` sequence → same
future, and a save resumes bit-identically.

## Notes

- **Procedural kit, not Blender.** The design calls for a Blender → glTF kit; this
  environment can't run Blender, so the buildings are procedural three.js meshes
  reproducing the prototype silhouettes. `render/three/kit/` keeps a `GLTFLoader`
  seam so real `.glb` assets can drop in later with no call-site changes.
- **Easter-egg embedding.** Standalone, `index.html` boots the game directly. On the
  host site it sits behind a trigger; mounting `App.vue` is the integration point,
  and the renderer chunk is already split out for lazy load.
- This is a personal project — a hidden Easter egg for bradanderson.org.
