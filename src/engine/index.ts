/* ============================================================================
   Engine public surface. Pure, deterministic, standalone (doc §0). The worker
   hosts a Colony; nothing here touches the DOM, three.js, or the network.
   ============================================================================ */
export { Colony } from "./colony";
export { DEFS, ORDER } from "./defs";
export { RNG } from "./rng";
export { solarOutput } from "./tick";
export type { ColonyState, SaveData } from "./state";
export * as Tuning from "./tuning";
