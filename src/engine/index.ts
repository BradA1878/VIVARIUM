/* ============================================================================
   Engine public surface. Pure, deterministic, standalone (doc §0). The worker
   hosts a Colony; nothing here touches the DOM, three.js, or the network.
   ============================================================================ */
export { Colony } from "./colony";
export { DEFS, ORDER } from "./defs";
export { doorCells, doorCellsOf, worldDoorSide, SIDE_DELTA } from "./doors";
export { planRoute, routeCorridor, type RouteQuery } from "./route";
export { HAZARD_META, hazardMods } from "./hazards";
export { TECH_DEFS, TECH_IDS, type TechDef } from "./techs";
export { RNG } from "./rng";
export { solarOutput } from "./tick";
export { FUNC_THRESHOLD, buildingFunctional } from "./state";
export type { ColonyState, SaveData } from "./state";
export * as Tuning from "./tuning";
