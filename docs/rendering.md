# Rendering

The renderer lives entirely on the main thread (`src/render/`) and is a pure
consumer of the worker's output. It reconciles a three.js scene against each
`Snapshot` and never talks to the engine except through `SimBridge`. (See
[architecture.md](architecture.md).)

## Snapshot reconciliation

`render/renderer.ts` is the reconciler. Each frame it diffs the latest snapshot
against the meshes it already has and adds, removes, or updates buildings to match —
the same model-as-data approach as the engine. It holds no authority over
simulation state; if a building exists in the scene, it's because the snapshot said
so.

Those same diffs drive the **transient juice**: a new building scale-pops in
(0.35 s with a small overshoot) under a cyan ring, a vanished one bursts a
demolish puff, and a possession change rings the colonist (bright on engage, dim
on release). All of it is guarded — nothing pops on the first snapshot (so a
load doesn't firework the whole colony), possession is adopted rather than rung
on resume, and a `building_destroyed` cell suppresses the demolish puff for ~1 s
so a hazard kill doesn't double-burst.

The renderer also subscribes to the `ColonyEvent` stream (`onColonyEvent`): every
event forwards to `hazardfx.ts` (which ignores what it doesn't know), and the
abduction pair is special-cased — `abducted` / `abduction_blocked` carry no
coordinates, so their flash/ring anchor to the **live UFO mesh position**, the
only correct place for them.

## The procedural building kit

The design doc calls for a Blender → glTF kit. This environment can't run Blender,
so `render/three/kit/` reproduces the prototype silhouettes as **procedural three.js
meshes** (`dome.ts`, `drum.ts`, `solar.ts`, `tank.ts`, `corridor.ts`, `wind.ts`,
`reactor.ts`, `facility.ts`, plus the entity kits `astronaut.ts`, `rover.ts`,
`robot.ts`, `deposit.ts`, and `vent.ts`; the ships — `alienship.ts`, `ufo.ts` — and
`depot.ts` live beside the kit). The kit goes through a `contract.ts`
seam and keeps a `GLTFLoader` path, so real `.glb` assets can drop in later with no
changes at the call sites.

The generation-economy buildings reuse the families where they can: the
**geothermal tap is a `tank.ts` variant** (squat, heat-stained bronze, venting
its stack — a wellhead, not a tower), while `facility.ts` is one builder for
the whole industrial family, switched by a `specFor(id)` the way the tanks key
their vessels — the **printer** (a fabricator with sequenced status-bar
lights), the **Rover Bay** (a garage with an emissive door slab and ramp on the
def's door side), and the **Robotics Bay** (a gantry with a hanging tool
block). The **reactor** (`reactor.ts`) carries its whole status story in a core
ring light — breathing hot white-cyan while the pile runs, guttering offline,
rust when hurt. The **wind turbine** (`kit/wind.ts`) is the one kit driven by
the weather itself — see `KitEnv` below.

The shared material library owns one small, seeded roughness map for metal
and frosted domes. Its measured mean compensates the material roughness, keeping
the original finish and base colors. Individual kits own their materials;
`MaterialLib.dispose()` releases the shared map after all kits are retired.
Solar panels and signal materials retain their existing finish.

Industrial motion uses render-side active time (`KitEnv.dt`): the printer tray
retracts slightly, the robotics/reclaimer carriage carries its beam, cable,
and tool together, and the fabricator's small extruder travels below its beam.
The phase starts from the building seed and freezes exactly when paused or
offline. The fabricator also holds at completion or the lineage cap; the
Robotics Bay holds at the fleet cap (`working:false`). The existing core and
progress lights retain their meanings.

Corridors are special: rather than a fixed mesh, they render as **neighbour-aware
arms** (`kit/corridor.ts`) that connect to adjacent corridors, hub, and habs, so a
routed run reads as one continuous pressurized link.

The astronaut (`kit/astronaut.ts`) is articulated: legs and arms live in hip and
shoulder **pivot groups**, with a torso group that leans into the stride and a
head pivot that follows. `setGait(phase, amp, lean)` swings them; the renderer
advances the gait phase from each colonist's **smoothed speed** (estimated from
the interpolated position delta, so ~12 fps snapshots still walk smoothly at
render rate) and the vertical bob is **phase-locked to the gait**, so feet and
bounce agree. Idle keeps a slow micro-sway; each figure's phase is seeded by its
id so strides never sync across the crew. The astronaut also wears **rank**:
`setLeader(true)` swaps the cyan accents (visor glow, antenna tip, suit trim,
backpack) to the commander's **amber-gold** and reveals a chest chevron — the
renderer re-asserts it from `leaderId(snap)` every frame, so succession is
instant. Rank and possession are different signals by design: the possession
ring stays cyan.

The machines follow the astronaut's per-id pattern. **Rovers** (`kit/rover.ts`)
are reconciled against `snap.rovers` — a low chassis on cylinder wheels that
**roll** (the renderer integrates a wheel phase from the smoothed speed), an
emissive visor strip, and 1–3 cargo crates that appear as the bays fill; the
possessed rover gets the cyan ground ring plus a fake headlight (an emissive
cone + additive ground quad — no real lights in the kit, ever, for perf).
**Robots** (`kit/robot.ts`) reconcile against `snap.robots` — smaller than an
astronaut, two track boxes and a single pulsing eye that runs cool cyan and
dims to an ember while flare-stunned; a carry crate rides the deck while
loaded. **Vents** (`kit/vent.ts`) reconcile against `snap.vents` — static
fumaroles with a greeble-rock mound, a warm pulsing throat, and a breathing
heat-shimmer cone; they never move or deplete, so there's no `setAmount`. The
follow-cam unions over colonists ∪ rovers, and `placement.ts` dims a marker
onto every vent cell while a `needsVent` tool is up.

### Reaction bubbles

`render/three/bubbles.ts` gives the crew visible reactions: tiny comic chips —
"!" breaking for shelter, "+" limping to the medbay, a gear heading to work,
"z" going home after dark — triggered on **state change only**, plus one-shot
event words routed by the renderer ("storm!" on a hazard telegraph from the
lowest-id free colonist outside, "ouch" on `colonist_injured`, "taken!" on
`abducted` from the nearest witness to the UFO). It's a pooled
`THREE.Sprite` system: each chip is a lazily drawn, cached `CanvasTexture`
(rounded HUD-tone panel, mono glyph, cyan default / rust for alarm) with
values under the bloom threshold, so there's **zero per-frame canvas work**
and no blowout. Noise rules live in the system, not the callers: at most **4
concurrent chips**, a **6 s per-colonist cooldown**, and the **possessed
colonist never bubbles** — the player *is* that colonist; narrating them is
noise.

## The night pass — `KitEnv`

The scene derives one `nightLevel(tod, dust)` scalar per frame (0 = full day → 1
= deep night, computed off the ambient curve — so a dust storm reads as partial
night too) and hands it to every kit through an optional third `setStatus`
argument, `KitEnv` (`kit/contract.ts`). Builders that ignore it simply don't
declare the parameter. Kits use it to ramp warm collar windows, port lights,
LEDs, and the astronauts' visor/antenna at night; the shared door and airlock
glow materials are ramped **once** in the renderer, not per door. Window
positions come from a **derived greeble seed** (`seed ^ 0x77aa`), so the
pre-existing greeble picks stay byte-stable.

`KitEnv` now also carries the **weather**: optional `wind` (the snapshot's
`windLevel`) and `dt` (seconds since the last frame), filled in by the renderer
each frame. The wind turbine is the consumer: its `setStatus`
**rate-integrates** the rotor — `spin += (0.4 + 7·wind) · dt` — so the blades
idle on a calm sol, blur in a storm, and never jump angle when the wind level
steps between snapshots. The rotor's speed *is* the wind readout.

One hard rule across every kit: **rust "hurt" glows get no night boost.** The
night ramp rides the healthy (cyan/warm) path only — a warning must read as a
warning, never bloom into a halo.

## PostFx and the quality switch

`render/three/postfx.ts` is the high-quality render path: a composer chain of
**RenderPass → UnrealBloomPass → OutputPass → FXAA**, paired with **ACESFilmic tone
mapping** at exposure 1.15. The bloom **threshold is 1.0 by design**: only
emissives deliberately pushed above 1.0 bloom (the composer's HalfFloat targets
carry those values into the threshold test), so there are no layers or masks —
kits opt surfaces into glow by pushing intensity. A solar flare drives
`setFlare(level)` from `snap.hazards`, pulsing exposure and bloom strength in
short spikes.

Both quality paths now share the final **ACES / sRGB output step**, so fog,
background, and materials keep the same color treatment when bloom is disabled.
The composer is allocated lazily and released/rebuilt on a bloom toggle; Low
allocates no bloom mip-chain. A final FXAA pass cleans up small panel frames,
antennae, and corridor rings after tone mapping. The scene target is HDR; the
output target is 8-bit with no depth attachment. The final canvas does not
need its own MSAA. Flare exposure and its cadence survive quality
changes. The common output path adds scene/output targets and two fullscreen
passes on Low; it prevents the old direct-render path from changing the palette.

## The PerfGovernor — adaptive quality

Quality is no longer a two-position switch. `render/perf.ts` is a
**pure, unit-testable policy module** (no DOM or three imports — the renderer
owns the clocks and the levers) that walks a **ladder** of quality steps, each
a `{fps, pixel-ratio, bloom, shadows}` tuple. The ladder is finer than the old
tiers: from `60 fps / 1.5 / bloom / shadows` at the top, through 30 fps and
ratio steps, down to `30 / 1.0 / no bloom / no shadows` at the bottom. Two
indices are pinned as the legacy tiers — `STEP_HIGH` (60 fps, 1.5, bloom,
shadows — also the starting step) and `STEP_LOW` (the bottom rung).

Each frame the renderer measures the cost of the **frame body** — the time
spent inside the update+render work, never the inter-frame delta, which the
fps throttle clamps to the cap and so says nothing about headroom — and feeds
it to `governor.sample()`. The governor keeps an EMA (α derived from the
sample gap, clamped so one late frame can't own it) and moves only on
**contiguous, sustained evidence**: demote when the smoothed cost crowds 70%
of the current step's frame budget for 2 s (or spikes past 1.5× for 0.5 s);
promote when it sits under 40% of the **next-better** step's budget for a full
10 s. A 3 s **calibration window** after construction/reset collects without
transitioning, a 5 s cooldown follows any shift, and a >1 s sample gap (hidden
tab, debugger pause) voids the evidence — so it never flaps. One caveat for
live inspection: the calibration window anchors at the renderer's **first
frame sample**, so by the time the app has booted and exposed `window.__viv`,
`perfInfo().calibrating` has usually already gone false.

`ThreeRenderer.setQuality("auto" | "low" | "high")` is what the settings modal
drives, and **AUTO is the default**: it un-pins the governor and lets it walk
the ladder; **HIGH** and **LOW** `pin()` it to the legacy steps (a pinned
governor keeps measuring but never moves). When the step changes, the renderer
applies the levers in one place: the render-loop fps cap, the device pixel
ratio, the optional bloom pass, and shadow maps —
materials recompiled on the spot so the shadow flip takes hold immediately.
The sim is untouched by all of this: the worker ticks at its fixed cadence
whatever the render rate does. `renderer.perfInfo()` exposes the live read
(step, EMA, pinned, calibrating) for DEV.

## Ground contact and night definition

`ground-details.ts` batches contact darkening, faint base dust, and healthy
night door/window spill into at most three draws for the colony. The patches
share the actual terrain triangles (`Terrain.heightAt`), use soft alpha masks,
and depth-test against structures. They follow building position/rotation,
retire on removal, and rebuild on world changes. Night level only updates
material opacity; footprint changes rebuild geometry, while operating-state
changes rebuild only spill. Heights come from the cached terrain vertices.
Dust fades after sundown rather than glowing.

Door groups and warm portholes mark their source with `userData.groundLight`.
Spill uses those positions and the building's existing healthy status, adding
no real lights per building and no rust warning halos. A modest increase in
the existing hemisphere fill lifts night silhouettes without changing the
world palette or daylight. The sun retains its 1024² shadow map and its original
direction. Its frustum covers the entire terrain so new edge structures cast
shadows at every pan/zoom position, including at dawn and dusk.

## Camera

- An **isometric** camera framed on the colony (the buildable area is 41×41).
  Default zoom and building scale are unchanged; panning reaches every edge.
- WASD input in the HUD is **camera-aligned**: `App.vue` rotates the player's intent
  into the iso basis so "up" is up on screen regardless of camera angle.
- When you possess a colonist, the renderer runs a **follow-cam** off
  `snapshot.possessed`, interpolating the colonist's continuous position between
  snapshots so movement stays smooth at the snapshot rate.
- The always-visible **+ / − controls zoom** with native button semantics on
  mouse, keyboard, and touch. On a fine pointer, **left- or middle-drag pans**
  and the **wheel also zooms**. Every zoom input edits the same bounded profile
  layered over the automatic anchor,
  rather than mutating the Three camera directly (which the follow-cam would
  overwrite on its next frame). Colony and pilot views keep separate profiles:
  boarding starts centered, and releasing restores the previous colony framing.
  The camera angle remains fixed so camera-aligned movement never changes basis.
- Camera input ignores touch and pen; those pointers remain owned by the
  two-step placement and phone-pilot controls.

## Terrain, atmosphere, and hazards

- `terrain.ts` builds the ground the colony sits on: a 41×41 construction grid
  with a two-cell scenic margin, retaining the previous 45×45 terrain footprint
  and mesh density. The **play grid is flattened** to 15% displacement across
  the entire square, including its corners. **Ridged dunes and mesas** rise only
  in the scenic border. Seeded rocks and monoliths retain each world's palette
  and silhouettes; their full transformed bounds fit outside construction cells
  and inside the terrain. Rock counts follow the remaining border area.
- A small world-seeded bump/roughness map adds faint soil ripples at a fixed
  eight-cell repeat. It changes shading only: vertex colors, relief, build
  surface, and rock placement are unchanged. Terrain owns and releases this
  map on world changes.
- `atmosphere.ts` handles sky/lighting and the day-night feel as the sol turns.
- `stormfx.ts` is the **kinetic layer of a dust storm**: pooled **dust devils**
  (four rigs of nested counter-rotating shells; an active storm wakes two to four
  of them by intensity) wander the plain, and 200 low **wind streaks** — one
  `LineSegments` draw call — ramp up **through the telegraph phase**, so the
  warning gusts are visible before the veil closes in. Render-only: it reads
  `snap.hazards`/`weather` and never touches the sim.
- `hazardfx.ts` renders event-driven hazard FX (strikes, flashes, ring pulses,
  puffs) — its primitives are reused for the placement/possession juice above.
- The **UFO beam** (`ufo.ts`) is layered: an outer additive cone, a hot inner
  core, seeded **motes** rising up the frustum, and a ground ring — all scaled by
  the grab factor of its phase. The trader saucer (`alienship.ts`) deploys
  **landing struts** while landed and folds them for flight.
- `coords.ts` converts between engine grid cells and world space; `placement.ts`
  drives the build ghost and its valid/blocked tint (mirroring engine rules via the
  prediction seam).

## `debugFx` — screenshotting the rare stuff (DEV only)

Rare events (the UFO, an abduction flash, a dust devil) can take many sols to
occur naturally, so the renderer exposes `renderer.debugFx("ufo" | "abduct" |
"devil" | "pop")` — a DEV-only hook (`import.meta.env.DEV` guard; dead code in
prod builds) that drives the FX directly with **zero sim coupling**. The scripted
saucer is the interesting one: nothing snapshot-driven ever retires it, so it
**self-expires on a TTL** (~10 s of hover, then a 2.5 s leave ascent, then
dispose), can be toggled off early, and yields instantly if a real `snap.ufo`
takes ownership of the UFO visuals.

## Performance

The renderer is deliberately frugal because this is a background Easter egg, not a
foreground app:

- the render-loop fps cap is the **governor's lever** — 30 fps on the legacy
  steps, 60 only when AUTO has proven deep sustained headroom (12 fps while
  paused regardless, and not at all in a hidden tab);
- the device pixel ratio is another governor lever — **capped at 1.5** on the
  upper steps (≈55% of the fill cost of a Retina 2.0) and stepped down toward
  1.0 as the ladder descends;
- the storm/beam/FX layers are pooled and seeded — geometry lives for the
  session, the bubbles' chip textures are drawn once and cached, and the
  composer's render targets only exist while postfx is enabled;
- the entire three.js bundle is **lazy-loaded** behind the Easter-egg trigger
  (`index.html` / `src/main.ts`), so the heavy renderer never lands on the host
  page until the colony view is opened.

## See also

- [architecture.md](architecture.md) — the snapshot/command wall the renderer sits behind
- [gameplay.md](gameplay.md) — the camera and controls from the player's side
- [development.md](development.md) — the `window.__viv` hook for driving the renderer in tests
