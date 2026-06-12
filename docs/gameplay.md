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
4. **Hydroponics** for food once power is comfortable (it's shed early in a
   brownout, so don't lean on it for oxygen).
5. **Cisterns** and **Oxygen Tanks** to widen the buffers before the storms ramp.
6. As the colony matures: a **Med-Bay** before the meteor sols get serious, and a
   **Deflector Array** before the abductors find you (and keep it powered — it
   sheds early in a brownout).
7. As the schematics emerge (see *New schematics* below): a **Wind Turbine** to
   carry the night and the storms (wind peaks exactly when solar dies), a
   **Geothermal Tap** on one of the glowing fumarole **vents** — it only seats
   on a vent, and the vent cells are marked while the tool is up — then a
   **Materials Printer** so expansion stops depending on the ore field, and
   eventually a **Fission Reactor** (water in, big steady power out, engineer
   on the rods) to stop worrying about the grid at all.

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
extractor, an engineer the electrolysis unit (and later the reactor and the
Robotics Bay), a botanist the hydroponics, a medic the Med-Bay. A building
staffed by its own trade **produces up to 25% more** — so who is on shift
matters, and losing your only medic hurts twice.

One of them is **the commander** — always the lowest-id colonist still alive,
marked by **amber accents** (visor, antenna, a chest chevron) where the crew
wears cyan. Press **F** to step into the commander's boots (the pilot bar shows
a **CMDR** tag); if the commander dies or is taken, the next in line is already
wearing the amber on the next frame — succession is automatic, and **F always
finds whoever is in command**, so possession never hunts for a target:

- **WASD** moves your colonist (camera-aligned — the input rotates to match the iso
  view).
- **P** picks up from a glowing surface **deposit** in reach — **ice → water,
  ore → materials, cache → food** — and drops the load at the **depot hopper**
  by the hub. One press fills your hands, one press empties them.
- **Materials** is the build currency: every building costs materials to place, so
  going out to mine funds your expansion.
- **Piloting locks construction** — the palette disables (with a "PILOTING"
  note), and R / Delete do nothing until you step back out. One set of hands at
  a time.

Press **F** again to release — unless the commander is standing beside a
working **rover**, in which case F **boards it** instead (the pilot bar shows
the prompt); one more press steps back out. Unpossessed colonists follow a
time-of-day / hazard AI, path around buildings on their own, and visibly
**react**: small comic chips pop over their heads — "!" breaking for shelter,
"+" limping to triage, a gear setting off to work, "z" heading home at night,
"storm!" / "ouch" / "taken!" when events bite. (Your own colonist never
bubbles — you're the one driving.)

## The automation ladder

Running around getting resources is the early game, not the whole game. Three
rungs of automation let a well-built colony reach **homeostasis** — visibly
humming on its own:

1. **Auto-gather.** Idle colonists work the deposit field by themselves: claim
   a node, mine, haul to the depot, repeat — smaller loads and slower boots
   than you, so taking the wheel keeps its edge. Fresh claims are
   **need-aware**: empty hands head for whatever the colony is scarcest on
   (a hungry colony works the food caches before stockpiling more ore),
   though a gatherer already committed to a node finishes it before
   re-deciding.
2. **The rover.** The **Rover Bay** fabricates one drivable bulk hauler on a
   countdown (paused while the bay is dark). Walk the commander up to it and
   press **F** to take the wheel: 4.5 cells/s against the suit's 2.6, and an
   80-unit multi-kind cargo bed against the suit's 20 — one P grabs from any
   deposit, one P at the depot drops everything. Strikes dent it (below 45%
   integrity it sits immobilized while it slowly self-repairs) but never
   destroy it.
3. **Mining robots.** The **Robotics Bay** (staffed — keep an engineer on the
   line) prints up to three autonomous miners; each one's 40-materials fee is
   charged when the chassis completes. They work **sol and night**, never
   shelter, and breathe nothing — but the planet keeps counterplay: a **solar
   flare stuns the whole fleet** for a dozen seconds, and a direct
   meteor/quake strike **scraps a robot outright**. Robots are the cheap,
   replaceable rung; the rover is the expensive, tough one.

## New schematics

The expansion tier doesn't start on your palette — it **emerges as the colony
earns it**. Locked tiles show a padlock and their condition; when a gate first
passes (sol milestones, population, materials, or the first dust storm selling
you the wind turbine), the engine latches it open for the rest of the run: a
chime sounds, the council notes it, a **"NEW SCHEMATIC"** toast appears, and
the tile lights up. Unlocks never regress, and an old save re-announces
whatever it has already earned. (The exact gates are in
[engine.md](engine.md).)

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
power (or on wind, which *rises* in a storm). The cadence is deliberately
calmer than it once was — roughly half the old strike rate, with the first
blow held back past your first sol — so a settled colony actually gets
stretches of visible homeostasis between crises; the gaps still tighten as the
run matures. You can also trigger hazards yourself from the top bar to
stress-test a layout. Earth **resupply** windows arrive on a schedule and
trickle the buffers back up — a lifeline, but not one you can build a colony
around.

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

## The council ticker and the log

The council speaks from a **ticker** along the bottom edge of the screen — one
live line at a time, typed out, with the speaking voice's glyph and timestamp.
A critical line (severity ≥ 4 — a death, an abduction, the endgame) announces
itself with a rust flash. Press **L** (or click the ticker) to pull up the
**council log**, the full message history; Esc or L closes it. The old terminal
window is gone — the narration now frames the colony instead of covering it.

## Settings, hints, and sound

The **gear in the top bar** opens a settings panel (Esc closes it). Everything in
it persists across visits: audio volumes (master / sfx / ambient, plus mute),
graphics quality (**AUTO/LOW/HIGH**, default AUTO — the renderer measures its own
frame cost and walks a quality ladder to fit your machine; LOW and HIGH pin it.
See [rendering.md](rendering.md)), the live-narrator
toggle (with an honest note when the narrator server is unreachable), the
**Director** on/off switch (off hands hazards back to the engine's own scheduler
— the planet stops aiming), the next run's difficulty, and a key reference.

First encounters come with **contextual hints** — one-shot toasts that appear the
first time a mechanic actually bites: a sealed building sitting unconnected, your
first brownout, the first traders, the first UFO warning, the first possession,
and each **NEW SCHEMATIC** as it unlocks (schematics blocked by another toast
queue up rather than vanish, since their trigger fires once per run). Each
shows once, ever, then trusts you.

And the game has **sound** now — fully procedural Web Audio, zero asset files: an
ambient wind bed that gusts with the actual wind level and rises with storms,
stings for hazards, brownouts, casualties, trades, and the UFO, a chime for each
new schematic, rover and robot cues (the suit hum swaps for a drive loop at the
wheel), a possession hum, and quiet interface ticks.
It starts on your first click or keypress (browser autoplay rules), and the
volumes and mute live in settings. The game never depends on it — no audio, no
problem.

## Controls at a glance

| Input | Action |
|---|---|
| Build palette (bottom center) | Pick a building; click a cell to place. The ghost shows valid (cyan) / blocked (rust). Locked tiles show their unlock condition. |
| Right-click | Cancel placement / deselect |
| Corridor tile | 2-click auto-route mode (door → door) |
| Rotate control | Turn a building (moves its door) |
| **F** | Take command: possess the **commander** → board a nearby rover → release |
| **WASD** / arrows | Drive the possessed colonist or rover (camera-aligned) |
| **P** / **E** | Pick up at a deposit / drop at the depot (while piloting) |
| **L** | Pull up / close the council log |
| **Space** | Pause / resume |
| Top bar | Trigger a storm/hazard, pause, change speed; the gear opens settings |
| **Esc** | Close settings → close the log → cancel the current tool (in that order) |

While piloting, construction keys (R, Delete) and the palette are locked.

## See also

- [engine.md](engine.md) — the systems behind the loop and the exact numbers
- [agent-layer.md](agent-layer.md) — the council narrating you and the Director pressing you
- [rendering.md](rendering.md) — the camera and what you're looking at
