/* ============================================================================
   Injuries + the Med-Bay triage loop (doc §0 wall). A meteor/quake strike wounds
   every colonist near the impact; a second hit while wounded kills. Recovery is
   a pure rate — base everywhere, multiplied within reach of a working medbay,
   more again with a medic on its slot. Zero RNG draws: who is hurt falls out of
   the existing strike cells, so the main rng stream is byte-identical.
   ============================================================================ */
import type { ColonyState } from "./state";
import { buildingFunctional } from "./state";
import type { Emit } from "./tick";
import { accessCell } from "./colonists";
import { roleMatchCount } from "./roster";
import { bumpMorale } from "./morale";
import { techHealRateMult } from "./techs";
import {
  INJURY_RADIUS, INJURY_RECOVERY, MEDBAY_HEAL_MULT, MEDIC_HEAL_BONUS,
  HEAL_RADIUS, MORALE_BUMP,
} from "./tuning";

const MEDBAY_ID = "medbay";

/** the access cells of every medbay able to treat right now (functional +
 *  online), with whether a medic staffs its slot (the heal bonus) */
export function medbayStations(s: ColonyState): { x: number; y: number; matched: boolean }[] {
  const out: { x: number; y: number; matched: boolean }[] = [];
  for (const b of s.buildings) {
    if (b.defId !== MEDBAY_ID) continue;
    if (!b.online || !buildingFunctional(b)) continue;
    const cell = accessCell(s, b);
    out.push({ x: cell.x, y: cell.y, matched: roleMatchCount(s, b.uid, MEDBAY_ID) > 0 });
  }
  return out;
}

/** a strike landed at (gx, gy): wound every colonist within INJURY_RADIUS of the
 *  cell center — and kill the ones already wounded (the abduction removal
 *  pattern: instance gone, population down, possession cleared). */
export function applyStrikeInjuries(s: ColonyState, gx: number, gy: number, emit: Emit): void {
  for (const c of [...s.colonists]) {
    if (Math.hypot(c.x - gx, c.y - gy) > INJURY_RADIUS) continue;
    if (c.injury > 0) {
      s.colonists = s.colonists.filter((k) => k.id !== c.id);
      if (s.possessed === c.id) s.possessed = null;
      s.population = Math.max(0, s.population - 1);
      s.dead += 1;
      emit({ type: "casualty", detail: "strike", n: 1 });
      bumpMorale(s, -MORALE_BUMP.casualty);
    } else {
      c.injury = INJURY_RECOVERY;
      emit({ type: "colonist_injured", id: c.id });
      bumpMorale(s, -MORALE_BUMP.injured);
    }
  }
}

/** the tick's recovery pass — everyone heals at the base rate; a medbay in
 *  reach multiplies it, alien medi-gel multiplies the whole rate. Runs before
 *  stepColonists so the just-healed can take a work slot the same tick. */
export function updateInjuries(s: ColonyState, dt: number, emit: Emit): void {
  const stations = medbayStations(s);
  const techMult = techHealRateMult(s);
  for (const c of s.colonists) {
    if (c.injury <= 0) continue;
    let rate = 1;
    for (const st of stations) {
      if (Math.hypot(c.x - st.x, c.y - st.y) > HEAL_RADIUS) continue;
      rate = Math.max(rate, MEDBAY_HEAL_MULT * (st.matched ? 1 + MEDIC_HEAL_BONUS : 1));
    }
    c.injury -= rate * techMult * dt;
    if (c.injury <= 0) {
      c.injury = 0;
      emit({ type: "colonist_recovered", id: c.id });
    }
  }
}

export function injuredCount(s: ColonyState): number {
  let n = 0;
  for (const c of s.colonists) if (c.injury > 0) n += 1;
  return n;
}
