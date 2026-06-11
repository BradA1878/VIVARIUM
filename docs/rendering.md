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
meshes** (`dome.ts`, `drum.ts`, `solar.ts`, `tank.ts`, `corridor.ts`, plus
`astronaut.ts` and `deposit.ts`; the ships — `alienship.ts`, `ufo.ts` — and
`depot.ts` live beside the kit). The kit goes through a `contract.ts`
seam and keeps a `GLTFLoader` path, so real `.glb` assets can drop in later with no
changes at the call sites.

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
id so strides never sync across the crew.

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

One hard rule across every kit: **rust "hurt" glows get no night boost.** The
night ramp rides the healthy (cyan/warm) path only — a warning must read as a
warning, never bloom into a halo.

## PostFx and the quality switch

`render/three/postfx.ts` is the high-quality render path: a composer chain of
**RenderPass → UnrealBloomPass → OutputPass**, paired with **ACESFilmic tone
mapping** at exposure 1.15. The bloom **threshold is 1.0 by design**: only
emissives deliberately pushed above 1.0 bloom (the composer's HalfFloat targets
carry those values into the threshold test), so there are no layers or masks —
kits opt surfaces into glow by pushing intensity. A solar flare drives
`setFlare(level)` from `snap.hazards`, pulsing exposure and bloom strength in
short spikes.

The **composer is allocated lazily** on the first enabled render and its GPU
targets are released on disable; disabled is the **pixel-identical pre-postfx
path** (NoToneMapping, exposure 1.0, direct `renderer.render`).

`ThreeRenderer.setQuality("low" | "high")` (`scene.ts`) flips the whole tier in
one switch — this is what the settings modal drives:

- **high** — postfx on, shadow maps on, pixel ratio capped at 1.5;
- **low** — postfx off (the pixel-identical path above) *plus* shadow maps off
  and pixel ratio dropped to 1.0 as a performance mode. Materials are recompiled
  on the spot so the shadow toggle takes hold immediately.

## Camera

- An **isometric** camera framed on the colony (the buildable area is 15×15).
- WASD input in the HUD is **camera-aligned**: `App.vue` rotates the player's intent
  into the iso basis so "up" is up on screen regardless of camera angle.
- When you possess a colonist, the renderer runs a **follow-cam** off
  `snapshot.possessed`, interpolating the colonist's continuous position between
  snapshots so movement stays smooth at the snapshot rate.

## Terrain, atmosphere, and hazards

- `terrain.ts` builds the Mars ground the colony sits on — a displaced rust plane
  spanning the grid plus a 10-cell margin. The **play grid is flattened** (15% of
  the displacement inside the grid, smoothstepped back to full within ~3 cells)
  so placement stays readable, while **ridged dunes and mesas** rise past the
  grid toward the fog line and **~7 basalt monoliths** stand on the far relief as
  silhouettes. The monoliths draw from their own seeded stream, and the boulder
  scatter still consumes its legacy keep-rolls, so the pre-existing rock field is
  byte-stable.
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

- render is **capped at 30 fps** (12 fps while paused, and not at all in a hidden
  tab);
- the device pixel ratio is **capped at 1.5 on high** (≈55% of the fill cost of a
  Retina 2.0) and **dropped to 1.0 on low** — see the quality switch above;
- the storm/beam/FX layers are pooled and seeded — geometry lives for the
  session, and the composer's render targets only exist while postfx is enabled;
- the entire three.js bundle is **lazy-loaded** behind the Easter-egg trigger
  (`index.html` / `src/main.ts`), so the heavy renderer never lands on the host
  page until the colony view is opened.

## See also

- [architecture.md](architecture.md) — the snapshot/command wall the renderer sits behind
- [gameplay.md](gameplay.md) — the camera and controls from the player's side
- [development.md](development.md) — the `window.__viv` hook for driving the renderer in tests
