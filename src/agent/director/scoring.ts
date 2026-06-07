/* ============================================================================
   Director scoring — how much pressure would each hazard create, given the
   colony's *current shape*? Pure function of the snapshot + the causal world
   model, so the Director's tactics are testable. Power-fragile bases invite
   flares and cold snaps; sprawling sealed layouts invite meteors and quakes.
   ============================================================================ */
import type { HazardKind, Snapshot } from "@shared/types";
import { DEFS } from "@/engine";
import { risks } from "../worldmodel";

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

export interface ColonyShape {
  /** how exposed the colony is to losing power (few batteries, solar-dependent) */
  powerFragility: number;
  /** built surface a meteor can hit (sealed units + corridors) */
  layout: number;
  /** corridor count exposure (quakes break the seal) */
  corridors: number;
  /** solar dependence with thin buffers (dust bites) */
  solarDependence: number;
}

export function colonyShape(s: Snapshot): ColonyShape {
  let sealed = 0, corridorCount = 0, solar = 0;
  for (const b of s.buildings) {
    const d = DEFS[b.defId];
    if (!d) continue;
    if (d.requiresPressure) sealed++;
    if (d.conduit) corridorCount++;
    if (d.solar) solar++;
  }
  const extraBattery = Math.max(0, s.pools.power.capacity - 80); // beyond base cap
  const thinBuffer = 1 - clamp01(extraBattery / 240);
  return {
    powerFragility: clamp01(thinBuffer * (solar > 0 ? 1 : 0.5)),
    layout: clamp01((sealed + corridorCount) / 12),
    corridors: clamp01(corridorCount / 8),
    solarDependence: clamp01(solar / 4) * thinBuffer,
  };
}

/** raw pressure score per hazard kind (higher = more interesting to throw now) */
export function scoreHazards(s: Snapshot): Record<HazardKind, number> {
  const shape = colonyShape(s);
  const score: Record<HazardKind, number> = {
    flare: 0.3 + 0.7 * shape.powerFragility,
    coldsnap: 0.25 + 0.6 * shape.powerFragility,
    meteor: 0.3 + 0.7 * shape.layout,
    quake: 0.2 + 0.7 * shape.corridors,
    dust: 0.3 + 0.6 * shape.solarDependence,
  };

  // lean into a seam that's already fraying
  for (const risk of risks(s)) {
    if (risk.resource === "power") { score.flare += 0.25; score.coldsnap += 0.2; }
    else { score.meteor += 0.15; score.quake += 0.1; } // disrupt the producers
  }
  return score;
}
