/* ============================================================================
   The Fabricator — rung 4 of the automation ladder: a building that builds a
   copy of a target building, and its own def targets ITSELF. Same idioms as
   the Rover/Robotics Bay lines, deliberately: the countdown PAUSES while the
   instance is dark or damaged (never resets), the fee is drawn at COMPLETION,
   and an unaffordable or unplaceable copy HOLDS at zero. The differences are
   the point: the countdown lives PER INSTANCE (BuildingState.replicateT) —
   every copy immediately runs its own clock, which turns a linear line into
   1 → 2 → 4 → 8 — and the output is a placed BuildingState, not an actor.
   (A shared fabricate() helper across rover/robot/fabricator was considered
   and declined: the state lives in different places — colony scalar vs per
   instance — and the outputs differ. The shared idioms are conventions.)

   Zero RNG anywhere (doc §0): the site search is a fixed N/E/S/W first-fit
   off the parent's footprint through an UNMODIFIED canPlace — bounds,
   occupancy, unlock gate, and affordability, where the fee IS the target
   def's own matCost, so the loop's check and canPlace's agree by
   construction. Growth self-limits on things that already exist — the finite
   grid boxes lineages in, brownout shedding pauses them first (priority 10),
   the materials ledger starves them — plus one new hard valve,
   FAB_MAX_LINEAGE, under which every countdown freezes (the robot-cap idiom;
   silent — the HUD lineage counter carries the why).

   The stall narration is edge-triggered with NO stored flag: `before > 0`
   is true only on the tick the countdown crosses zero, the value then sits
   at exactly 0 while blocked, and the only exit from 0 is a successful spawn
   (which re-arms both the countdown and the edge). A save mid-stall reloads
   at 0 and stays silent — the episode was already narrated.
   ============================================================================ */
import type { BuildingDef, BuildingState } from "@shared/types";
import type { ColonyState } from "./state";
import { buildingFunctional, emptyBuilding } from "./state";
import type { Emit } from "./tick";
import { DEFS } from "./defs";
import { canPlace, cellsFor, idx } from "./grid";
import { recomputeCaps } from "./caps";
import { FAB_MAX_LINEAGE } from "./tuning";

const FAB_ID = "fabricator";

/** the first adjacent seat for a copy of `target`, in fixed N/E/S/W order off
 *  the parent's footprint (offsets account for the target's own size, so the
 *  copy lands edge-to-edge). Deterministic by construction — an unordered
 *  search here is exactly what engine.test.ts exists to catch. */
function findAdjacentSite(
  s: ColonyState,
  parent: BuildingState,
  target: BuildingDef,
): { gx: number; gy: number } | null {
  const [w, h] = DEFS[parent.defId].foot;
  const candidates: [number, number][] = [
    [parent.gx, parent.gy - target.foot[1]], // N
    [parent.gx + w, parent.gy], // E
    [parent.gx, parent.gy + h], // S
    [parent.gx - target.foot[0], parent.gy], // W
  ];
  for (const [gx, gy] of candidates) {
    if (canPlace(s, target, gx, gy)) return { gx, gy };
  }
  return null;
}

/** every replicating instance runs its own line. Children pushed this tick are
 *  not in the iteration list — a copy starts its clock on its first own tick. */
export function updateFabricatorReplication(s: ColonyState, dt: number, emit: Emit): void {
  const line = s.buildings.filter((b) => DEFS[b.defId]?.replicates);
  if (line.length === 0) return;
  let fabs = 0;
  for (const b of s.buildings) if (b.defId === FAB_ID) fabs++;
  if (fabs >= FAB_MAX_LINEAGE) return; // at the valve: every countdown freezes where it stands

  for (const b of line) {
    const def = DEFS[b.defId];
    const rep = def.replicates!;
    if (!b.online || !buildingFunctional(b)) continue; // dark or damaged → pause, never reset
    if (def.staffing > 0 && !b.staffed) continue; // the fabricator is unstaffed; generic guard

    const before = b.replicateT ?? rep.buildS;
    b.replicateT = Math.max(0, before - dt);
    if (b.replicateT > 0) continue;
    const edge = before > 0; // true only on the crossing tick — one narration per episode

    const target = DEFS[rep.targetDefId];
    if (!target) continue;
    // a same-tick race at the valve: the loser holds at zero, silently
    if (rep.targetDefId === FAB_ID && fabs >= FAB_MAX_LINEAGE) continue;

    // the fee first, so the stall reason attributes cleanly (canPlace would
    // otherwise fail every candidate on affordability and read as boxed-in)
    if (s.materials.amount < (target.matCost ?? 0)) {
      if (edge) emit({ type: "fabricator_stalled", detail: "materials short", gx: b.gx, gy: b.gy });
      continue;
    }
    const site = findAdjacentSite(s, b, target);
    if (!site) {
      if (edge) emit({ type: "fabricator_stalled", detail: "no clear ground", gx: b.gx, gy: b.gy });
      continue;
    }

    s.materials.amount -= target.matCost ?? 0;
    const child = emptyBuilding(s.uidCounter++, rep.targetDefId, site.gx, site.gy);
    s.buildings.push(child);
    for (const [x, y] of cellsFor(target, site.gx, site.gy)) {
      s.grid[idx(s.N, x, y)] = child.uid;
    }
    recomputeCaps(s); // the generic field could target caps/popCap defs — place always does this
    if (rep.targetDefId === FAB_ID) fabs++;
    b.replicateT = rep.buildS; // re-arm the countdown (and with it, the stall edge)
    emit({ type: "fabricator_ready", defId: rep.targetDefId, gx: site.gx, gy: site.gy, n: fabs });
  }
}
