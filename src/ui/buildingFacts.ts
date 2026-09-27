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
import { ROLE_BONUS } from "@/engine/tuning";

/** the role bonus as the card says it, from the engine's own tuning */
const BONUS_PCT = `${Math.round(ROLE_BONUS * 100)}%`;

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
  if (hasOutput(def)) return `${/^[aeiou]/.test(role) ? "an" : "a"} ${role} makes ${BONUS_PCT} more`;
  if (def.id === "medbay") return "a medic heals faster";
  return null;
}

export interface BuildingFacts {
  makes: string[];
  uses: string[];
  needs: string[];
}

/** what a building def makes, uses, and needs, as plain-language lines for
 *  the building card and the palette tooltip. Pure — reads only the def, plus
 *  `solarScale`, the world's sunlight multiplier (1 on Mars). */
export function buildingFacts(def: BuildingDef, solarScale = 1): BuildingFacts {
  const makes: string[] = [];
  for (const [res, n] of Object.entries(def.produces) as [string, number][]) {
    makes.push(`${fmtNum(n)} ${res}/s`);
  }
  if (def.producesMat !== undefined) makes.push(`${fmtNum(def.producesMat)} materials/s`);
  if (def.solar !== undefined) makes.push(`up to ${fmtNum(def.solar * solarScale)} power/s in full sun`);
  if (def.wind !== undefined) makes.push(`up to ${fmtNum(def.wind)} power/s in full wind`);
  if (def.steady !== undefined) makes.push(`${fmtNum(def.steady)} power/s, day and night`);
  if (def.printsLowest) {
    const { oxygen, water, food, materials } = def.printsLowest;
    makes.push(
      `whichever is lowest: ${fmtNum(oxygen)} oxygen/s, ${fmtNum(water)} water/s, ${fmtNum(food)} food/s, or ${fmtNum(materials)} materials/s`,
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
  // a habitat's beds count with or without the seal; the seal makes it a shelter
  if (def.requiresPressure) needs.push(def.popCap ? "the pressure seal, to shelter the crew" : "the pressure seal");
  if (def.needsVent) needs.push("a vent");
  if (def.needsAquifer) needs.push("an aquifer site");

  return { makes, uses, needs };
}

/** a generator's live output (power/s), or null for anything that is not one */
function generatorOutput(def: BuildingDef, snap: Snapshot): number | null {
  if (def.solar !== undefined) return def.solar * snap.solarMul;
  if (def.wind !== undefined) return def.wind * snap.windLevel;
  if (def.steady !== undefined) return def.steady;
  return null;
}

/** the building card's badge text: the off reason's label; "WORKING" for a
 *  building with a crew or power setting that ran; "TURNING ON" for one just
 *  switched back on that has not run yet (a paused game); else null — the
 *  hub, corridors, habitats, storage, and generators (whose status is their
 *  output) show no label */
export function statusLabel(b: BuildingState): string | null {
  if (b.offReason) return OFF_REASON_LABEL[b.offReason];
  const def = DEFS[b.defId];
  if (!def || modesFor(def).length === 0) return null;
  return b.online ? "WORKING" : "TURNING ON";
}

/** the fixed explanation for each off reason; `crew` is the only one that
 *  reads the snapshot (how many colonists are free right now) */
function offReasonLine(reason: OffReason, snap: Snapshot): string {
  switch (reason) {
    case "crew": return snap.labor > 0
      ? `no free colonist (${fmtNum(snap.laborUsed)} of ${fmtNum(snap.labor)} busy)`
      : "no colonist free to work (hurt, piloted, or out gathering)";
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

/** the building card's status line: the off reason's explanation; a
 *  generator's live output; for a building with a setting, who is posted
 *  there (with the trade bonus when their role matches and the def makes
 *  something) or that it turns on when the colony runs; else null */
export function statusLine(b: BuildingState, snap: Snapshot): string | null {
  if (b.offReason) return offReasonLine(b.offReason, snap);
  const def = DEFS[b.defId];
  if (!def) return null;
  const output = generatorOutput(def, snap);
  if (output !== null) return `making ${fmtNum(output)} power/s now`;
  const label = statusLabel(b);
  if (label === null) return null;
  if (label === "TURNING ON") return "turns on when the colony runs";

  if (def.staffing > 0) {
    const worker = snap.colonists.find((c) => c.workUid === b.uid);
    if (worker) {
      const bonus = BUILDING_ROLE[def.id] === worker.role && hasOutput(def) ? `, +${BONUS_PCT}` : "";
      return `working · ${worker.name}, ${worker.role}${bonus}`;
    }
  }
  return "working";
}
