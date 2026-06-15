/* ============================================================================
   Per-world VISUAL look table (render-side ONLY — the engine's pure SIM profile
   lives in engine/tuning.ts WORLDS and must never carry render data). Each
   settled world (mars/ceres/io/titan) gets a distinct palette + sky/sun tint so
   the renderer can re-theme the scene when snapshot.world changes.

   mars is the ANCHOR: every field below is today's hardcoded constant copied
   verbatim from terrain.ts / scene.ts, so a Mars colony renders pixel-identically
   to before this table existed. ceres/io/titan re-tint the SAME shaders.

   Colours are plain [r, g, b] 0..255 triples (scene.ts works in that space) or
   packed hex (the material colours terrain.ts feeds straight to three). Only the
   fields the two consumers actually read are here — keep it minimal.
   ============================================================================ */
import type { World } from "@shared/types";

/** an 0..255 RGB triple — the units scene.ts already lerps in */
export type RGB = [number, number, number];

/** sky/sun/ambient endpoints scene.update() lerps between by the ambient curve.
 *  Each is the [night, dust, clear] / [low, high] pair the existing code uses. */
export interface SkyLook {
  /** horizon (fog) colour: night → {dust, clear} day */
  horizon: { night: RGB; dust: RGB; clear: RGB };
  /** sky top colour: night → {dust, clear} day */
  top: { night: RGB; dust: RGB; clear: RGB };
  /** directional sun tint: low → {dust, clear} (lerped at 0.4 + amb*0.6) */
  sun: { low: RGB; dust: RGB; clear: RGB };
  /** ambient fill tint: night (low) → day (high) */
  ambient: { low: RGB; high: RGB };
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

/** everything the renderer needs to theme one world. The shape is intentionally
 *  the union of what terrain.ts + scene.ts read — nothing more. */
export interface WorldLook {
  /** seed for the boulder-field scatter (terrain.scatterRocks) */
  rockSeed: number;
  /** seed for the distant-monolith scatter (terrain.scatterMonoliths) */
  monolithSeed: number;
  /** vertex-colour ground palette */
  ground: GroundLook;
  /** instanced-boulder material colour */
  rockColor: number;
  /** distant-monolith material colour */
  monolithColor: number;
  /** sky/sun/ambient tint endpoints */
  sky: SkyLook;
}

export const WORLD_LOOKS: Record<World, WorldLook> = {
  // ---- the ANCHOR: today's exact constants (Mars renders byte-for-byte as before)
  mars: {
    rockSeed: 98213,
    monolithSeed: 0x77aa,
    ground: { lo: 0x36_1c_15, hi: 0x78_40_2a, accent: 0x6c_3a_22, ridge: 0x18_0d_0b }, // RUST_LO/RUST_HI/OCHRE/BASALT
    rockColor: 0x5a3322,
    monolithColor: 0x2a1a16,
    sky: {
      horizon: { night: [16, 12, 13], dust: [128, 70, 42], clear: [158, 92, 60] },
      top: { night: [8, 10, 14], dust: [44, 28, 20], clear: [22, 24, 32] },
      sun: { low: [90, 70, 60], dust: [200, 120, 70], clear: [255, 226, 190] },
      ambient: { low: [30, 28, 44], high: [120, 120, 150] },
    },
  },

  // ---- ceres: icy / pale blue-white, a weak pale sun, no dust to redden the sky
  ceres: {
    rockSeed: 0x1ce5,
    monolithSeed: 0x5ced,
    ground: { lo: 0x3a_44_4e, hi: 0xc8_d6_e2, accent: 0x9a_ae_c0, ridge: 0x26_2e_38 }, // slate → pale ice, blue-grey dune, deep shadow
    rockColor: 0x8aa0b4,
    monolithColor: 0x3a4654,
    sky: {
      // pale, washed-out blue-white; "dust" (none on Ceres) reads as a faint haze
      horizon: { night: [14, 18, 24], dust: [120, 140, 160], clear: [176, 200, 222] },
      top: { night: [8, 12, 18], dust: [40, 52, 66], clear: [120, 150, 184] },
      sun: { low: [70, 84, 96], dust: [150, 170, 190], clear: [206, 224, 240] }, // cold, weak white
      ambient: { low: [26, 32, 46], high: [150, 165, 190] },
    },
  },

  // ---- io: volcanic / dark basalt + sulfur-yellow tints, harsh
  io: {
    rockSeed: 0x10_a0,
    monolithSeed: 0x10_b0,
    ground: { lo: 0x18_14_0e, hi: 0x8a_6e_1e, accent: 0xc0_98_24, ridge: 0x0c_0a_08 }, // near-black basalt → sulfur yellow
    rockColor: 0x2a2418,
    monolithColor: 0x141008,
    sky: {
      // a harsh sulfur sky over dark rock; "dust" reads as an angry yellow-brown pall
      horizon: { night: [18, 14, 8], dust: [150, 116, 36], clear: [186, 150, 52] },
      top: { night: [12, 9, 6], dust: [52, 40, 16], clear: [54, 44, 22] },
      sun: { low: [96, 80, 44], dust: [210, 170, 70], clear: [248, 226, 130] }, // hot, yellow-white
      ambient: { low: [34, 28, 16], high: [150, 134, 80] },
    },
  },

  // ---- titan: hazy gold-orange, thick murky atmosphere, dim sun
  titan: {
    rockSeed: 0x71_7a,
    monolithSeed: 0x71_8b,
    ground: { lo: 0x2c_22_10, hi: 0x7e_64_2e, accent: 0x9c_7c_3a, ridge: 0x18_12_08 }, // dark tholin → murky gold
    rockColor: 0x4a3a1e,
    monolithColor: 0x241a0c,
    sky: {
      // the thick orange haze never fully clears, even at "night"; dim, diffuse sun
      horizon: { night: [40, 30, 16], dust: [134, 100, 44], clear: [168, 128, 60] },
      top: { night: [26, 20, 10], dust: [70, 54, 26], clear: [96, 74, 36] },
      sun: { low: [80, 64, 34], dust: [180, 142, 76], clear: [216, 178, 110] }, // dim, muddy gold
      ambient: { low: [38, 30, 16], high: [140, 116, 70] },
    },
  },
};

/** look lookup tolerant of pre-PTP saves / a corrupt world string (mirrors
 *  tuning.ts worldProfile — falls back to the mars anchor rather than throwing). */
export function worldLook(w: World | undefined): WorldLook {
  return WORLD_LOOKS[w ?? "mars"] ?? WORLD_LOOKS.mars;
}
