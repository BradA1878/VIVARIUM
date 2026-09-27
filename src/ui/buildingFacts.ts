/* ============================================================================
   Building facts and status text — pure text derived from a BuildingDef and,
   for status, a live BuildingState + Snapshot. Feeds the building card UI;
   this file only turns game data into plain-language lines, it renders
   nothing itself.
   ============================================================================ */
import type { BuildingDef, BuildingState, OffReason, Snapshot } from "@shared/types";
import { OFF_REASON_LABEL } from "@shared/offReason";
import { DEFS, modesFor } from "@/engine";
import { BUILDING_ROLE } from "@/engine/roster";

/** `n` with up to two decimals, trailing zeros dropped: 5, 0.4, 0.35. */
function fmtNum(n: number): string {
  return String(parseFloat(n.toFixed(2)));
}

/** true when the def makes something a matching trade could speed up (a
 *  recipe output or the printer's materials trickle) */
function hasOutput(def: BuildingDef): boolean {
  return Object.keys(def.produces).length > 0 || def.producesMat !== undefined;
}

/** the line that follows "<n> crew" for a def with a matching trade: the
 *  bonus note for anything that makes something, the med-bay's own note (it
 *  makes nothing but heals faster), or nothing for the rest */
function roleNote(def: BuildingDef): string | null {
  const role = BUILDING_ROLE[def.id];
  if (!role) return null;
  if (hasOutput(def)) return `a ${role} makes 25% more`;
  if (def.id === "medbay") return "a medic heals faster";
  return null;
}

export interface BuildingFacts {
  makes: string[];
  uses: string[];
  needs: string[];
}

/** what a building def makes, uses, and needs, as plain-language lines for
 *  the building card. Pure — reads only the def. */
export function buildingFacts(def: BuildingDef): BuildingFacts {
  const makes: string[] = [];
  for (const [res, n] of Object.entries(def.produces) as [string, number][]) {
    makes.push(`${fmtNum(n)} ${res}/s`);
  }
  if (def.producesMat !== undefined) makes.push(`${fmtNum(def.producesMat)} materials/s`);
  if (def.solar !== undefined) makes.push(`up to ${fmtNum(def.solar)} power/s in full sun`);
  if (def.wind !== undefined) makes.push(`up to ${fmtNum(def.wind)} power/s in full wind`);
  if (def.steady !== undefined) makes.push(`${fmtNum(def.steady)} power/s, day and night`);
  if (def.printsLowest) {
    const { oxygen, water, food, materials } = def.printsLowest;
    makes.push(
      `the lowest of ${fmtNum(oxygen)} oxygen/s, ${fmtNum(water)} water/s, ${fmtNum(food)} food/s, or ${fmtNum(materials)} materials/s`,
    );
  }
  for (const [res, n] of Object.entries(def.caps ?? {}) as [string, number][]) {
    makes.push(`stores ${fmtNum(n)} ${res}`);
  }
  if (def.popCap !== undefined) makes.push(`beds for ${fmtNum(def.popCap)}`);
  if (def.reclaim) {
    const { frac, max } = def.reclaim;
    makes.push(`returns ${fmtNum(frac * 100)}% of the water the colony uses, up to ${fmtNum(max)}/s`);
  }

  const uses: string[] = [];
  for (const [res, n] of Object.entries(def.consumes) as [string, number][]) {
    uses.push(`${fmtNum(n)} ${res}/s`);
  }

  const needs: string[] = [];
  if (def.staffing > 0) {
    needs.push(`${fmtNum(def.staffing)} crew`);
    const note = roleNote(def);
    if (note) needs.push(note);
  }
  if (def.requiresPressure) needs.push("the pressure seal");
  if (def.needsVent) needs.push("a vent");
  if (def.needsAquifer) needs.push("an aquifer site");

  return { makes, uses, needs };
}

/** the building card's badge text: the off reason's label, "WORKING" for
 *  anything that runs a crew/power mode or generates power, else null — plain
 *  storage (batteries, tanks, cisterns) has no status to show */
export function statusLabel(b: BuildingState): string | null {
  if (b.offReason) return OFF_REASON_LABEL[b.offReason];
  const def = DEFS[b.defId];
  if (!def) return null;
  const generates = def.solar !== undefined || def.wind !== undefined || def.steady !== undefined;
  return modesFor(def).length > 0 || generates ? "WORKING" : null;
}

/** the fixed explanation for each off reason; `crew` is the only one that
 *  reads the snapshot (how many colonists are free right now) */
function offReasonLine(reason: OffReason, snap: Snapshot): string {
  switch (reason) {
    case "crew": return `no free colonist (${fmtNum(snap.laborUsed)} of ${fmtNum(snap.labor)} busy)`;
    case "power": return "not enough power";
    case "seal": return "cut off from the pressure network";
    case "damaged": return "damaged · repairs itself over time";
    case "faulted": return "flare fault · electronics recovering";
    case "water": return "out of water";
    case "oxygen": return "out of oxygen";
    case "food": return "out of food";
    case "off": return "switched off";
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

/** the building card's status line: null wherever statusLabel is null, the
 *  off reason's explanation, or who is posted there (with the trade bonus
 *  when their role matches and the def makes something) */
export function statusLine(b: BuildingState, snap: Snapshot): string | null {
  if (statusLabel(b) === null) return null;
  if (b.offReason) return offReasonLine(b.offReason, snap);

  const def = DEFS[b.defId];
  if (def && def.staffing > 0) {
    const worker = snap.colonists.find((c) => c.workUid === b.uid);
    if (worker) {
      const bonus = BUILDING_ROLE[def.id] === worker.role && hasOutput(def) ? ", +25%" : "";
      return `working · ${worker.name}, ${worker.role}${bonus}`;
    }
  }
  return "working";
}
