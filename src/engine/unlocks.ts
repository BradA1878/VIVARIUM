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
  // a crewless food source for colonies short of hands: open once Hydroponics
  // is known, or by sol 6
  bioprinter: (s) => s.sol >= 6 || s.buildings.some((b) => b.defId === "greenhouse"),
  // power into whatever is running out: a reactor-era machine
  atomic: (s) => s.buildings.some((b) => b.defId === "reactor"),
  awg: (s) => s.sol >= 5 || s.population >= 6,
  aquifer: (s) => s.sol >= 8,
  // a mid-game efficiency unlock: once the colony has grown, OR you've built the
  // Hydroponics whose greywater it recycles. (Electrolysis is a FOUNDING building, so
  // gating on it would open the reclaimer at sol 0 — defeating the "stretch what you
  // have" intent; the population/greenhouse gate keeps it a real progression step.)
  reclaimer: (s) =>
    s.population >= 6 || s.buildings.some((b) => b.defId === "greenhouse"),
  // the endgame branch opens after the nonterminal outpost milestone, leaving the
  // player a real choice: launch for another world before the full-sol automatic
  // victory, or keep proving this colony. Affordability remains the pod's own
  // 200-material placement cost; revealing the plan early gives the player the
  // proof-sol to gather toward it instead of hiding the destination behind cash.
  ptp: (s) =>
    s.settlementEstablished === true &&
    s.buildings.some((b) => b.defId === "reactor") &&
    s.population >= 12,
};

/** each gate, as the palette's locked tooltip says it ("unlocks with …") —
 *  kept beside the rules so the two change together */
export const GATE_HINTS: Record<string, string> = {
  windturbine: "sol 4, or a dust storm",
  geothermal: "sol 6",
  reactor: "8 colonists and 150 materials",
  printer: "6 colonists",
  roverbay: "sol 3, or 80 materials in stock",
  roboticsbay: "a reactor, or 10 colonists and 200 materials",
  awg: "sol 5, or 6 colonists",
  aquifer: "sol 8 (it must sit on an aquifer site)",
  reclaimer: "6 colonists, or a Hydroponics",
  bioprinter: "sol 6, or a Hydroponics",
  atomic: "a Fission Reactor",
  ptp: "the outpost proven, a reactor, and 12 colonists",
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
