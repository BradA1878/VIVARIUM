/* ============================================================================
   Injuries + the Med-Bay triage loop (doc §0 wall). A meteor/quake strike wounds
   every colonist near the impact; a second hit while wounded kills. Recovery is
   a pure rate — base everywhere, multiplied within reach of a working medbay,
   more again with a medic on its slot. Zero RNG draws: who is hurt falls out of
   the existing strike cells, so the main rng stream is byte-identical.
   ============================================================================ */
import type { ColonyState } from "./state";
import { buildingFunctional, removePilot } from "./state";
import type { Emit } from "./tick";
import { accessCell, atSealedShelter } from "./colonists";
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

/** A strike landed at (gx, gy): wound every exposed colonist within
 *  INJURY_RADIUS and kill the ones already wounded. Each hazard instance can
 *  affect a colonist only once, preventing a rapid multi-strike event from
 *  inflicting both the wound and the lethal follow-up. Autonomous colonists who
 *  have physically reached sealed shelter are safe from quake jolts. */
export function applyStrikeInjuries(
  s: ColonyState,
  gx: number,
  gy: number,
  hazard: { id: number; kind: "meteor" | "quake" },
  emit: Emit,
): void {
  for (const c of [...s.colonists]) {
    if (Math.hypot(c.x - gx, c.y - gy) > INJURY_RADIUS) continue;
    if (hazard.kind === "quake" && atSealedShelter(s, c)) continue;
    if (c.lastStrikeHazardId === hazard.id) continue;
    c.lastStrikeHazardId = hazard.id;
    if (c.injury > 0) {
      s.colonists = s.colonists.filter((k) => k.id !== c.id);
      removePilot(s, c.id);
      s.lastLossCause = { type: "strike", hazard: hazard.kind };
      s.population = Math.max(0, s.population - 1);
      s.dead += 1;
      emit({ type: "casualty", detail: "strike", kind: hazard.kind, n: 1 });
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
