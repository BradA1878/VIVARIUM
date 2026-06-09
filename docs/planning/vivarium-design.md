# Vivarium — Design Doc

A 3D Mars-colony survival sim. Hidden Easter egg on bradanderson.org. The colony
is kept alive by an AI named **VIVARIUM** — the title is its designation.

Genre lineage: *Surviving Mars* / *Oxygen Not Included*. Resource balance as the
whole game. The planet supplies the motivation; you don't have to fudge demand.

---

## 0. The one rule everything hangs on

There are **two layers**, with a hard wall between them:

1. **The Engine** — deterministic, synchronous, ~5 Hz. This is the game. It runs
   start to finish with no network, no LLM, no async. Fully playable on its own.
2. **The Agent Layer** — VIVARIUM. Asynchronous, event-driven, *optional*. It
   *observes* the engine and narrates. It never reaches into the tick.

> The engine must never `await` the agent layer. The agent layer reads a snapshot
> and an event stream; it has no authority over simulation state. If you remember
> one thing, remember this. Latency and cost both die on this hill.

---

## 1. Stack

| Concern        | Choice                | Layer   | Notes |
|----------------|-----------------------|---------|-------|
| Render         | three.js              | Engine  | Lazy-loaded behind the Easter-egg trigger. Heavy bundle; keep it off the main page. |
| UI chrome      | Vue 3                 | Engine  | Panels, readouts, tool palette **only**. Canvas stays imperative. Not TresJS for the base itself. |
| Assets         | Blender → glTF (.glb) | Engine  | Modular kit (hab, dome, solar array, corridor) → `InstancedMesh` for repeats. |
| Sim runtime    | TypeScript            | Engine  | Plain TS, runs in a Web Worker. State in typed arrays where it's grid-shaped. |
| Persistence    | Mongo *or* localStorage | Engine | Save state is tiny. Mongo because you already run it; localStorage is honestly enough. |
| Narrator       | MXF (1 agent)         | Agent   | Observes events, speaks. Async. Council-of-N is a later flourish. |
| World model    | Memgraph              | Agent   | **Deferred.** Snapshot-into-prompt covers v1. Only if the agent layer grows. |
| ML             | TensorFlow.js         | —       | **No identified use yet.** See Open Questions. |
| API            | Node + Hono           | Agent   | Thin endpoint the narrator calls. Engine doesn't need a server to run. |

---

## 2. The Engine

### 2.1 A building is data, not code

The atom of the whole project. The engine has no idea what a greenhouse *is* — it
runs recipes against resource pools. Your entire tech tree becomes JSON, and
balancing is editing numbers, never touching the engine.

```ts
type Resource = "power" | "water" | "oxygen" | "food" | "labor";

interface BuildingDef {
  id: string;
  name: string;
  footprint: [w: number, h: number];              // grid cells
  buildCost: Partial<Record<Resource, number>>;
  staffing: number;                                // labor slots to run at full
  consumes: Partial<Record<Resource, number>>;     // per tick, at full operation
  produces: Partial<Record<Resource, number>>;     // per tick, at full operation
  requiresPressure: boolean;                        // must flood-fill to a hub
  priority: number;                                 // power-allocation rank (life support high)
}

// e.g.
const greenhouse: BuildingDef = {
  id: "greenhouse",
  name: "Hydroponics Greenhouse",
  footprint: [2, 2],
  buildCost: { power: 0 },
  staffing: 2,
  consumes: { power: 8, water: 4 },
  produces: { food: 6, oxygen: 3 },
  requiresPressure: true,
  priority: 30,
};
```

### 2.2 Pools are buffers, and buffers are load-bearing

```ts
interface Pool {
  amount: number;
  capacity: number;   // batteries, O2 tanks, water cisterns, food stores
}
```

The buffer isn't a convenience — it's what makes the sim *solvable*. Real life
balances simultaneous resource flow only because tanks and batteries absorb the
slack. Same trick breaks the dependency cycles in your tick: produce into a
buffer, consume from it, never solve a system of equations.

### 2.3 Connectivity is a boolean gate

`requiresPressure` buildings are "online" only if a flood-fill from a central hub
reaches them through adjacent pressurized corridors. That's it. This is SimCity's
road-and-power check, reskinned as life support. **You are explicitly not
simulating flow through pipes.** Per-segment pressure/cable routing is the deep
version and a genuine rabbit hole — leave the door open, don't walk through it.

### 2.4 The tick: ordered passes, not one equation

~5 Hz sim, 60 Hz render, decoupled. Each tick:

```ts
function tick(state: ColonyState, dt: number) {
  // 1. Environment — solar follows the sol phase, throttled hard by dust storms
  const solar = solarOutput(state.sol, state.weather);

  // 2. Generation into buffers
  produce(state.pools.power, solar * state.solarCapacity);

  // 3. Power demand by priority — brownout shuts off the BOTTOM of the list first
  const online = allocatePower(state.buildings, state.pools.power);

  // 4. Production — only buildings that are online AND connected AND staffed AND fed
  for (const b of online) {
    if (b.def.requiresPressure && !b.connected) continue;
    if (!hasInputs(state.pools, b.def.consumes)) continue;
    if (!claimLabor(state, b.def.staffing)) continue;
    runRecipe(state.pools, b.def);              // consume inputs, produce outputs (capped by buffer)
  }

  // 5. Colonist consumption
  consume(state.pools, colonistDemand(state.population));

  // 6. Shortfalls become TIMERS, not instant death (grace + drama)
  updateLifeSupportTimers(state, dt);           // empty O2 → per-hab suffocation countdown

  // 7. Emit events — for the UI, and (optionally) for VIVARIUM
  state.events.push(...detectEvents(state));
}
```

Deterministic, debuggable, replayable. The whole feel of the genre lives in pass
3 and pass 6.

### 2.5 The heartbeat: the cascade

Power is the root. Water depends on power. Oxygen depends on power *and* water.
Food (plants) sits on both. Lose power and the chain stalls — your battery, O2
tank, and food store are the only thing between you and a dead colony.

So **solar following day/night, gutted during dust storms, *is* the gameplay.**
"Will the buffer carry me through the dark" — the exact off-grid tension, with
suffocation instead of a dead fridge. Earth resupply windows layered on top later
give you a campaign arc: self-sufficient before the launch window closes, or else.

### 2.6 Colonists are a dual resource

They **consume** O2/water/food/hab-space and they **provide** labor — a greenhouse
with no worker produces nothing. Population is a scalar; labor is a pool buildings
claim slots from. Morale, sanity, individual named agents: all deferrable. Do not
build a colonist agent sim until the resource layer is fun.

---

## 3. The Agent Layer (optional / later)

This is where MXF lives, and where the Easter egg gets its soul. **None of it is
required for the game to be good.** Build it after the engine is fun.

### 3.1 VIVARIUM observes; it does not control

```ts
// The engine emits. The narrator consumes — asynchronously, out of the tick.
colony.on("event", async (e: ColonyEvent) => {
  if (!vivarium.gate(e)) return;                 // cheap pre-LLM short-circuit
  const line = await vivarium.respond(e, colony.snapshot());
  ui.speak(line);                                // VIVARIUM's voice on screen
});
```

The `gate()` is the pre-LLM condition primitive — short-circuit on event type /
severity / cooldown *before* spending a call. Most events never reach the model.
This is what keeps a public Easter egg from being a cost faucet.

### 3.2 Cost / abuse posture for a public toy

No auth on a public site means every visitor can trigger calls. So:

- Public build: scripted/cached lines keyed by event type, with live generation
  rare and heavily gated — or routed to local Gemma, not metered OpenRouter.
- Live MXF generation: reserve for when *you're* playing, or a private build.
- Never ship your provider key into a public client. Narrator calls go through the
  thin Hono endpoint, rate-limited, or not at all in the public version.

### 3.3 Memgraph — the deferred world model

A small base serializes to JSON that drops straight into a prompt. That covers v1.
Memgraph earns its keep only when the agent layer becomes *several* agents
(Sentinel-style: a watcher, a strategist, a chronicler) sharing a causal/temporal
model of the base — "this hab depends on this O2 line depends on this electrolysis
unit depends on this reactor." Until then it's an extra service to keep alive for a
toy. Door open, not walked through.

---

## 4. Visual identity & reference prototype

Claude Design built a working reference prototype from this doc. It earns a place
here for two reasons: it proves the engine (§2) and narrator (§3) specs run *as
written* — the building-as-data tech tree, the ordered-pass tick, the gated
scripted narrator are all literally implemented — and it establishes the **visual
identity** below.

One honest caveat up front: **the prototype renders in Canvas 2D isometric, not
three.js.** It is a feel-and-mechanics prototype, not the production renderer.
That's a deliberate, good call — it locks the look and the game loop cheaply (the
fast path), and it *de-risks* the 3D target in §1 because everything behind the
canvas is already proven; the renderer becomes the only remaining unknown. It's
also single-file React + Babel-over-CDN — a sketchpad, not the Vue 3 shell. Carry
the identity and tuning into the real stack; don't ship the sketchpad.

### 4.1 Palette

Observatory-dark. Near-black ground, one cyan "signal" accent, rust→orange as
things escalate toward death. Panels are glass (backdrop-blur) floating over the
Mars surface, hairlined in faint cyan.

| Token | Value | Role |
|-------|-------|------|
| `--void` / `--void2` | `#07090b` / `#0b0e12` | background, deep dark |
| `--ink` | `#c3d0d6` | primary text (cool grey-blue) |
| `--dim` / `--faint` | `#6a7a82` / `#3a464c` | secondary / tertiary text |
| `--cyan` | `#7fd4e8` | signal accent — VIVARIUM's eye, brand mark, selection, "good" |
| `--rust` | `#c8794f` | warning / low |
| `--crit` | `#e8784f` | critical — empty pool, casualty, storm (pulses) |
| `--panel` | `rgba(12,16,20,.74)` | glass panel fill (+ `blur(9px)`) |
| `--hair` / `--hair2` | cyan @ .12 / .06 | hairline borders |

### 4.2 Typography — the voice split (the standout decision)

Two families, divided *semantically* — and this is the move that makes VIVARIUM
feel like a presence instead of a status bar:

- **IBM Plex Mono** — the machine. Telemetry, numbers (tabular-nums everywhere),
  labels, controls, the boot log. Cold and exact.
- **Newsreader, italic** — the *intelligence*. VIVARIUM's name and every line it
  speaks, plus building descriptions and tooltips.

The colony's instruments talk in mono; the thing watching talks in serif italic.
Keep that rule absolute — it's free characterization.

### 4.3 Screen anatomy

The HUD is a `pointer-events:none` overlay on the full-bleed canvas, under a radial
vignette. Regions:

- **Top bar** — brand (pulsing cyan mark + italic "VIVARIUM") and right-side
  controls: pause, speed (1×/2×/3×), a storm trigger.
- **Left rail** — sol clock with an SVG dial + phase + weather line (turns rust in
  a storm); the four **resource readouts** (amount/cap, per-second flow, ETA-to-
  empty, with low/critical color and a flash when a pool bottoms out); crew count
  (alive / housing).
- **Right column** — the **alert stack**, severity-colored (sev2 rust, sev3 crit +
  pulse), left-edge bars.
- **Bottom-left** — the **VIVARIUM terminal**: pulsing eye, italic-serif lines with
  mono timestamps, blinking caret. Where the narrator speaks.
- **Bottom-center** — the **inspector chip** (what's under the cursor) + the
  **build palette** (glyph tiles) with hover tooltips showing each recipe.
- **Boot** — a cold open that fades out: the giant italic "VIVARIUM" wordmark, a
  boot log, and "I am VIVARIUM…" as the first terminal line.

### 4.4 The building palette (§2.1, made real)

The prototype concretizes the tech tree into ten buildings — the v1 content set.
Rates are per second at full operation; brownout sheds **lowest priority first**,
so farming starves before life support.

| Building | Foot | Staff | Consumes /s | Produces /s | Storage | Press. | Pri |
|----------|:----:|:----:|-------------|-------------|---------|:------:|:---:|
| Pressure Hub | 2×2 | — | power 1.5 | — | +30 O₂ | source | 99 |
| Corridor | 1×1 | — | power 0.2 | — | — | conduit | 95 |
| Habitat | 1×1 | — | power 1.0 | houses 4 | — | ✓ | 88 |
| Electrolysis | 1×1 | 1 | power 7 + water 2.5 | **O₂ 5** | — | ✓ | 82 |
| Ice Extractor | 1×1 | 1 | power 5 | **water 4** | — | — | 45 |
| Hydroponics | 2×2 | 2 | power 6 + water 3 | **food 5** + O₂ 2 | — | ✓ | 30 |
| Solar Array | 2×2 | — | — | **+22 power** (follows sun) | — | — | 0 |
| Battery Bank | 1×1 | — | — | — | +120 power | — | 0 |
| Water Cistern | 1×1 | — | — | — | +160 water | — | 0 |
| Oxygen Tank | 1×1 | — | — | — | +130 O₂ | — | 0 |

The cascade falls straight out of the priorities: **power → water → oxygen →
food**, with tanks and batteries as the buffers that carry the colony through the
dark.

Starting balance knobs the prototype settled on: per-colonist demand O₂ 0.22 /
water 0.16 / food 0.12 per sec; sol length 150 s; **55 s grace** after a pool
empties before it turns lethal; dust storms gut solar to **12%**.

### 4.5 VIVARIUM's voice (§3, made real)

The prototype ships the cheap public-build narrator exactly as specced: scripted
line banks keyed by event type, no LLM, no network. The `gate()` short-circuits on
**6.5 s global cooldown / 22 s per-type / severity override** — a casualty speaks
through anything; a `build` event speaks ~18% of the time so it doesn't natter.

The thing to preserve is the character brief — *a colony AI that has watched too
long: caring, exact, a little wrong.* The register, in its own words:

> Sol 4. Nothing died in the night. This time.

> Not enough power for all of you. I am switching off the lowest first. Forgive me.

When the live MXF version eventually gets built, that's the voice it has to match.
Pin the system prompt to *this*, not a generic helpful-assistant tone.

### 4.6 What the prototype settles, and what's still open

- **Renderer:** chose 2D iso to lock feel fast. The 3D target (§1) is intact and
  now de-risked — only the canvas layer changes. (Folded into §7.)
- **Voice:** single, scripted. The Council-of-Nine bleed fork (§7) is untouched —
  this is the cheap floor, not the ceiling.
- **Stack:** the sketchpad is React+CDN; the identity and tuning above are what to
  carry into the Vue 3 / lazy-three.js / Worker architecture. A target to match,
  not code to ship.

---

## 5. Persistence

Save state is small: grid, building list + states, pool amounts, sol/weather, RNG
seed. Serialize the lot. Mongo if you want it networked across devices;
localStorage is genuinely sufficient for an Easter egg. Engine runs fine with no
server at all.

---

## 6. Build order

Collapse to "a base visibly growing on screen" as fast as possible — that feedback
loop is the point; everything after is layers.

1. **Render + place.** Iso/3D grid, place a hab and a solar panel from a palette,
   sol clock ticking. (A weekend.)
2. **Living sim.** Pools + connectivity gate + the tick loop + colonists arriving
   and consuming. Power runs out at night. *This is the game.* (A few weekends.)
3. **Depth.** Dust storms, the full resource cascade, shortfall timers, resupply
   windows, more buildings (all JSON). (Weeks.)
4. **Voice.** VIVARIUM via MXF, gated + cheap. (Whenever — it's the flourish.)
5. **Council / Memgraph / whatever-TF-turns-out-to-be.** Only if 1–4 are fun.

---

## 7. Open questions

- **TensorFlow — what's the job?** No demand model to learn (Mars is physics),
  pathfinding is A*, terrain is noise. The only honest candidate is anomaly
  detection on the telemetry stream (Sentinel-flavored), and that's gilding. If
  you've got a real use — learned advisor? AI that plays itself? — name it; right
  now it reads as a tool looking for a problem.
- **How much narrative bleed?** Does VIVARIUM stay a colony AI, or does the
  Council-of-Nine voice bleed through the way it does across the Simulacria
  surfaces? That decision changes whether the agent layer is one voice or a chorus
  (and whether Memgraph ever gets summoned).
- **2D iso vs full 3D** — open again, productively. You called 3D; the prototype
  rendered 2D iso to lock the feel cheaply, and it works as-is. So 2D iso is
  shippable *now*; 3D is the richer target that roughly doubles asset/camera/
  lighting scope. The 2D pass de-risks the jump — everything behind the canvas is
  proven, only the renderer swaps — and your Blender pipeline is why 3D is a
  reasonable bet for you specifically. See §4.
