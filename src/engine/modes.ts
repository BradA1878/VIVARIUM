/* ============================================================================
   The player's crew setting per building (FIRST / NORMAL / OFF) — which
   settings a def offers, and the order the production pass visits buildings
   in. Pure; shared by the tick, Colony.setMode, and the UI's buttons.
   ============================================================================ */
import type { BuildingDef, BuildingMode } from "@shared/types";

/** FIRST / NORMAL / OFF when the building needs crew; NORMAL / OFF when it draws
 *  power (except the hub, corridors, and housing, which hold the colony
 *  together); nothing for generators and storage */
export function modesFor(def: BuildingDef): BuildingMode[] {
  if (def.staffing > 0) return ["first", "normal", "off"];
  if ((def.consumes.power ?? 0) > 0 && !def.isHub && !def.conduit && !def.popCap) return ["normal", "off"];
  return [];
}

/** the order the production pass (and the crew posting after it) visits
 *  buildings: FIRST ones, then the rest, each in build order. The same array
 *  when nothing is set to FIRST, so a colony without settings runs as before. */
export function productionOrder<B extends { mode?: "first" | "off" }>(buildings: B[]): B[] {
  if (!buildings.some((b) => b.mode === "first")) return buildings;
  return [...buildings.filter((b) => b.mode === "first"), ...buildings.filter((b) => b.mode !== "first")];
}
