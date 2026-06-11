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
6. As the colony matures: a **Med-Bay** before the meteor sols get serious, and a
   **Deflector Array** before the abductors find you (and keep it powered — it
   sheds early in a brownout).

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

Colonists are real entities walking the colony, not a number — and they're
**people** now. Every colonist has a deterministic **name and role** (miner,
engineer, botanist, medic), and the colony staffs role-first: a miner runs the
extractor, an engineer the electrolysis unit, a botanist the hydroponics, a medic
the Med-Bay. A building staffed by its own trade **produces up to 25% more** — so
who is on shift matters, and losing your only medic hurts twice.

Press **F** to **possess** the nearest colonist and take direct control (the HUD
pilot bar shows whose boots you're in — name and role):

- **WASD** moves your colonist (camera-aligned — the input rotates to match the iso
  view).
- **P** picks up from a glowing surface **deposit** in reach — **ice → water,
  ore → materials, cache → food** — and drops the load at the **depot hopper**
  by the hub. One press fills your hands, one press empties them.
- **Materials** is the build currency: every building costs materials to place, so
  going out to mine funds your expansion.

Unpossessed colonists follow a time-of-day / hazard AI and path around buildings on
their own. Press **F** again to release.

## Morale

The colony has a **mood**, shown as the MORALE row in the crew panel. Crises
drain it — every active life-support countdown and every brownout pulls it down;
a death or an abduction knocks it hard, an injury stings. Calm sols and progress
toward self-sufficiency restore it; arrivals, births, and a fair trade lift it.

Morale scales **production**: a content colony works its recipes harder, a
frightened one slower — but it never slows anyone's walk, so a bad stretch can't
spiral into a worse one. If it sinks below the worry line the council will say
so (`morale low`); give them a quiet sol — or buy the alien **Harmonizer**,
which keeps the floor from ever dropping too far.

## Injuries and the Med-Bay

Meteor strikes and quake jolts now hurt **people**, not just buildings: anyone
standing near an impact is wounded. The wounded limp, leave the labor pool, and
make their own way to triage — and a **second hit while wounded kills**, so get
them clear of the next telegraph.

Everyone heals slowly on their own, but a powered, connected **Med-Bay** heals
~3× faster at its door — faster still with a **medic** staffing it, and twice as
fast again with the alien **Medi-Gel** tech. One 1×1 pressurized Med-Bay turns a
bad meteor sol from a slow population bleed into a queue at the door.

## Difficulty

The settings menu offers three difficulties for your **next run** (it applies at
reset — mid-run the planet doesn't renegotiate):

| Setting | Engine profile | What changes |
|---|---|---|
| **CALM** | easy | Longer grace timers (75 s), deadline Sol 28, rarer/softer hazards, rarer UFOs, 130 starting materials |
| **STANDARD** | normal | The baseline game — exactly the classic tuning (grace 55 s, deadline Sol 22) |
| **BRUTAL** | hard | Grace 40 s, deadline Sol 18, denser/harsher hazards, more frequent UFOs, 60 starting materials |

Same seed, same story beats — the profiles only scale the pressure, so a BRUTAL
run is the same planet with the margins cut thin. VIVARIUM's opening line tells
you which world you woke up in.

## Alien traders

A trader ship arrives on its own window, telegraphs its approach, and lands with an
offer: it **takes** some of one resource and **gives** another, or sells permanent
**alien tech** for materials — capacity, passive power, lower demand, better
deflectors, faster healing (**Medi-Gel**), a higher morale floor (**Harmonizer**).
You **accept or decline** while it's on the ground; takes are clamped to what you
can store. Good trades smooth a shortfall or permanently raise a ceiling — bad ones
strand you. Tech you buy is yours for the rest of the run.

## Hazards

The **Director** (the planet's tactician — see [agent-layer.md](agent-layer.md))
picks hazards to press your weakest seam, escalating over the sols. The signature
one is a **dust storm**, which guts solar output to ~12% — survivable only on stored
power. You can also trigger hazards yourself from the top bar to stress-test a
layout. Earth **resupply** windows arrive on a schedule and trickle the buffers back
up — a lifeline, but not one you can build a colony around.

## The campaign — the launch window

Earth's launch window closes at the **start of Sol 22** (Sol 28 on CALM, Sol 18
on BRUTAL). To win you must reach a **real settlement** before then:

- grow to the **target population (8 colonists)**, and
- sustain **non-negative net on all life support** (without counting resupply) for a
  **sustained stretch (~45 s)** at that population.

Let the window close on an unfinished colony, or lose everyone, and the watch ends.
The objective panel tracks both clocks; the Chronicler writes the last entry. (These
numbers live in `engine/tuning.ts` — `DEADLINE_SOL`, `TARGET_POP`,
`SELF_SUFFICIENCY_GOAL`, and the `DIFFICULTY` profiles — and are easy to retune.)

## The end of a run — the report and the dossier

Either way it ends, the end screen is now a **run report**: an epitaph naming
what actually got you (the last critical resource, shaded by the hazard you died
under), **sparkline curves** of all four pools and population across the whole
run, and a ledger of the run's events — casualties, abductions, births,
brownouts, trades, hazards by kind.

Below it sits **"WHAT THE PLANET HAS LEARNED"** — the Director's cross-run
dossier, opened at exactly the moment you most want to know what killed you: how
many runs you've played and lost, *how* you tend to die (by resource and by
hazard), and the opening bias the planet will start your next run with. The
planet remembers between runs; this panel is it showing you its notes. You can
pick the next run's difficulty right there before restarting.

## Settings, hints, and sound

The **gear in the top bar** opens a settings panel (Esc closes it). Everything in
it persists across visits: audio volumes (master / sfx / ambient, plus mute),
graphics quality (LOW/HIGH — see [rendering.md](rendering.md)), the live-narrator
toggle (with an honest note when the narrator server is unreachable), the
**Director** on/off switch (off hands hazards back to the engine's own scheduler
— the planet stops aiming), the next run's difficulty, and a key reference.

First encounters come with **contextual hints** — one-shot toasts that appear the
first time a mechanic actually bites: a sealed building sitting unconnected, your
first brownout, the first traders, the first UFO warning, the first possession.
Each shows once, ever, then trusts you.

And the game has **sound** now — fully procedural Web Audio, zero asset files: an
ambient wind bed that gusts and rises with storms, stings for hazards, brownouts,
casualties, trades, and the UFO, a possession hum, and quiet interface ticks.
It starts on your first click or keypress (browser autoplay rules), and the
volumes and mute live in settings. The game never depends on it — no audio, no
problem.

## Controls at a glance

| Input | Action |
|---|---|
| Build palette (bottom center) | Pick a building; click a cell to place. The ghost shows valid (cyan) / blocked (rust). |
| Right-click | Cancel placement / deselect |
| Corridor tile | 2-click auto-route mode (door → door) |
| Rotate control | Turn a building (moves its door) |
| **F** | Possess / release the nearest colonist |
| **WASD** / arrows | Drive the possessed colonist (camera-aligned) |
| **P** / **E** | Pick up at a deposit / drop at the depot (while piloting) |
| **Space** | Pause / resume |
| Top bar | Trigger a storm/hazard, pause, change speed; the gear opens settings |
| **Esc** | Close settings / cancel the current tool |

## See also

- [engine.md](engine.md) — the systems behind the loop and the exact numbers
- [agent-layer.md](agent-layer.md) — the council narrating you and the Director pressing you
- [rendering.md](rendering.md) — the camera and what you're looking at
