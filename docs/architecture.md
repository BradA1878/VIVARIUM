# Architecture

VIVARIUM is built around a single rule. Almost every other decision in the
codebase is downstream of it.

## The one rule: a hard wall between two layers

```
┌──────────────────────────────┐        ┌────────────────────────────────────┐
│  THE ENGINE   (Web Worker)    │        │  AGENT LAYER + UI   (main thread)    │
│                              │ snap-  │                                      │
│  deterministic, synchronous   │ shot + │  three.js renderer                   │
│  same seed + inputs → same    │ events │  Vue 3 HUD (reactive store)          │
│  future. no DOM, three, Vue,  │ ─────▶ │  the Council (narrator)              │
│  fetch, await, Math.random,   │        │  world model · Sentinel · Director   │
│  Date.now, @tensorflow/*.     │ ◀───── │                                      │
│                              │ Command│  observe only — never reach in       │
└──────────────────────────────┘        └────────────────────────────────────┘
```

1. **The Engine** (`src/engine/`) is a **deterministic, synchronous** simulation.
   Same seed + same inputs → same future. It runs inside a **Web Worker** and
   imports **no** three.js, Vue, DOM, `fetch`, `await`, `Math.random`,
   `Date.now`, or `@tensorflow/*`. This purity is load-bearing: it powers replay,
   exact save/resume, and the determinism tests. Use the seeded RNG
   (`engine/rng.ts`), never `Math.random`.

2. **The Agent layer + UI** (everything else, main thread) only ever *observe*
   the worker's output — a serializable `Snapshot` plus a `ColonyEvent` stream —
   and issue typed `Command`s back. They never reach into the tick.

> The engine must never `await` the agent layer. The agent layer reads a snapshot
> and an event stream; it has no authority over simulation state. Latency and
> cost both die on this hill.

Why this matters in practice:

- **Replay & save/resume** — a save is just the seed and the input log; resuming
  re-runs the same deterministic function and lands bit-identically.
- **Testability** — the determinism tests (`engine/engine.test.ts`) assert that
  the same seed and `dt` sequence produce the same future. Adding any non-pure
  call to `src/engine/` breaks the guarantee and the tests catch it.
- **Cost & latency safety** — because the LLM narrator only *observes*, a slow or
  failed model call can never stall or corrupt the game.

## The neutral vocabulary

`shared/types.ts` is the language spoken across the wall — `Snapshot`,
`ColonyEvent`, `BuildingDef`, `Resource`, `Side`, `HazardKind`, and friends. It
imports nothing from either side, so neither layer can leak into the other through
its types.

## Data flow

```
worker (sim.worker.ts → SimHost → Colony)              main thread
  Colony.tick() mutates ColonyState   ──snapshot/events──▶  SimBridge ─▶ renderer (three.js)
  applies Commands (place/route/…)    ◀──── Command ───────  + Vue store + Council
```

- **`worker/sim.worker.ts`** owns the engine and runs the fixed-cadence loop.
- **`worker/host.ts`** (`SimHost`) wraps a `Colony`, applies inbound `Command`s,
  and throttles outbound `Snapshot`s (~12 fps) and the event stream.
- **`worker/bridge.ts`** (`SimBridge`) is the main-thread client: it posts
  commands, exposes the latest snapshot, and fans events out to subscribers.
- **`src/render/renderer.ts`** reconciles building meshes against each snapshot
  and never touches the worker except through `SimBridge`.
- **`src/ui/stores/colony.ts`** is the single reactive store (module singletons,
  `useColony()` — there is no Pinia). Components read `snapshot`; `controls.*`
  issue commands.

## The worker protocol

`worker/protocol.ts` is the typed contract across the wall.

**Commands (main → worker):** `place`, `remove`, `rotate`, `move`, `route`,
`triggerHazard`, `setDirector`, `possess`, `moveIntent`, `respondTrade`,
`setPaused`, `setSpeed`, `forceStorm`, `reset`, `load`, `save`, `start`.

**Outbound (worker → main):** `ready`, `snapshot`, `events`, `saved`.

To add a player or agent action, the path is always the same: **add a `Command`
in `protocol.ts`, handle it in `host.ts`, expose it on `bridge.ts`.** The worker
is authoritative.

## The prediction seam

The main thread occasionally needs to *predict* engine behaviour for instant
feedback — the build ghost's valid/blocked tint, the auto-routed corridor preview.
That lives in `engine/predict.ts` and `engine/route.ts` and is **advisory only**:
it mirrors engine rules for previews, but the worker remains the single source of
truth. Predictions are never written back into simulation state.

## See also

- [engine.md](engine.md) — the deterministic sim in depth
- [agent-layer.md](agent-layer.md) — the Council, world model, Sentinel, Director
- [development.md](development.md) — how to extend each layer without breaking the wall
- [planning/vivarium-design.md](planning/vivarium-design.md) — the original design doc (§0 is this rule)
