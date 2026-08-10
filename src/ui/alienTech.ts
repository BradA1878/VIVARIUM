import type { ColonyEvent } from "@shared/types";
import { TECH_DEFS, isKnownTech } from "@/engine";

/** The deliberately small view model shared by the acquisition reveal and the
 *  persistent status panel. Engine data remains the source of truth; this layer
 *  only gives unknown/stale ids a safe, legible fallback. */
export interface AlienTechView {
  id: string;
  name: string;
  glyph: string;
  lore: string;
  effect: string;
}

export function alienTechView(id: string): AlienTechView {
  const def = isKnownTech(id) ? TECH_DEFS[id] : undefined;
  if (!def) {
    return {
      id,
      name: "Unrecognized Relic",
      glyph: "◇",
      lore: "A recovered nonhuman system whose operating principles remain unknown.",
      effect: `No modeled effect. This save contains an unrecognized technology id (${id}).`,
    };
  }
  return {
    id: def.id,
    name: def.name,
    glyph: def.glyph,
    lore: def.desc,
    effect: def.effect,
  };
}

/** Ordinary resource swaps also emit trade_done. The typed tech id is the only
 *  acquisition signal; never infer one from a translated/free-text name. */
export function alienTechFromEvent(event: ColonyEvent): AlienTechView | null {
  return event.type === "trade_done" && event.tech
    ? alienTechView(event.tech)
    : null;
}
