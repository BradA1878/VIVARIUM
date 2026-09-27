/* ============================================================================
   The Atomic Printer's choice: whichever of oxygen, water, food, or materials
   is lowest as a share of its capacity (ties in that order; a pool with no
   capacity counts as full). Pure, no RNG.
   ============================================================================ */
import type { ColonyState } from "./state";

export type PrintTarget = "oxygen" | "water" | "food" | "materials";
const TARGETS: readonly PrintTarget[] = ["oxygen", "water", "food", "materials"];

export function lowestPrintTarget(s: Pick<ColonyState, "pools" | "materials">): PrintTarget {
  let best: PrintTarget = TARGETS[0];
  let bestFill = Infinity;
  for (const k of TARGETS) {
    const p = k === "materials" ? s.materials : s.pools[k];
    const f = p.capacity > 0 ? p.amount / p.capacity : Infinity;
    if (f < bestFill) { bestFill = f; best = k; }
  }
  return best;
}
