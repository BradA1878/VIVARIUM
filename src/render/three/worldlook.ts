/* ============================================================================
   Per-world VISUAL look table (render-side ONLY — the engine's pure SIM profile
   lives in engine/tuning.ts WORLDS and must never carry render data). Each
   settled world (mars/ceres/io/titan) gets a distinct palette + sky/sun tint so
   the renderer can re-theme the scene when snapshot.world changes.

   mars is the ANCHOR: its fog/terrain fields are the original hardcoded
   constants from terrain.ts / scene.ts; the `env` block (2026-09 lighting pass)
   intentionally changes how every world is lit. ceres/io/titan re-tint the SAME
   shaders.

   Colours are plain [r, g, b] 0..255 triples (scene.ts works in that space) or
   packed hex (the material colours terrain.ts feeds straight to three). Only the
   fields the two consumers actually read are here — keep it minimal.
   ============================================================================ */
import type { World } from "@shared/types";

/** an 0..255 RGB triple — the units scene.ts already lerps in */
export type RGB = [number, number, number];

/** the sky that LIGHTS the scene (baked into scene.environment by environment.ts).
 *  Separate from the fog/background endpoints: those paint the far haze; these
 *  are what metal, frosted and glass surfaces reflect and what every standard
 *  material takes its sky/ground fill from. Same 0..255-as-linear convention. */
export interface EnvLook {
  zenith: { night: RGB; dust: RGB; clear: RGB };
  horizon: { night: RGB; dust: RGB; clear: RGB };
  /** albedo factor on the world's mean soil color for the lower hemisphere */
  bounce: number;
  /** near-sun tint while the sun is low (Mars: the blue sunset glow) */
  lowSunGlow: RGB;
}

/** sky/sun/ambient endpoints scene.update() lerps between by the ambient curve.
 *  Each is the [night, dust, clear] / [low, high] pair the existing code uses. */
export interface SkyLook {
  /** horizon (fog) colour: night → {dust, clear} day */
  horizon: { night: RGB; dust: RGB; clear: RGB };
  /** directional sun tint: low → {dust, clear} (lerped at 0.4 + amb*0.6) */
  sun: { low: RGB; dust: RGB; clear: RGB };
  /** ambient fill tint: night (low) → day (high) */
  ambient: { low: RGB; high: RGB };
  /** image-based-lighting sky the environment map is baked from (environment.ts) */
  env: EnvLook;
}

/** the displaced-ground vertex palette terrain.ts blends per vertex (packed hex
 *  so it can mint THREE.Color once at module scope, exactly as today). */
export interface GroundLook {
  /** low/high of the base ground ramp (noise) */
  lo: number;
  hi: number;
  /** the dune accent it lerps toward */
  accent: number;
  /** the far-relief shadowed-rock colour the ridge tops fall toward */
  ridge: number;
}

/** terrain displacement amplitudes — the LANDFORM, not the colour. Varying these
 *  is what makes a world read as a different PLACE (jagged peaks vs rolling dunes
 *  vs flat ice), rather than Mars recoloured. */
export interface ReliefLook {
  /** base fbm displacement amplitude — ground roughness (mars 0.5) */
  noise: number;
  /** broad dune-swell amplitude (mars 0.35) */
  dune: number;
  /** dune frequency — low = big rolling dunes, high = tight chop (mars 0.14) */
  duneFreq: number;
  /** far-relief ridge height — the silhouette on the fog line (mars 1.8) */
  ridge: number;
}

/** boulder-field character (terrain.scatterRocks) */
export interface RockLook {
  count: number;   // how many boulders (mars 90)
  min: number;     // smallest scale (mars 0.18)
  max: number;     // largest scale (mars 0.78)
  detail: number;  // icosahedron subdivisions — 0 jagged shards, 1+ rounder (mars 0)
  squash: number;  // vertical squash — <1 flat slabs, 1 chunky (mars 0.7)
}

/** ground material feel — ice sheen, matte dust, volcanic glow */
export interface MatLook {
  rough: number;    // 0.55 icy specular … 0.99 dead matte (mars 0.97)
  metal: number;    // a touch of metalness for an icy/wet sheen (mars 0.02)
  /** emissive intensity (uses the ground accent colour) — a faint glow for Io's lava (mars 0) */
  emissive: number;
  /** share of the sky environment's fill the soil takes (envMapIntensity). Below 1
   *  keeps lit structures standing out from the ground. */
  skyFill: number;
}

/** the final display-space grade (applied inside the FXAA pass, after tone
 *  mapping): lift raises the blacks toward a tint, gain tints the highlights,
 *  both 0..255 per channel; saturation and vignette are plain factors. */
export interface GradeLook {
  lift: RGB;
  gain: RGB;
  saturation: number;
  /** the CSS `.vignette` overlay (App.vue / tokens.css) is the game's one
   *  vignette and predates this grade; every world keeps this term at 0 so
   *  the two never stack. Left in the shape rather than removed in case a
   *  future grade wants its own darkening independent of the CSS layer. */
  vignette: number;
}

/** everything the renderer needs to theme one world. The shape is intentionally
 *  the union of what terrain.ts + scene.ts read — nothing more. */
export interface WorldLook {
  /** seed for the boulder-field scatter (terrain.scatterRocks) */
  rockSeed: number;
  /** seed for the distant-monolith scatter (terrain.scatterMonoliths) */
  monolithSeed: number;
  /** vertex-colour ground palette */
  ground: GroundLook;
  /** terrain displacement amplitudes (the landform) */
  relief: ReliefLook;
  /** boulder-field character */
  rocks: RockLook;
  /** distant-monolith count */
  monoliths: { count: number };
  /** ground material feel */
  mat: MatLook;
  /** instanced-boulder material colour */
  rockColor: number;
  /** distant-monolith material colour */
  monolithColor: number;
  /** sky/sun/ambient tint endpoints */
  sky: SkyLook;
  /** final grade */
  grade: GradeLook;
}

export const WORLD_LOOKS: Record<World, WorldLook> = {
  // ---- the ANCHOR: the original terrain and fog constants (the env and grade blocks are the 2026-09 lighting pass)
  mars: {
    grade: { lift: [4, 2, 7], gain: [255, 250, 240], saturation: 1.05, vignette: 0 },
    rockSeed: 98213,
    monolithSeed: 0x77aa,
    ground: { lo: 0x36_1c_15, hi: 0x78_40_2a, accent: 0x6c_3a_22, ridge: 0x18_0d_0b }, // RUST_LO/RUST_HI/OCHRE/BASALT
    relief: { noise: 0.5, dune: 0.35, duneFreq: 0.14, ridge: 1.8 },
    rocks: { count: 90, min: 0.18, max: 0.78, detail: 0, squash: 0.7 },
    monoliths: { count: 7 },
    mat: { rough: 0.97, metal: 0.02, emissive: 0, skyFill: 0.45 },
    rockColor: 0x5a3322,
    monolithColor: 0x2a1a16,
    sky: {
      horizon: { night: [16, 12, 13], dust: [128, 70, 42], clear: [158, 92, 60] },
      sun: { low: [90, 70, 60], dust: [200, 120, 70], clear: [255, 226, 190] },
      ambient: { low: [30, 28, 44], high: [120, 120, 150] },
      env: {
        zenith: { night: [10, 13, 22], dust: [118, 82, 60], clear: [128, 112, 108] },
        horizon: { night: [16, 16, 24], dust: [150, 98, 66], clear: [232, 166, 118] },
        bounce: 1.6,
        lowSunGlow: [70, 110, 170], // Mars sunsets glow blue around the sun
      },
    },
  },

  // ---- ceres: icy / pale blue-white, a weak pale sun, no dust to redden the sky
  ceres: {
    grade: { lift: [3, 4, 7], gain: [248, 252, 255], saturation: 1.0, vignette: 0 },
    rockSeed: 0x1ce5,
    monolithSeed: 0x5ced,
    ground: { lo: 0x3a_44_4e, hi: 0xc8_d6_e2, accent: 0x9a_ae_c0, ridge: 0x26_2e_38 }, // slate → pale ice, blue-grey dune, deep shadow
    relief: { noise: 0.32, dune: 0.55, duneFreq: 0.09, ridge: 1.15 }, // flat glacial plains, broad icy swells, low ridges
    rocks: { count: 55, min: 0.16, max: 0.6, detail: 0, squash: 1.0 }, // sparse sharp ice shards
    monoliths: { count: 9 },
    mat: { rough: 0.55, metal: 0.18, emissive: 0, skyFill: 0.45 }, // icy specular sheen
    rockColor: 0x8aa0b4,
    monolithColor: 0x3a4654,
    sky: {
      // pale, washed-out blue-white; "dust" (none on Ceres) reads as a faint haze
      horizon: { night: [14, 18, 24], dust: [120, 140, 160], clear: [176, 200, 222] },
      sun: { low: [70, 84, 96], dust: [150, 170, 190], clear: [206, 224, 240] }, // cold, weak white
      ambient: { low: [26, 32, 46], high: [150, 165, 190] },
      env: {
        zenith: { night: [8, 12, 20], dust: [60, 72, 88], clear: [132, 156, 186] },
        horizon: { night: [14, 18, 26], dust: [120, 138, 156], clear: [172, 190, 210] },
        bounce: 1.1,
        lowSunGlow: [200, 214, 235],
      },
    },
  },

  // ---- io: volcanic / dark basalt + sulfur-yellow tints, harsh
  io: {
    grade: { lift: [5, 4, 2], gain: [255, 250, 236], saturation: 1.04, vignette: 0 },
    rockSeed: 0x10_a0,
    monolithSeed: 0x10_b0,
    ground: { lo: 0x18_14_0e, hi: 0x8a_6e_1e, accent: 0xc0_98_24, ridge: 0x0c_0a_08 }, // near-black basalt → sulfur yellow
    relief: { noise: 0.72, dune: 0.2, duneFreq: 0.22, ridge: 2.7 }, // jagged, chaotic, tall sharp volcanic peaks
    rocks: { count: 150, min: 0.2, max: 0.95, detail: 0, squash: 0.9 }, // dense jagged basalt boulders
    monoliths: { count: 12 }, // volcanic spires on the skyline
    mat: { rough: 0.96, metal: 0.04, emissive: 0.14, skyFill: 0.45 }, // faint sulfur/lava glow
    rockColor: 0x2a2418,
    monolithColor: 0x141008,
    sky: {
      // a harsh sulfur sky over dark rock; "dust" reads as an angry yellow-brown pall
      horizon: { night: [18, 14, 8], dust: [150, 116, 36], clear: [186, 150, 52] },
      sun: { low: [96, 80, 44], dust: [210, 170, 70], clear: [248, 226, 130] }, // hot, yellow-white
      ambient: { low: [34, 28, 16], high: [150, 134, 80] },
      env: {
        zenith: { night: [12, 10, 8], dust: [110, 88, 36], clear: [120, 104, 70] },
        horizon: { night: [20, 16, 10], dust: [160, 126, 44], clear: [214, 180, 92] },
        bounce: 1.2,
        lowSunGlow: [240, 190, 110],
      },
    },
  },

  // ---- titan: hazy gold-orange, thick murky atmosphere, dim sun
  titan: {
    grade: { lift: [5, 4, 2], gain: [255, 247, 232], saturation: 1.03, vignette: 0 },
    rockSeed: 0x71_7a,
    monolithSeed: 0x71_8b,
    ground: { lo: 0x2c_22_10, hi: 0x7e_64_2e, accent: 0x9c_7c_3a, ridge: 0x18_12_08 }, // dark tholin → murky gold
    relief: { noise: 0.24, dune: 0.9, duneFreq: 0.075, ridge: 0.85 }, // smooth base under big rolling dunes, low horizon
    rocks: { count: 28, min: 0.2, max: 0.7, detail: 1, squash: 0.6 }, // few rounded, half-buried in the sand
    monoliths: { count: 4 },
    mat: { rough: 0.99, metal: 0, emissive: 0, skyFill: 0.5 }, // dead matte tholin
    rockColor: 0x4a3a1e,
    monolithColor: 0x241a0c,
    sky: {
      // the thick orange haze never fully clears, even at "night"; dim, diffuse sun
      horizon: { night: [40, 30, 16], dust: [134, 100, 44], clear: [168, 128, 60] },
      sun: { low: [80, 64, 34], dust: [180, 142, 76], clear: [216, 178, 110] }, // dim, muddy gold
      ambient: { low: [38, 30, 16], high: [140, 116, 70] },
      env: {
        zenith: { night: [30, 24, 14], dust: [100, 78, 40], clear: [140, 110, 62] },
        horizon: { night: [42, 32, 18], dust: [140, 106, 50], clear: [180, 140, 72] },
        bounce: 1.0,
        lowSunGlow: [190, 120, 60],
      },
    },
  },
};

/** look lookup tolerant of pre-PTP saves / a corrupt world string (mirrors
 *  tuning.ts worldProfile — falls back to the mars anchor rather than throwing). */
export function worldLook(w: World | undefined): WorldLook {
  return WORLD_LOOKS[w ?? "mars"] ?? WORLD_LOOKS.mars;
}
