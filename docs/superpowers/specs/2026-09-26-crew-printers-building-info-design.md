# Crew settings, printers, and building information — design

- **Date:** 2026-09-26
- **Status:** design approved section by section in the brainstorm (crew model: a FIRST / NORMAL / OFF setting per building; engine approach: FIRST buildings run first; building info: a card plus plain descriptions; printers: resource printers with no crew; fabricators removed from saves without a refund).
- **Scope:** a per-building crew and on/off setting in the engine, its command, and its controls; the 3D, Bio, and Atomic printers replacing the Fabricator; a card for the selected building; plain descriptions for every building. No change to power shedding, the seal rule, or the other buildings' recipes.

## Why

Brad's colony had 16 buildings that need a colonist and 3 colonists. Staffing went to the oldest buildings first, so every Hydroponics dome sat on NO CREW while food ran out, and he had no way to choose. His 21 Fabricators were spending materials and power on copies of themselves, which he took to be building things the crew needs. Placed buildings said nothing about what they do or why they were idle beyond a badge.

What he should be able to do afterwards:

- put a worker on a Hydroponics dome in two clicks (select it, press FIRST);
- switch off a building he does not want running, freeing its worker and its power;
- read, for any building, what it does, what it uses and makes, what it needs, and why it is or is not working;
- build printers that turn power into materials, food, or whatever is running out.

## Part 1 — the crew setting (engine)

### Data

`shared/types.ts`:

```ts
/** the player's setting for one building: FIRST gets crew before NORMAL; OFF does nothing */
export type BuildingMode = "first" | "normal" | "off";
// on BuildingState — undefined means "normal", so saves only carry what the player set
mode?: "first" | "off";
```

`OffReason` gains `"off"`.

A pure helper in `src/engine/modes.ts`, used by the engine to validate and by the UI to decide which buttons to show:

```ts
/** the settings a building of this def offers; [] when it has nothing to switch */
export function modesFor(def: BuildingDef): BuildingMode[];
```

- `["first", "normal", "off"]` when `def.staffing > 0` (extractor, awg, aquifer, reclaimer, electrolysis, greenhouse, medbay, reactor, roboticsbay);
- `["normal", "off"]` when the def draws power (`consumes.power > 0`) and is not the hub, a conduit, a housing def (`popCap`), or the transport pod (it launches whether or not it has power, so OFF would only drop its cost): deflector, the three printers, roverbay;
- `[]` otherwise (hub, corridor, hab, ptp, solar, wind, geothermal, battery, cistern, o2tank).

### Rules

- **Order.** The production pass in `tick.ts` visits buildings in this order: every building set to FIRST (in `s.buildings` order, i.e. oldest first), then every other building (same order). Each building still passes the same gates (power, damage or flare fault, seal, crew, inputs) and still returns its worker when an input is missing. With no building set to FIRST the order is exactly today's.
- **OFF.** An OFF building is left out of the power pass (no draw) and stays offline; in the production pass it records `offReason: "off"`, takes no worker, and makes nothing. Every later pass that checks `online` (reclaimer, med-bay healing, deflector, rover and robotics bays, the reactor objective) therefore skips it without new code. The "no power draw means online" step must not turn an OFF building back on.
- **The seal.** OFF changes operation, not structure: an OFF sealed building still carries the seal (`seal.ts` is unchanged).
- **Power.** FIRST is about crew only. The brownout still sheds by `def.priority`.
- **Who walks where.** `assign()` in `colonists.ts` fills the posts of the staffed buildings that ran this tick first (`online`, `staffed`, `fed`), in the same FIRST-then-rest order, and only then the posts of the staffed buildings that stopped, as it does today. Within each group a colonist keeps the post they held last tick (a colonist in their trade who lost their post may take one from someone out of trade), then open posts go by trade, then to anyone, so a building flickering between running and stopped does not reshuffle the crew. OFF buildings get no post, so switching one off frees its worker. Today it fills posts in build order across every staffed building, so the colonist you see at a running building is not always the one running it; after this change it is. (Posting only running buildings was tried and rejected: unposted colonists go out gathering, which takes them off shift, stops more buildings, and broke the campaign test.)
- **Command.** `protocol.ts` gains `{ type: "setMode"; uid: number; mode: BuildingMode }`. `Colony.setMode(uid, mode)` stores `"first"`/`"off"` or deletes the field for `"normal"`, and returns false (changing nothing) for an unknown uid or a mode the def does not offer. `host.ts` applies it; `bridge.ts` exposes `setMode(uid, mode)`. Co-op guests cannot send it: `hostRelay.ts` already forwards only `moveIntent` and `interact`.
- **Determinism.** No RNG, no clock: the setting is plain data carried by the building, so replay and save/resume hold. It rides snapshots, saves, and loads through the existing whole-building copies; a save without it loads as all NORMAL.

### What reads it

- Badges: `OFF_REASON_LABEL.off = "OFF"`.
- HUD fault lines: `faultAlerts` ignores `"off"` (it is the player's choice, not a fault).
- Narrator: the world model maps `"off"` to a new `FailReason` `"off"`, prose "is switched off".
- `BuildingState.staffed` keeps its meaning (the crew gate passed).

## Part 2 — printers replace the Fabricator

### The printers

| id | Name | Glyph | Foot | Mat | Crew | Seal | Uses | Makes | Power priority | Unlock |
|---|---|---|---|---|---|---|---|---|---|---|
| `printer` | 3D Printer | 3DP | 1×1 | 40 | 0 | no | 6 power/s | 0.35 materials/s | 15 | 6 colonists (unchanged) |
| `bioprinter` | Bio Printer | BIO | 1×1 | 35 | 0 | no | 8 power/s, 2 water/s | 3 food/s | 28 | a Hydroponics built, or sol ≥ 6 |
| `atomic` | Atomic Printer | ATM | 2×2 | 120 | 0 | no | 30 power/s | the lowest of: 8 water/s, 6 oxygen/s, 4 food/s, 1 material/s | 10 | a Fission Reactor built |

- The 3D Printer is today's Materials Printer renamed; its id stays `printer`, so saves keep theirs.
- The Bio Printer is a plain recipe (`consumes`/`produces`), so the tick needs nothing new.
- The Atomic Printer uses one new optional def field:

  ```ts
  /** each tick, output this rate of whichever listed resource is lowest as a
   *  share of its capacity (ties in listed order) */
  printsLowest?: { oxygen: number; water: number; food: number; materials: number };
  ```

  In the production pass, after its gates pass, it picks the resource with the lowest `amount / capacity` among oxygen, water, food, and the materials pool (ties in that order; a pool with no capacity counts as full), adds `rate × eff × dt` to it (the same `eff` every producer gets from morale; it has no crew), counts water/oxygen/food in `net` flow as `produces` does, and credits materials outside net flow as `producesMat` does. Pools clamp to capacity as usual. No RNG.
- Numbers are starting guesses, tuned in play; they live in the defs.

### Removing the Fabricator

- Delete the `fabricator` def and its `ORDER` entry, its gate, `engine/fabricator.ts` and its tests, the `replicates` def field and the `BuildingState.replicateT` field, `FAB_*` tuning, the `fabricator_ready` / `fabricator_stalled` events and their council lines and audio cues, the FABRICATORS rail panel, the end-screen line, the renderer's lineage handling and fabricator model, and the `unlock_fabricator` hint.
- The Sentinel's last feature, "the fabricators", becomes "the crew at work": `laborUsed / labor` (0 when `labor` is 0). The feature count stays 11.
- **Saves:** `Colony.load` drops fabricator buildings, clears their cells (rebuild the occupancy grid from the remaining buildings), drops `"fabricator"` from `unlocked`, and strips any `replicateT`. No materials are refunded.
- New hints: `unlock_bioprinter`, `unlock_atomic`, in the existing unlock-toast style.
- Models: the Bio Printer reuses the printer kit with its own color; the Atomic Printer gets a 2×2 variant with a glowing core, lit like other kit parts (emissive under the bloom threshold, no real lights).

## Part 3 — building information

### The card

- Opens when a placed building is selected (a click with no tool up) and closes when the selection clears. It sits in the right column under the alerts; the bottom strip keeps its one-line move / rotate / remove help and touch buttons. It opens only for a player who can build (solo, or the co-op architect).
- Content, top to bottom:
  1. the building's name and a status label: the badge label when it has an `offReason` (NO CREW, NO POWER, NO SEAL, DAMAGED, FLARE FAULT, NO WATER/OXYGEN/FOOD, OFF), WORKING when it has none and does something each tick (it has a setting from `modesFor`, or it is a generator), and no label for the hub, corridors, habitats, and storage;
  2. the description (`def.desc`, rewritten below);
  3. **makes / uses / needs**, generated from the def by a pure `buildingFacts(def)` in `src/ui/buildingFacts.ts`: makes from `produces`, `producesMat`, `solar` ("up to N power/s in full sun"), `wind`, `steady`, `printsLowest`, `caps` ("stores N water"), `popCap` ("beds for N"), `reclaim`; uses from `consumes`; needs from `staffing` ("1 crew" plus the matching role and its bonus from `BUILDING_ROLE`), `requiresPressure` ("the pressure seal"), `needsVent` ("a vent"), `needsAquifer` ("an aquifer site");
  4. **now**, from a pure `statusLine(building, snapshot)`: "working" plus the colonist on shift there ("working · Ada Voss, botanist, +25%") or the reason in words: "no free colonist (3 of 3 busy)", "not enough power", "cut off from the pressure network", "damaged · repairs itself over time", "flare fault · electronics recovering", "out of water", "switched off". Omitted for buildings that get no status label;
  5. the setting buttons from `modesFor(def)`: FIRST / NORMAL / OFF, or ON / OFF (ON sends `"normal"`), or none. The current setting is highlighted; a press calls the store's `setMode`, which calls `bridge.setMode`.
- The snapshot's `ColonistView` gains `workUid: number | null` so the card can name the colonist on shift.

### Other surfaces

- **Hover:** the Inspector's hover chip for a placed building adds its status label ("HYDROPONICS · NO CREW").
- **Left rail:** unchanged. (A "· N waiting" suffix on the LABOR line was built and dropped in review: it wrapped the crew row and made the rail jump, and the HUD's "N UNSTAFFED" fault line already gives the count.)
- **Unlock hints:** the "unlocks at …" text moves out of `Palette.vue` into `GATE_HINTS` beside `GATES` in `unlocks.ts`, so the rule and its description sit together.

### Descriptions

`def.desc` is rewritten for every building. The number chips in the palette and the card's facts lines carry the numbers, so descriptions state purpose, needs, and catches in words:

| Building | Description |
|---|---|
| Pressure Hub | The center of a pressure network. Sealed buildings connect back to a hub, directly or through corridors and other sealed buildings. Each hub starts its own network. |
| Corridor | A pressurized tube that carries the seal between the network and sealed buildings. Sealed buildings lay their own when placed; use this for manual runs and repairs. |
| Habitat | Beds for colonists; new ones arrive or are born only into free beds. Connected to the seal, it also shelters the crew from hazards. |
| Solar Array | Power from sunlight: most at noon, none at night, little in a dust storm. |
| Battery Bank | Stores power for the night and for storms. |
| Ice Extractor | Makes water from the ground with power alone. Needs one colonist; a miner makes more. |
| Atmospheric Water Generator | Pulls water out of the air: more water than the extractor, for more power. Needs one colonist. |
| Aquifer Well | Pumps an underground aquifer: the most water for the least power. Must sit on an aquifer site. Needs one colonist. |
| Water Reclaimer | Recycles used water, returning part of what the colony uses. Needs one colonist and the seal. |
| Electrolysis Unit | Splits water into oxygen for the crew to breathe. Needs one colonist (an engineer makes more) and the seal. Among the last to lose power in a brownout. |
| Hydroponics | Grows food, with a little oxygen on the side. Needs one colonist (a botanist grows more) and the seal. Loses power early in a brownout. |
| Med-Bay | Heals injured colonists, fastest at its door. Needs one colonist (a medic heals faster) and the seal. |
| Water Cistern | Stores water. |
| Oxygen Tank | Stores oxygen. |
| Deflector Array | While powered, each deflector turns back half of the UFO's abduction attempts; two turn back three in four. Loses power early in a brownout. |
| Wind Turbine | Power from wind: strongest at night and in dust storms, when solar is weakest. |
| Geothermal Tap | Steady power, day and night. Must sit on a vent. |
| Fission Reactor | Large, steady power from a little water. Needs one colonist; an engineer makes more. |
| 3D Printer | Turns regolith into building materials using power. No crew. |
| Bio Printer | Makes food from water using power. No crew, so it runs when colonists are short; less efficient than Hydroponics. |
| Atomic Printer | Uses a lot of power to make whichever of water, oxygen, food, or materials is lowest. No crew. The first thing cut in a brownout. |
| Rover Bay | Builds one rover, a vehicle you drive to haul resources in bulk. Holds its build while unpowered. |
| Robotics Bay | Builds up to three mining robots that gather resources day and night. Needs one colonist. |
| Transport Pod | Launches a crew to found a colony on another planet. Launching ends this run as an expansion. |

## Data flow

```
card button ── store.setMode ── bridge.setMode ── Command { setMode } ──▶ worker: Colony.setMode → BuildingState.mode
tick: power pass (skips OFF) → production pass (FIRST, then the rest; OFF → offReason "off") → assign() (running posts, same order)
snapshot ──▶ card (facts from def, status from offReason/workUid) · badges · fault lines · rail LABOR · narrator
```

## Testing

- **Engine (Vitest):**
  - with three workers and staffed buildings built in order A, B, C, D: default staffs A, B, C; D set to FIRST staffs D, A, B; A set to OFF staffs B, C, D and A records `offReason: "off"`;
  - OFF takes no power: a brownout with an OFF consumer sheds as if it were absent;
  - the "no power draw means online" step leaves an OFF building offline;
  - `setMode` rejects an unknown uid and a mode the def does not offer, and deletes the field for `"normal"`;
  - `modesFor` for each def class;
  - `assign()` fills running buildings' posts first, in FIRST-then-rest order; stopped buildings keep their crew; OFF buildings get none; posts stay put while a building flickers;
  - determinism: two colonies with the same seed and the same `setMode` commands stay identical; a run with no settings matches today's;
  - save/load round-trips `mode`; a legacy save loads as all NORMAL;
  - `setMode` passes through the host; the bridge sends it;
  - the Bio Printer's recipe; the Atomic Printer picks the lowest fill (ties in order), scales by morale, clamps to capacity, and counts flow like other producers; unlock gates for both;
  - a save with fabricators loads without them, with their cells free, no refund, and `"fabricator"` gone from `unlocked`;
  - the Sentinel's feature vector has 11 entries and the last is `laborUsed / labor`.
- **Main thread (Vitest):** `buildingFacts` for a recipe building, a generator, storage, housing, and the Atomic Printer; `statusLine` for each reason and for "working" with and without a role match; `OFF_REASON_LABEL.off`; `faultAlerts` ignores `"off"`; the world model's `"off"` prose.
- **e2e (Playwright, desktop):** select a building with the canvas (frozen loop), see the card with its facts; press FIRST on an unstaffed building and see it staffed; press OFF and see the OFF badge and no fault line. Specs stay off HIGH.

## Acceptance criteria

1. Setting a building to FIRST staffs it before any NORMAL building on the next tick.
2. Setting a building to OFF stops its power draw, its output, and its claim on crew; it shows an OFF badge and no HUD fault line.
3. Buildings with nothing to switch offer no setting; the engine refuses a setting a building does not offer.
4. The colonist posted to a building is the one running it.
5. With no settings used, a run plays out exactly as before this change.
6. The Fabricator is gone from the palette, saves, HUD, narrator, and sounds; saves with fabricators load cleanly without them.
7. The 3D, Bio, and Atomic printers build, unlock as specified, and produce as specified.
8. Selecting a building shows its card with a plain description, generated makes / uses / needs, a live status line, and its setting buttons.
9. Typecheck, unit tests, build, and e2e pass locally and on CI.

## Later (not in this design)

- A crew list panel showing the whole staffing queue.
- FIRST also protecting a building from brownouts.
- A printer that builds other buildings on request (the old Fabricator's mechanism pointed at something useful).
