/* ============================================================================
   The colonist roster — names + roles as PURE derivations of the colonist id.
   No state, no RNG draws: hashing the stable id keeps both rng streams
   byte-identical, so determinism/replay/save are untouched.
   ============================================================================ */
import type { ColonistRole } from "@shared/types";
import type { ColonyState } from "./state";

/** id % 4 walks this list; seed colonists (ids 1-4) land miner/engineer/botanist/
 *  medic, so the starter extractor + electrolysis can be role-matched from sol 1. */
export const ROLES: ColonistRole[] = ["medic", "miner", "engineer", "botanist"];

export function roleOf(id: number): ColonistRole {
  return ROLES[id % 4];
}

const FIRST = [
  "Juno", "Ezra", "Mara", "Kai", "Vesper", "Orin", "Lyra", "Dax",
  "Selene", "Bram", "Wren", "Caspian", "Nova", "Idris", "Tamsin", "Soren",
  "Imara", "Pax", "Odessa", "Rook", "Calla", "Niko", "Astrid", "Faro",
];

const LAST = [
  "Voss", "Okafor", "Reyes", "Tanaka", "Lindqvist", "Achebe", "Marlowe",
  "Ferreira", "Novak", "Singh", "Calloway", "Eriksen", "Mbeki", "Aldrin",
  "Sato", "Petrova", "Stahl", "Quint", "Halloran", "Iwu",
];

/** deterministic "First Last" — the strides are coprime to the table lengths,
 *  so names repeat only every lcm(24,20) = 120 consecutive ids */
export function nameOf(id: number): string {
  return `${FIRST[(id * 7) % FIRST.length]} ${LAST[(id * 13) % LAST.length]}`;
}

/** the building each role works best in ("medbay" is forward-declared data —
 *  the building arrives in a later commit; unmatched until then) */
export const ROLE_BUILDING: Record<ColonistRole, string> = {
  miner: "extractor",
  engineer: "electrolysis",
  botanist: "greenhouse",
  medic: "medbay",
};

/** how many colonists assigned to building `uid` are working their own trade */
export function roleMatchCount(s: ColonyState, uid: number, defId: string): number {
  let n = 0;
  for (const c of s.colonists) {
    if (c.workUid === uid && ROLE_BUILDING[roleOf(c.id)] === defId) n += 1;
  }
  return n;
}
