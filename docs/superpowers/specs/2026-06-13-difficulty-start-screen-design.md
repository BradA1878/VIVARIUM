# Difficulty start screen — design

- **Date:** 2026-06-13
- **Status:** mechanism approved (true start gate), pending spec review
- **Origin:** playtest feedback — "before a new game starts, the player should be able to select the difficulty level."
- **Sequencing:** implementation is queued **after** the water-tier build lands (both touch `host`/store/boot area; avoid a working-tree collision). This feature is independent and small.

## Problem

Difficulty is already fully built in the engine — it's only missing a front door.

- `Difficulty = "easy" | "normal" | "hard"` with real profiles: grace period, campaign deadline, hazard gap + intensity, UFO pacing, and starting materials (`tuning.ts:317-320`).
- The `reset(difficulty)` path, snapshot/save round-tripping, and a picker in the Settings modal (CALM / STANDARD / BRUTAL) all work today (`colony.ts:46,74`, `protocol.ts:25`, `SettingsModal.vue:37-40`, `stores/colony.ts:407`).

What's missing: a moment **before a new game** to choose. Today the sim **auto-starts live** — `Boot.vue` is just a cosmetic cold-open curtain over an already-running colony, and difficulty changes in Settings only apply on the *next* reset, which is buried and non-obvious.

There's also **dormant start-gate infrastructure** clearly built for this and never wired: a `start` command that's a no-op (`host.ts:40`) and a `started` flag. We wire it up.

## Goal

A fresh game opens on a **start screen** where the player picks difficulty and clicks **Begin**; the sim genuinely waits until then. Resumed saves skip the screen and continue at their saved difficulty.

## Non-goals

- No new difficulty *content* — reuse the existing three profiles and their CALM / STANDARD / BRUTAL labels.
- No seed entry on the screen (difficulty only; seed UI can come later).
- No change to the engine tick or determinism.

## Design

### The start gate (worker/host level — engine untouched)

The gate lives in `SimHost`, **not** in the engine, because hundreds of tests do `new Colony(seed); c.tick(...)` and rely on the engine ticking eagerly. The engine stays exactly as-is.

- `src/worker/host.ts` — add `private started = false;`. In `step()`, advance the tick only when started: `if (!this.colony.paused && this.started) { … colony.tick … }` (snapshots still flow on the interval, so the UI can paint the static initial colony behind the screen).
- `case "start"` (currently a no-op) becomes: `this.colony.reset(cmd.difficulty); this.started = true;` — apply the chosen difficulty via the existing deterministic reset path, then begin.
- `case "load"` sets `this.started = true;` — a resumed save is already in progress, so it ticks immediately and never shows the screen.
- `case "reset"` (the in-game "next run" path) leaves `started` as-is (already true in-game), so the Settings/EndScreen restart flows are unchanged.

### Protocol + bridge

- `src/worker/protocol.ts` — `start` gains a payload: `{ type: "start"; difficulty?: Difficulty }`.
- `src/worker/bridge.ts` — add a `start(difficulty)` method mirroring the existing command senders (e.g. `reset`).

### The start screen (UI)

- New `src/ui/components/StartScreen.vue` — the VIVARIUM wordmark over **three difficulty cards**, reusing the Settings labels (CALM / STANDARD / BRUTAL) and showing what each actually changes so the choice is informed:
  - **CALM** — longer grace, gentler & rarer hazards, generous starting materials, longest campaign (28 sol).
  - **STANDARD** — the baseline the game is tuned around.
  - **BRUTAL** — short grace, fiercer & more frequent hazards, lean start, shortest campaign (18 sol).
  - A **Begin** button. Selecting a card highlights it (mirror `SettingsModal.vue`'s `.on` pattern); Begin commits.
- Numbers are pulled live from `DIFFICULTY[...]` so the cards never drift from the profiles.

### Boot flow (`App.vue` + store)

- Current: `booting` → `Boot.vue` → `@done` sets `booting=false`, sim already live.
- New: `Boot.vue` cold-open plays as today; then, **for a fresh game**, show `StartScreen` while the sim is gated (`started=false`). On **Begin**, the store calls `start(difficulty)` → the sim begins → hide the screen. **For a resumed save**, skip `StartScreen` entirely (the store already distinguishes save-vs-fresh around `stores/colony.ts:292`).
- **Greeting timing:** the council `bootLine` greeting currently fires on init pitched to the run's difficulty (`stores/colony.ts:308,428`). For a fresh game it moves to the `start(difficulty)` action so it greets in the *chosen* register; a resumed save greets on load as today.
- `SettingsModal` keeps its picker as the "next run" control (changing it mid-run still applies on the next reset).

## Determinism & the wall

- The gate is **host-level state** (`SimHost.started`), not engine state — the engine tick, RNG streams, and every determinism/replay/save test are untouched.
- `start{difficulty}` reuses the existing deterministic `reset(difficulty)` path; no new RNG, no new engine code.
- `StartScreen.vue` is main-thread UI (Vue), correctly on the render side of the wall.

## Files touched

- `src/worker/protocol.ts` — `start` carries `difficulty?`.
- `src/worker/host.ts` — `started` gate in `step()`; `start`/`load` set it.
- `src/worker/bridge.ts` — `start(difficulty)` sender.
- `src/ui/components/StartScreen.vue` — **new**.
- `src/ui/App.vue` — boot → start-screen flow; render `StartScreen` for fresh games.
- `src/ui/stores/colony.ts` — `start(difficulty)` action; fresh-vs-save gating; move the fresh greeting into `start()`.
- *(optional)* `src/ui/components/EndScreen.vue` — "play again" can route back to the start screen to re-pick difficulty.

## Testing

- **Host (`src/worker/host.test.ts` or equivalent):** a fresh `SimHost` does **not** advance the colony on `step()` until a `start` arrives; after `start{difficulty:"hard"}` the colony ticks and carries the hard profile; `load` resumes ticking with no `start`.
- **Existing suites stay green** — engine determinism untouched.
- **Playwright (`window.__viv`):** a fresh load shows `StartScreen`; pick BRUTAL → Begin → the run reflects hard (grace/deadline); reload a save → screen is skipped and the run resumes.

## Open questions / toggles

1. **EndScreen "play again"** — route back to the start screen (re-pick difficulty) vs. restart directly on the last difficulty. Default: route back (the screen already exists; it's nearly free).
2. **Card detail** — show exact numbers (grace seconds, deadline sol, material counts) vs. qualitative ("longer grace, fiercer hazards"). Default: qualitative with a couple of concrete anchors (deadline sol, start materials).
3. **Seed entry** — out of scope here; the start screen is a natural future home for it.
