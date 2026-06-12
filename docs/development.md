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
  render/        three.js renderer — iso camera, Mars terrain, procedural building kit,
                 postfx (bloom/ACES), storm/UFO FX, reaction bubbles, and the
                 PerfGovernor (perf.ts — the adaptive quality ladder behind AUTO)
  ui/            Vue 3 HUD overlay reading a single reactive store (stores/colony.ts);
                 stores/settings + stores/history (persisted prefs + run telemetry),
                 audio/ (procedural Web Audio — zero assets), hints.ts (one-shot toasts)
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

There are 31 test files (384 tests), weighted toward the guarantees that matter:

- `engine/engine.test.ts` — same seed + dt sequence → same future.
- `engine/campaign.test.ts`, `hazards.test.ts`, `predict.test.ts`,
  `route.test.ts`, `embodied.test.ts`, `ufo.test.ts`, `births.test.ts` — engine
  behaviour and the main-thread mirror.
- `engine/roster.test.ts`, `morale.test.ts`, `injury.test.ts` — the colonist
  layer: id-hash names/roles and the two-pass assignment, the morale drivers /
  latches / production-only effect, strike wounds and the Med-Bay heal rates.
- `engine/gather.test.ts`, `rover.test.ts`, `robots.test.ts` — the automation
  ladder: the shared gather brain (sticky claims, the need-aware ranking, the
  shared claim set across species), rover fabrication / cargo / strike
  dents / self-repair, robot fabrication fees and the flare/strike counterplay.
- `engine/generation.test.ts`, `unlocks.test.ts` — the wind curve and pass-2
  generation, the printer's `producesMat`, vent placement and the legacy
  backfill, and the unlock gates' latch-once semantics.
- `engine/difficulty.test.ts` — the profile rules: **`Colony(seed)` ≡
  `Colony(seed, "normal")` byte-for-byte after 600 s**, and the
  multipliers-apply-after-the-draw invariant (identical RNG draw counts across
  difficulties).
- `persistence/save.test.ts` — save → load round-trips bit-identically (including
  mid-injury and mid-fabrication), and old saves load with graceful field
  defaults.
- `worker/host.test.ts` — the command/snapshot loop.
- `render/perf.test.ts` — the PerfGovernor. The governor is the model citizen
  for testing renderer policy: `render/perf.ts` imports no DOM or three, so
  the ladder walk (calibration, demote/spike/promote evidence, cooldowns,
  pinning) is asserted in plain Node by feeding synthetic frame costs and
  timestamps.
- `agent/**` — council arbitration (incl. `council/banter.test.ts`: the quiet
  predicate, round-robin, and that banter never touches the real cooldowns;
  and the dry-register guard: every scripted line ≤140 chars, single-line),
  world model diagnosis, Sentinel, Director.
- `ui/**` — the node-safe pure halves of the UI: `stores/settings.test.ts`,
  `stores/history.test.ts`, `hints.test.ts`, and `audio/map.test.ts` (the
  event→cue / snapshot-diff mapping — no AudioContext is ever constructed).

Rare or scheduled events are tested by **state injection**, never by waiting:
set the timer/sol so the event is due *now* (the `ufo.test.ts` pattern, reused
for injuries and difficulty — build a minimal state, call the pass directly).
UI stores take **injectable storage**, so they run in plain Node.

One standing rule when extending `Snapshot`: two tests carry **complete
`Snapshot` literals** as fixtures — `makeSnap` in `agent/council/banter.test.ts`
and in `ui/audio/map.test.ts` — and they fail to compile the moment the type
grows. **Patch both fixtures in the same commit** that extends the type; that
churn is by design (it proves every consumer saw the new field).

## Driving the real app (Playwright)

For anything visual or interactive, drive the actual app rather than assuming
behaviour. A dev-only hook exposes the internals on `window`:

```js
window.__viv        // { renderer, bridge, settings, updateSettings, audio, director }
window.__sentinel   // the Sentinel instance
```

So you can `bridge.place(...) / route(...) / rotate(...) / reset(difficulty?)`,
read `bridge.latest` for the current snapshot, and screenshot the canvas. The
newer handles cover the rest of the surface:

- `renderer.setQuality("auto" | "low" | "high")` — drive the graphics tier live
  (AUTO hands it to the PerfGovernor; `renderer.perfInfo()` reads the
  governor's step/EMA/pinned state — note the 3 s calibration window anchors
  at the first frame, so it has usually elapsed by the time `__viv` appears);
  `renderer.debugFx("ufo" | "abduct" | "devil" | "pop")` makes the rare FX
  screenshotable on demand (the scripted saucer self-expires on a TTL).
- `audio.engineState()` (unlock/context state) and `audio.lastPlayed()` (the last
  ≤20 cues) let you assert sound without listening to it; `audio.cue(id)`
  auditions any cue after a click.
- `settings` / `updateSettings(patch)` — read and drive the persisted prefs.
- `director.bias() / comfort() / model()` — the Director's live brain.

This is how the renderer, placement, narrator, postfx, audio, and campaign were
validated — prefer it over guessing. Two workflow notes from the visual QA that
shipped the graphics pass:

- **Pause, then A/B.** `bridge.setPaused(true)` freezes the scene, so a
  `setQuality("high")` screenshot and a `setQuality("low")` screenshot diff
  cleanly (review shots live under `.playwright-mcp/visual-review/`).
- **Stage scenarios right after `reset()`.** An unattended colony reliably dies,
  so set up the state you want to look at immediately — don't let the sim run
  while you compose the shot (or pause it).

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
