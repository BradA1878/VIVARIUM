# Development

## Commands

```bash
npm install            # one-time
npm run dev            # Vite dev server → http://localhost:5180 (fully playable, no backend)
npm run server         # Hono backend on :8787 (live narrator + Mongo); Vite proxies /api → here
npm test               # Vitest: all *.test.ts under src/ and shared/
npm run typecheck      # vue-tsc --noEmit  (covers src/, shared/, server/) — run after edits
npm run build          # typecheck + vite build
```

Run one test file or test by name:

```bash
npx vitest run src/engine/engine.test.ts
npx vitest run -t "brownout sheds the lowest"
```

The fastest correctness loop is `npm run typecheck && npm test`.

## Project layout

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

See [architecture.md](architecture.md) for how these connect.

## The rule you cannot break

Everything in `src/engine/` must stay **deterministic and pure**. No three.js, Vue,
DOM, `fetch`, `await`, `Math.random`, `Date.now`, or `@tensorflow/*`. Use the seeded
RNG (`engine/rng.ts`). The determinism tests will catch a violation — but understand
*why* it matters first: replay, exact save/resume, and the whole agent layer's
safety all rest on it ([architecture.md](architecture.md)).

## Common extension recipes

**Add or rebalance a building** — edit `engine/defs.ts` (and `tuning.ts` for global
knobs). Add it to `ORDER` for the palette. No engine logic changes; the tick already
runs any recipe. Add a kit mesh in `render/three/kit/` if it needs a new silhouette.

**Add a player or agent action** — add a `Command` in `worker/protocol.ts`, handle it
in `worker/host.ts`, and expose it on `worker/bridge.ts`. The worker stays
authoritative; if the main thread needs an instant preview, mirror the rule in
`engine/predict.ts` (advisory only).

**Add a narrator beat** — add a scripted line in `agent/lines.ts` and have the
relevant voice in `agent/council/` consider it. The `gate` decides whether it ever
reaches the live model.

## Testing & determinism

There are 14 test suites, weighted toward the guarantees that matter:

- `engine/engine.test.ts` — same seed + dt sequence → same future.
- `engine/campaign.test.ts`, `hazards.test.ts`, `predict.test.ts`,
  `route.test.ts`, `embodied.test.ts` — engine behaviour and the main-thread mirror.
- `persistence/save.test.ts` — save → load round-trips bit-identically.
- `worker/host.test.ts` — the command/snapshot loop.
- `agent/**` — council arbitration, world model diagnosis, Sentinel, Director.

## Driving the real app (Playwright)

For anything visual or interactive, drive the actual app rather than assuming
behaviour. A dev-only hook exposes the internals on `window`:

```js
window.__viv        // { renderer, bridge }
window.__sentinel   // the Sentinel instance
```

So you can `bridge.place(...) / route(...) / rotate(...) / reset()`, read
`bridge.latest` for the current snapshot, and screenshot the canvas. This is how the
renderer, placement, narrator, and campaign were validated — prefer it over guessing.

## Backend (optional)

The game needs no backend or keys. To enable the live narrator and networked saves:

```bash
cp .env.example .env   # then fill in values
npm run server         # Hono on :8787; Vite proxies /api → here
```

| Env var | Effect |
|---|---|
| `ANTHROPIC_API_KEY` | Enables the live MXF narrator (server-side only). Without it, `/api/narrate` 503s and the client uses scripted lines. |
| `NARRATOR_MODEL` | Override the model (default `claude-opus-4-8`). |
| `VITE_LIVE_NARRATOR` | `1` opts the **client** into live generation (default off). |
| `MONGODB_URI` / `MONGODB_DB` | Networked saves; falls back to localStorage if unreachable. |

The provider key never touches the client — the gate, rate limit, signature cache,
and circuit breaker all live server-side ([agent-layer.md](agent-layer.md)).

## Scope

Treat [planning/vivarium-design.md](planning/vivarium-design.md) as the project's
*starting point*, not a spec — the codebase has deliberately grown past it (the
embodied colony, corridors/doors, alien trade, and the Director all postdate it).
The design specs under [superpowers/specs/](superpowers/specs/) capture those
later additions. Surface genuine engineering tradeoffs — above all anything that
would compromise engine determinism — as informed choices, not scope vetoes.
