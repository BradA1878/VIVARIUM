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
`triggerHazard`, `setDirector`, `possess`, `moveIntent`, `interact`,
`respondTrade`, `setPaused`, `setSpeed`, `forceStorm`, `reset`/`start`
(optionally carrying the next run's difficulty + the PTP founding seed/world/
legacy), `load`, `save`, `launchPtp`, `switchColony`, `dispatchShipment`.

**Outbound (worker → main):** `ready`, `snapshot`, `events`, `saved`,
`catchupReport` (the "while you were away" digest input — deliberately not
routed through the event stream), and `error` — a surfaced failure (a thrown
command/step, a save that wouldn't load, a dead worker, a lost co-op host).
The boundary never wedges silently: the worker shell try/catches and posts,
`SimHost` survives a corrupt `load`/`switchColony` without losing the live
colony, and the store renders the error as a dismissible banner.

To add a player or agent action, the path is always the same: **add a `Command`
in `protocol.ts`, handle it in `host.ts`, expose it on `bridge.ts`.** The worker
is authoritative.

## The bridge is the network seam (co-op)

`BridgeCore` (`src/worker/bridge.ts`) holds everything the renderer and store
depend on minus the transport: the snapshot/event/error subscriptions, the
latest-snapshot cache, the synchronous predictors, and the per-client
`possessed` re-derivation (`localActor` — the architect sees `null` and can
build; a guest sees its own claimed astronaut). `SimBridge` supplies the Web
Worker transport (solo and the co-op host); a guest's `NetBridge`
(`src/net/netBridge.ts`) supplies a Trystero data channel to the host instead —
no worker runs on a guest. The host's `HostRelay` (`src/net/hostRelay.ts`) is
the authority boundary: it claims a free colonist per guest, attributes each
guest's input to it, drops build commands from astronauts, and broadcasts
snapshots/events. Session failures ride the same error channel: `NetBridge`
reports a lost host (`net-lost`) and a join nobody answers (`net-timeout`).
`src/net/` is main-thread only — the engine never knows the network exists.

## Multi-world and persistence (main-thread meta state)

Slot-keyed saves, the Colonies ledger, and the inter-planet shipment queue live
in `src/persistence/` — deliberately **not** engine state. Founding seeds and
away-colony catch-up step counts are computed main-side (`src/ui/founding.ts`)
and handed to the engine as plain data; switching to a settled world replays the
real seeded tick (`Colony.fastForward`, chunking-invariant), and matured
shipments are credited as seed-state on switch — never a live cross-colony
write. CLAUDE.md's multi-world bullet carries the full contract.

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
