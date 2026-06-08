/* ============================================================================
   Pool capacities + housing recomputed from the placed buildings. Pure function
   of state, extracted so both the Colony (on place/remove) and the hazard system
   (on a building destroyed) can call it.
   ============================================================================ */
import type { Resource } from "@shared/types";
import { DEFS } from "./defs";
import { BASE_CAP, MATERIALS_CAP } from "./tuning";
import { techCapBonus } from "./techs";
import type { ColonyState } from "./state";

export function recomputeCaps(s: ColonyState): void {
  const caps: Record<Resource, number> = { ...BASE_CAP };
  let housing = 0;
  for (const b of s.buildings) {
    const def = DEFS[b.defId];
    if (!def) continue;
    if (def.caps) for (const k in def.caps) caps[k as Resource] += def.caps[k as Resource]!;
    if (def.popCap) housing += def.popCap;
  }
  // permanent alien-tech capacity upgrades
  const tech = techCapBonus(s);
  for (const k in caps) {
    const r = k as Resource;
    caps[r] += tech[r];
    s.pools[r].capacity = caps[r];
    if (s.pools[r].amount > caps[r]) s.pools[r].amount = caps[r];
  }
  s.materials.capacity = MATERIALS_CAP + tech.materials;
  if (s.materials.amount > s.materials.capacity) s.materials.amount = s.materials.capacity;
  s.housing = housing;
}
