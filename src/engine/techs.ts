/* ============================================================================
   Alien tech — the richer trade reward. Some trade offers GIVE a permanent
   upgrade instead of a resource: a capacity boost, passive generation, or lower
   colonist demand. Acquired techs are data; their effects are summed into the
   caps pass (caps.ts) and the tick (generation + colonist demand). Pure.
   ============================================================================ */
import type { Resource } from "@shared/types";
import type { ColonyState } from "./state";

export interface TechDef {
  id: string;
  name: string;
  glyph: string;
  desc: string;
  /** permanent pool-capacity additions */
  capBonus?: Partial<Record<Resource | "materials", number>>;
  /** flat power generated every second, day or night */
  passivePower?: number;
  /** multiplier on per-colonist demand (e.g. oxygen 0.82 = 18% less) */
  demandMult?: Partial<Record<"oxygen" | "water" | "food", number>>;
}

export const TECH_DEFS: Record<string, TechDef> = {
  capacitor: {
    id: "capacitor", name: "Capacitor Lattice", glyph: "⚡",
    desc: "Alien storage matrix. +140 power capacity.",
    capBonus: { power: 140 },
  },
  cryocell: {
    id: "cryocell", name: "Cryo Cistern", glyph: "≈",
    desc: "Folded-space water store. +140 water capacity.",
    capBonus: { water: 140 },
  },
  o2reservoir: {
    id: "o2reservoir", name: "O₂ Reservoir", glyph: "◌",
    desc: "Compressed oxygen vault. +110 oxygen capacity.",
    capBonus: { oxygen: 110 },
  },
  fusioncell: {
    id: "fusioncell", name: "Fusion Cell", glyph: "✷",
    desc: "A sliver of a star. +3.5 power every second, day or night.",
    passivePower: 3.5,
  },
  bioscrubber: {
    id: "bioscrubber", name: "Bioscrubber", glyph: "✿",
    desc: "Living air filter. Colonists need 18% less oxygen.",
    demandMult: { oxygen: 0.82 },
  },
};

export const TECH_IDS: string[] = Object.keys(TECH_DEFS);

/** summed capacity bonus from acquired techs */
export function techCapBonus(s: ColonyState): Record<Resource | "materials", number> {
  const out: Record<Resource | "materials", number> = { power: 0, water: 0, oxygen: 0, food: 0, materials: 0 };
  for (const id of s.acquiredTech) {
    const cb = TECH_DEFS[id]?.capBonus;
    if (cb) for (const k in cb) out[k as Resource | "materials"] += cb[k as Resource | "materials"]!;
  }
  return out;
}

/** total flat passive power generation from acquired techs */
export function techPassivePower(s: ColonyState): number {
  let p = 0;
  for (const id of s.acquiredTech) p += TECH_DEFS[id]?.passivePower ?? 0;
  return p;
}

/** product of demand multipliers for a life-support resource */
export function techDemandMult(s: ColonyState, k: "oxygen" | "water" | "food"): number {
  let m = 1;
  for (const id of s.acquiredTech) {
    const dm = TECH_DEFS[id]?.demandMult?.[k];
    if (dm != null) m *= dm;
  }
  return m;
}
