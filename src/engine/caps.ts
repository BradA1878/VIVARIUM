/* ============================================================================
   Pool capacities + housing recomputed from the placed buildings. Pure function
   of state, extracted so both the Colony (on place/remove) and the hazard system
   (on a building destroyed) can call it.
   ============================================================================ */
import type { Resource } from "@shared/types";
import { DEFS } from "./defs";
import { BASE_CAP } from "./tuning";
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
  for (const k in caps) {
    const r = k as Resource;
    s.pools[r].capacity = caps[r];
    if (s.pools[r].amount > caps[r]) s.pools[r].amount = caps[r];
  }
  s.housing = housing;
}
