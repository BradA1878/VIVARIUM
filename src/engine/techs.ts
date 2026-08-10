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
  /** atmospheric explanation shown beside the offer */
  desc: string;
  /** exact, player-facing mechanical consequence */
  effect: string;
  /** permanent pool-capacity additions */
  capBonus?: Partial<Record<Resource | "materials", number>>;
  /** flat power generated every second, day or night */
  passivePower?: number;
  /** multiplier on per-colonist demand (e.g. oxygen 0.82 = 18% less) */
  demandMult?: Partial<Record<"oxygen" | "water" | "food", number>>;
  /** added to each Deflector Array's per-unit abduction-block chance */
  deflectorBoost?: number;
  /** multiplies the injury recovery rate (engine/injury.ts) */
  healRateMult?: number;
  /** raises the colony's morale floor (engine/morale.ts moraleFloor) */
  moraleFloor?: number;
}

export const TECH_DEFS: Record<string, TechDef> = {
  capacitor: {
    id: "capacitor", name: "Capacitor Lattice", glyph: "⚡",
    desc: "An alien storage matrix folds charge into a space smaller than its casing.",
    effect: "+140 kW maximum power capacity.",
    capBonus: { power: 140 },
  },
  cryocell: {
    id: "cryocell", name: "Cryo Cistern", glyph: "≈",
    desc: "A folded-space cistern holds more water than its shell can contain.",
    effect: "+140 m³ maximum water capacity.",
    capBonus: { water: 140 },
  },
  o2reservoir: {
    id: "o2reservoir", name: "O₂ Reservoir", glyph: "◌",
    desc: "A pressure vault binds oxygen in a stable nonhuman lattice.",
    effect: "+110 kPa maximum oxygen capacity.",
    capBonus: { oxygen: 110 },
  },
  fusioncell: {
    id: "fusioncell", name: "Fusion Cell", glyph: "✷",
    desc: "A sliver of a star burns without fuel or sunlight.",
    effect: "+3.5 power every second, day and night.",
    passivePower: 3.5,
  },
  bioscrubber: {
    id: "bioscrubber", name: "Bioscrubber", glyph: "✿",
    desc: "A living filter learns the chemistry of every breath passing through it.",
    effect: "Colonists consume 18% less oxygen.",
    demandMult: { oxygen: 0.82 },
  },
  aegis: {
    id: "aegis", name: "Aegis Resonator", glyph: "⛨",
    desc: "The resonator retunes every Deflector Array to the visitors' own frequencies.",
    effect: "Each online Deflector blocks 80% of abduction attempts, up from 50%.",
    deflectorBoost: 0.3,
  },
  medigel: {
    id: "medigel", name: "Medi-Gel", glyph: "✚",
    desc: "An alien tissue weave knits a wound from within.",
    effect: "Injured colonists heal twice as fast.",
    healRateMult: 2,
  },
  harmonizer: {
    id: "harmonizer", name: "Harmonizer", glyph: "♬",
    desc: "A standing resonance settles into the crew's bones and quiets panic.",
    effect: "Colony morale can never fall below 45% (up from 15%).",
    moraleFloor: 0.45,
  },
};

export const TECH_IDS: string[] = Object.keys(TECH_DEFS);

/** Record lookups must not accept Object.prototype names from edited saves. */
export function isKnownTech(id: string): boolean {
  return Object.hasOwn(TECH_DEFS, id);
}

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

/** summed abduction-block boost from acquired techs (added per Deflector Array) */
export function techDeflectorBoost(s: ColonyState): number {
  let b = 0;
  for (const id of s.acquiredTech) b += TECH_DEFS[id]?.deflectorBoost ?? 0;
  return b;
}

/** product of injury heal-rate multipliers from acquired techs (medi-gel).
 *  Tolerates minimal test states that omit acquiredTech. */
export function techHealRateMult(s: ColonyState): number {
  let m = 1;
  for (const id of s.acquiredTech ?? []) m *= TECH_DEFS[id]?.healRateMult ?? 1;
  return m;
}

/** the highest tech-raised morale floor (0 with none acquired — harmonizer).
 *  Tolerates minimal test states that omit acquiredTech. */
export function techMoraleFloor(s: ColonyState): number {
  let f = 0;
  for (const id of s.acquiredTech ?? []) f = Math.max(f, TECH_DEFS[id]?.moraleFloor ?? 0);
  return f;
}
