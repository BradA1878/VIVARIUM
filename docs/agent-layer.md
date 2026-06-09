# The Agent Layer

VIVARIUM isn't one of the buildings — it's the intelligence narrating and pressing
on the colony from the **main thread**. Every part of the agent layer obeys the
same discipline: it *observes* the engine's snapshot + event stream and, at most,
issues typed `Command`s back. It never reaches into the tick, and the engine never
`await`s it. (See [architecture.md](architecture.md).)

Four cooperating pieces live here:

```
ColonyEvent stream ─▶ gate ─▶ Council (4 voices) ─▶ scripted line  ──▶ terminal
                                     │
                                     └─▶ live MXF (client → /api/narrate) ─┘
world model (causal graph)  ─── feeds ──▶ the Watcher
Sentinel (TF.js autoencoder) ── feeds ──▶ the Watcher + a "comfort" signal
Director (antagonist) ─── issues triggerHazard Commands ──▶ the engine
```

## The Council — a chorus, not a voice

`src/agent/council/` is the narrator: four voices, each a stateless
`Voice.consider(ctx)` that may or may not offer a line for the current beat.
`Council` (`index.ts`) arbitrates by **severity and per-voice cooldowns** so only
one speaks per beat, each in its own register in the terminal:

- **VIVARIUM** — the keeper. Speaks to most events; serif italic.
- **The Watcher** — a Sentinel-class anomaly intelligence. It reads the causal
  **world model** to name *why* a pool is failing, and its "eyes" are the
  TensorFlow.js Sentinel below.
- **The Strategist** — reads bottlenecks and recommends the next build.
- **The Chronicler** — the long memory: milestone sols, the dead, the campaign's
  last entry.

## The causal world model

`src/agent/worldmodel/` is a pure, deterministic graph of the colony — producers,
consumers, pools, and the dependencies between them. `diagnoseShortfall()` traces a
failing pool **down the cascade to its root cause** (oxygen → starved electrolysis
→ no water → the storm took the light). The Watcher narrates from this, so its lines
explain causes rather than just reporting symptoms. There's a `WorldStore` seam
where a graph-database-backed store could drop in later; the in-memory graph covers
the game today.

## The Sentinel — learned anomaly detection

`src/agent/sentinel/` is a **TensorFlow.js autoencoder** that learns the colony's
"normal" telemetry online and flags drift the fixed-threshold alerts miss. It is
**non-deterministic and main-thread only** — it never touches the engine. tf.js is
lazy-imported so it stays out of the main bundle, and the whole subsystem
**degrades to a no-op** if it fails to load. Beyond feeding the Watcher, it emits a
**comfort** signal (how settled the colony feels, 0..1) that the Director reads.

## The Director — the planet's tactician

`src/agent/director/` is the **antagonist**, and it's the clearest illustration of
the wall. It watches the colony and, on its own pacing, picks the hazard that would
press the weakest seam — escalating gap and intensity over the sols, biased by
cross-run **memory** of how this player tends to die and by the Sentinel's comfort
signal (it presses harder when you've grown comfortable). It never stacks hazards
and backs off while a pool is already going lethal.

Because it's the non-deterministic antagonist and *not* the engine, the Director is
allowed to use `Math.random`. It proposes by firing a `triggerHazard` **Command**;
the engine applies and logs the hazard inside the deterministic tick. So the core
stays pure even though its adversary is improvising. The Director can be toggled
with the `setDirector` command (manual hazard buttons still work either way).

## The live narrator (MXF) — optional, fenced off

The game ships fully playable with **scripted** lines (`agent/lines.ts`). When
opted in, those same beats can be generated live:

1. The **gate** (`agent/gate.ts`) short-circuits on event type / severity /
   cooldown **before** any model call — most beats never reach the network.
2. `agent/client.ts` calls the Hono backend `/api/narrate` with a **per-persona**
   prompt (`server/mxf/prompt.ts`), so each voice keeps its register.
3. The endpoint is **rate-limited** and **caches by event signature**, and the
   provider key lives **server-side only** (Vite proxies `/api` → the Hono server).
4. A **circuit breaker** and a scripted fallback mean any failure, timeout, or
   missing key silently degrades to the offline lines. The game never depends on
   the model.

This is what keeps a public, auth-free Easter egg from becoming a cost faucet.

### Enabling it

| Env var | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Enables `/api/narrate` (server-side only). Without it the endpoint 503s and the client uses scripted lines. |
| `NARRATOR_MODEL` | Override the model (default `claude-opus-4-8`; e.g. `claude-haiku-4-5` for a cheap public build). |
| `VITE_LIVE_NARRATOR` | Set to `1` to opt the **client** into live generation (default off → pure scripted, no network). |

See [development.md](development.md) for running the backend.

## See also

- [architecture.md](architecture.md) — why the agent layer can never block the tick
- [engine.md](engine.md) — the snapshot + events the agent layer reads
- [gameplay.md](gameplay.md) — the Director's hazards from the player's side
