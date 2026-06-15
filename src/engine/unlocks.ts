/* ============================================================================
   Abundance unlocks — the expansion palette opens as the colony proves itself.
   GATES is a data table (defId → predicate over ColonyState); each tick the
   un-latched gates are evaluated and the first true LATCHES into s.unlocked
   with one `unlock` event — an unlock never revokes, even if its condition
   regresses. The 12 founding defs are never gated. Pure derivations, ZERO rng
   draws (doc §0): the main hazard/arrival stream stays byte-identical, and a
   legacy save (no latch) simply re-derives the currently-true gates on its
   first tick — announcing the new buildings once, deterministically.
   ============================================================================ */
import type { ColonyEvent } from "@shared/types";
import { DEFS, ORDER } from "./defs";
import type { ColonyState } from "./state";

type Emit = (e: Omit<ColonyEvent, "t" | "sol" | "tod">) => void;

/** the gate per expansion def — anything NOT in this table is always open */
export const GATES: Record<string, (s: ColonyState) => boolean> = {
  windturbine: (s) =>
    s.sol >= 4 || s.hazards.some((h) => h.kind === "dust" && h.phase === "active"),
  geothermal: (s) => s.sol >= 6,
  reactor: (s) => s.population >= 8 && s.materials.amount >= 150,
  printer: (s) => s.population >= 6,
  roverbay: (s) => s.sol >= 3 || s.materials.amount >= 80,
  roboticsbay: (s) =>
    s.buildings.some((b) => b.defId === "reactor") ||
    (s.population >= 10 && s.materials.amount >= 200),
  awg: (s) => s.sol >= 5 || s.population >= 6,
  aquifer: (s) => s.sol >= 8,
  // a mid-game efficiency unlock: once the colony has grown, OR you've built the
  // Hydroponics whose greywater it recycles. (Electrolysis is a FOUNDING building, so
  // gating on it would open the reclaimer at sol 0 — defeating the "stretch what you
  // have" intent; the population/greenhouse gate keeps it a real progression step.)
  reclaimer: (s) =>
    s.population >= 6 || s.buildings.some((b) => b.defId === "greenhouse"),
  // the endgame: only once the colony is thriving PAST the reactor tier — a built
  // reactor plus a real settlement's population and a materials stockpile. The
  // prize you launch from. (threshold tuned in balance — design open question #1)
  ptp: (s) =>
    s.buildings.some((b) => b.defId === "reactor") &&
    s.population >= 12 && s.materials.amount >= 300,
};

/** is this def still behind its gate? Founding defs are never locked.
 *  (Tolerant of minimal injected states, like difficultyProfile.) */
export function defLocked(s: ColonyState, defId: string): boolean {
  return defId in GATES && !(s.unlocked ?? []).includes(defId);
}

/** evaluate un-latched gates; latch + announce each exactly once */
export function updateUnlocks(s: ColonyState, emit: Emit): void {
  for (const defId of Object.keys(GATES)) {
    if (s.unlocked.includes(defId)) continue;
    if (GATES[defId](s)) {
      s.unlocked.push(defId);
      emit({ type: "unlock", defId, detail: DEFS[defId].name });
    }
  }
}

/** the full palette map for the snapshot — every ORDER id → placeable? */
export function computeUnlocks(s: ColonyState): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const id of ORDER) out[id] = !defLocked(s, id);
  return out;
}
