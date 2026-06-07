# VIVARIUM

A 3D Mars-colony survival sim, narrated by the colony AI that keeps it alive —
**VIVARIUM**. Resource balance is the whole game: power → water → oxygen → food,
with batteries and tanks as the buffers that carry the colony through the dark.
Built as a hidden Easter egg for bradanderson.org.

See [`Docs/Planning/vivarium-design.md`](Docs/Planning/vivarium-design.md) for the
full design. The original feel-and-mechanics prototype lives in `design/`.

## The one rule (doc §0)

Two layers, with a hard wall between them:

1. **The Engine** — deterministic, synchronous, ~5 Hz. Runs start to finish with
   no network, no LLM, no async. Lives in a **Web Worker**. Fully playable alone.
2. **The Agent Layer** — VIVARIUM. Asynchronous, event-driven, *optional*. It
   only *observes* the engine's snapshot + event stream and narrates. It never
   reaches into the tick; the engine never `await`s it.

## Architecture

```
src/
  engine/        pure deterministic sim (no DOM / three / async) — runs in the worker
  worker/        sim.worker.ts hosts the engine; bridge.ts is the main-thread client
  render/        three.js renderer — iso camera, Mars terrain, procedural building kit
  ui/            Vue 3 HUD overlay (pointer-events:none) reading a reactive store
  agent/         VIVARIUM — gated scripted narrator + live-narrator client
  persistence/   save serialization, localStorage + Mongo adapters
server/          Node + Hono — live MXF narrator endpoint + Mongo persistence
shared/          the neutral vocabulary spoken across the wall (events, snapshot)
```

The engine lives in the worker; the renderer, HUD, and agent layer live on the
main thread and only consume the worker's output.

## Run it

```bash
npm install
npm run dev          # Vite dev server → http://localhost:5180
```

The three.js renderer is lazy-loaded behind the colony view, so the heavy bundle
stays off the main page (doc §1). The game is fully playable with **no server and
no env vars** — the narrator falls back to scripted lines and saves go to
localStorage.

### Optional: live narrator + Mongo persistence

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

The `gate()` short-circuits on event type / severity / cooldown **before** any
model call, and the endpoint is rate-limited and caches by event signature — so a
public, auth-free toy can't become a cost faucet (doc §3.2).

## Test

```bash
npm test             # Vitest — engine determinism, worker loop, narrator gate, save round-trip
npm run typecheck    # vue-tsc
npm run build        # type-check + production build
```

The engine is deterministic and replayable: same seed + same dt sequence → same
future, and a save resumes bit-identically.

## Play

- **Build palette** (bottom center) — place a Pressure Hub first, then corridors
  to carry the seal, habitats, solar arrays + batteries for power, an ice
  extractor and electrolysis for water→oxygen, hydroponics for food. Right-click
  cancels; the ghost shows valid (cyan) / blocked (rust).
- Watch power fall at dusk and the battery carry the colony through the night.
- Trigger a dust storm (top bar) — solar guts to ~12%.
- Let a pool empty and the grace timer counts down to a casualty.
- Earth resupply windows arrive on a schedule and refill the buffers.

## Notes

- **Procedural kit, not Blender.** The doc calls for a Blender→glTF kit; this
  environment can't run Blender, so the buildings are procedural three.js meshes
  reproducing the prototype silhouettes. `render/three/kit/` keeps a `GLTFLoader`
  seam so real `.glb` assets can drop in later with no call-site changes.
- **Easter-egg embedding.** Standalone, `index.html` boots the game directly. On
  the host site it sits behind a trigger; mounting `App.vue` is the integration
  point, and the renderer chunk is already split out for lazy load.
