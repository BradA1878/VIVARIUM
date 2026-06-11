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

The scripted banks (`agent/lines.ts`) cover every engine beat, including the
newer ones: morale crossing its low/recovered thresholds, colonists wounded and
healed, and **strike casualties** — a death by meteor carries no resource key, so
the `casualty` bank routes its `"strike"` detail to its own variants instead of
falling silent. The boot greeting bends to the run's difficulty: easy and hard
runs get their own `bootLines(difficulty)` send-offs ("This site kills colonies.
… Prove the records wrong."), and the line re-fires in the new register on reset.

### Idle banter — the quiet channel

When nothing has happened for a while, the council talks among itself.
`Council.observeIdle()` runs on a **separate, slower clock** from the event path:
it fires only when the channel has been quiet for a rerolled **25–40 sim-second**
window AND the colony is genuinely uneventful (no hazards, no shortfall timers,
no trade or UFO on the board, not paused, not ended). Voices that implement the
optional `Voice.considerIdle()` are polled **round-robin from a rotating start**
(so VIVARIUM never owns the tie), each limited to one banter line per **90
sim-seconds** — the Watcher names the tightest margin, the Strategist nudges a
build, the Chronicler reminisces.

Two structural guarantees matter more than the lines: banter **never marks the
global/voice/topic cooldowns**, so a real event arriving one second after a
banter line speaks as if nothing was said — banter can never delay news. And the
idle path returns a finished scripted `Utterance`, sharing nothing with
`shouldSpeak`/`narrateLive` — it is **incapable of reaching the live model** by
construction.

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
with the `setDirector` command — the settings menu exposes it, and off hands
hazards back to the engine's own scheduler (manual hazard buttons still work
either way).

### Attribution — letting the player feel the hand

Occasionally, the player is allowed to notice the Director. When it fires a
hazard, the colony store remembers the strike; if a matching `hazard_warn`
arrives within 3 sim-seconds, the store annotates **its own copy** of the event
with `directed: true` before routing it to the council — a UI-side annotation on
the `ColonyEvent` clone, which **the engine never sets** (the wall holds). The
Watcher and the Chronicler have attribution variants for that flag ("This storm
did not come from the weather. Something chose it.").

The reveal is paced, not random: it only happens for players with **≥2 recorded
runs** (a first-timer can't appreciate the tell), and then on a **deterministic
every-third counter** — the first eligible warning of a run is always annotated,
then every third after it. A counter instead of a die roll keeps the pacing
testable and guarantees a returning player actually sees the tell. Full
transparency waits for the end screen, where the Director's cross-run player
model is laid out as the **dossier** ("WHAT THE PLANET HAS LEARNED"). In DEV
builds, `window.__viv.director` exposes the live readout — `bias()`, `comfort()`,
and `model()` — so you can watch it think.

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

The breaker's state is also **honest to the player**: `agent/client.ts` exposes a
read-only `liveNarratorHealthy()` accessor, and the settings modal samples it
each time the panel opens — if the live toggle is on but the circuit is open, a
note says so ("server unreachable — speaking from the script") rather than
letting the toggle lie. Display only; it never changes narration behavior.

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
