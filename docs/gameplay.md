# Gameplay

VIVARIUM is a resource-balance survival sim. The colony lives or dies on one
chain — **power → water → oxygen → food** — with batteries and tanks as the buffers
that carry it through the dark. You build the colony; the planet, voiced by an AI
council, tries to take it back.

## The core loop

```
solar ─▶ power ─▶ ice extractor ─▶ water ─▶ electrolysis ─▶ oxygen
                              └─▶ hydroponics ─▶ food (+ a little oxygen)
batteries buffer power overnight · cisterns/tanks buffer water/oxygen
```

Sunlight makes power; power makes water; water makes oxygen and food; colonists
consume all three. Every link can starve the next, and at dusk solar falls to zero
— so the real game is sizing your **buffers** (batteries, cisterns, oxygen tanks)
to survive the night and the storms.

## Building order that works

Place a **Pressure Hub** first — the seal flood-fills from it. Then:

1. **Corridors** to carry the seal out from the hub (2-click auto-route).
2. **Habitats** for population (4 colonists each), and **Solar + Batteries** for
   power day and night.
3. An **Ice Extractor** (water) feeding an **Electrolysis Unit** (oxygen — life
   support, served first in a brownout).
4. **Hydroponics** for food once power is comfortable (it's shed first in a
   brownout, so don't lean on it for oxygen).
5. **Cisterns** and **Oxygen Tanks** to widen the buffers before the storms ramp.

See [engine.md](engine.md) for the full building table and per-second numbers.

## Power priority and brownouts

Power is allocated **by priority**. When you can't make enough, the colony **browns
out the lowest-priority consumers first** — hydroponics before life support, life
support before nothing. Watch the power rail fall at dusk and the battery carry the
colony through; if the battery empties, the brownout cascade begins.

## Pressure, doors, and rotation

Pressurized buildings only function while connected to the hub through corridors.
Each has a **door** on one side that turns when you **rotate** the building — doors
are routing and visual only, but they decide where colonists and corridors connect.
Plan your corridor runs to reach the doors.

## The embodied colony

Colonists are real entities walking the colony, not a number. Press **F** to
**possess** the nearest one and take direct control:

- **WASD** moves your colonist (camera-aligned — the input rotates to match the iso
  view).
- Walk onto a surface **deposit** and your colonist auto-mines it — **ice → water,
  ore → materials, cache → food** — then auto-unloads at the hub.
- **Materials** is the build currency: every building costs materials to place, so
  going out to mine funds your expansion.

Unpossessed colonists follow a time-of-day / hazard AI and path around buildings on
their own. Press **F** again to release.

## Alien traders

A trader ship arrives on its own window, telegraphs its approach, and lands with an
offer: it **takes** some of one resource and **gives** another, or sells permanent
**alien tech** (capacity, passive-power, or demand upgrades) for materials. You
**accept or decline** while it's on the ground; takes are clamped to what you can
store. Good trades smooth a shortfall or permanently raise a ceiling — bad ones
strand you. Tech you buy is yours for the rest of the run.

## Hazards

The **Director** (the planet's tactician — see [agent-layer.md](agent-layer.md))
picks hazards to press your weakest seam, escalating over the sols. The signature
one is a **dust storm**, which guts solar output to ~12% — survivable only on stored
power. You can also trigger hazards yourself from the top bar to stress-test a
layout. Earth **resupply** windows arrive on a schedule and trickle the buffers back
up — a lifeline, but not one you can build a colony around.

## The campaign — the launch window

Earth's launch window closes at the **start of Sol 22**. To win you must reach a
**real settlement** before then:

- grow to the **target population (8 colonists)**, and
- sustain **non-negative net on all life support** (without counting resupply) for a
  **sustained stretch (~45 s)** at that population.

Let the window close on an unfinished colony, or lose everyone, and the watch ends.
The objective panel tracks both clocks; the Chronicler writes the last entry. (These
numbers live in `engine/tuning.ts` — `DEADLINE_SOL`, `TARGET_POP`,
`SELF_SUFFICIENCY_GOAL` — and are easy to retune.)

## Controls at a glance

| Input | Action |
|---|---|
| Build palette (bottom center) | Pick a building; click a cell to place. The ghost shows valid (cyan) / blocked (rust). |
| Right-click | Cancel placement / deselect |
| Corridor tile | 2-click auto-route mode (door → door) |
| Rotate control | Turn a building (moves its door) |
| **F** | Possess / release the nearest colonist |
| **WASD** | Drive the possessed colonist (camera-aligned) |
| Top bar | Trigger a storm/hazard, pause, change speed |

## See also

- [engine.md](engine.md) — the systems behind the loop and the exact numbers
- [agent-layer.md](agent-layer.md) — the council narrating you and the Director pressing you
- [rendering.md](rendering.md) — the camera and what you're looking at
