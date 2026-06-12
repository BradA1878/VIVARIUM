# VIVARIUM — Documentation

Documentation for VIVARIUM, a 3D Mars-colony survival sim narrated by a council of
AI voices. Start with the [project README](../README.md) for the overview and quick
start; this folder goes deeper.

## Guides

| Doc | What it covers |
|---|---|
| [architecture.md](architecture.md) | The one rule — the hard wall between the deterministic engine (in a Web Worker) and the observe-only agent layer + UI. Data flow and the worker protocol. |
| [engine.md](engine.md) | The deterministic sim: buildings-as-data, the ordered tick passes, the seeded RNG, pressure/doors/routing, the embodied colony, the automation ladder (gather/rover/robots), the generation economy & wind curve, abundance unlocks, the roster/morale/injury systems, difficulty profiles, save/resume. |
| [agent-layer.md](agent-layer.md) | The Council (four voices in the dry register + idle banter, the ticker/log), the causal world model, the TensorFlow.js Sentinel, the Director antagonist (and its attribution tells), and the optional live narrator. |
| [gameplay.md](gameplay.md) | How to play: the power→water→oxygen→food loop, building order, the commander & possession, the automation ladder, new schematics, morale, injuries & the Med-Bay, difficulty, alien trade, hazards, the campaign, and the run report. |
| [rendering.md](rendering.md) | The three.js renderer: snapshot reconciliation, the procedural building kit (incl. the machines and vents), reaction bubbles, postfx & the adaptive PerfGovernor, the night pass, storm/UFO FX, the iso/follow camera, and the performance budget. |
| [development.md](development.md) | Commands, project layout, the determinism rule, extension recipes, testing (incl. the Snapshot-fixture rule), and the Playwright `window.__viv` workflow. |

## Design history

| Doc | What it is |
|---|---|
| [planning/vivarium-design.md](planning/vivarium-design.md) | The original design doc — the project's *starting point*. The codebase has deliberately grown past it. |
| [superpowers/specs/2026-06-07-embodied-colony-design.md](superpowers/specs/2026-06-07-embodied-colony-design.md) | Spec: colonists as real entities, possession, mining, the materials economy, traders. |
| [superpowers/specs/2026-06-07-living-environment-design.md](superpowers/specs/2026-06-07-living-environment-design.md) | Spec: the living environment — deposits, the env-RNG, the world that reacts. |
| [superpowers/specs/2026-06-07-corridors-doors-rotation-design.md](superpowers/specs/2026-06-07-corridors-doors-rotation-design.md) | Spec: corridors, doors, and building rotation. |
| [superpowers/specs/2026-06-09-ufo-abduction-and-births-design.md](superpowers/specs/2026-06-09-ufo-abduction-and-births-design.md) | Spec: the evil UFO abductor, the Deflector Array, and in-colony births. |
| [superpowers/specs/2026-06-10-level-up-release-design.md](superpowers/specs/2026-06-10-level-up-release-design.md) | Spec: the level-up release — names/roles/morale/injuries/difficulty, postfx + night pass, procedural audio, settings, the run report, council banter + Director attribution. |
| [superpowers/specs/2026-06-11-homeostasis-update-design.md](superpowers/specs/2026-06-11-homeostasis-update-design.md) | Spec: the homeostasis update — the automation ladder (auto-gather/rover/robots), the generation economy (wind/geothermal/reactor/printer), abundance unlocks, ~2× calmer pacing, the dry council + ticker/log; amended with the commander, reaction bubbles, and the adaptive PerfGovernor. |
