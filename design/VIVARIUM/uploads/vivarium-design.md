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

## 4. Persistence

Save state is small: grid, building list + states, pool amounts, sol/weather, RNG
seed. Serialize the lot. Mongo if you want it networked across devices;
localStorage is genuinely sufficient for an Easter egg. Engine runs fine with no
server at all.

---

## 5. Build order

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

## 6. Open questions

- **TensorFlow — what's the job?** No demand model to learn (Mars is physics),
  pathfinding is A*, terrain is noise. The only honest candidate is anomaly
  detection on the telemetry stream (Sentinel-flavored), and that's gilding. If
  you've got a real use — learned advisor? AI that plays itself? — name it; right
  now it reads as a tool looking for a problem.
- **How much narrative bleed?** Does VIVARIUM stay a colony AI, or does the
  Council-of-Nine voice bleed through the way it does across the Simulacria
  surfaces? That decision changes whether the agent layer is one voice or a chorus
  (and whether Memgraph ever gets summoned).
- **2D iso vs full 3D** is settled as 3D — just noting it doubles asset/camera/
  lighting scope before anything's simulated. Your Blender pipeline is the reason
  that's a reasonable bet for you specifically.
