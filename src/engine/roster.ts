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

/** the trade each staffed building wants on its slots (defId → role). A role
 *  can match several buildings — the engineer's trade covers electrolysis AND
 *  the reactor (the Robotics Bay joins in a later commit). Unmapped defIds
 *  simply never match. */
export const BUILDING_ROLE: Record<string, ColonistRole> = {
  extractor: "miner",
  electrolysis: "engineer",
  reactor: "engineer",
  greenhouse: "botanist",
  medbay: "medic",
};

/** how many colonists assigned to building `uid` are working their own trade
 *  (the injured are off shift and never count) */
export function roleMatchCount(s: ColonyState, uid: number, defId: string): number {
  let n = 0;
  for (const c of s.colonists) {
    if (c.injury > 0) continue;
    if (c.workUid === uid && BUILDING_ROLE[defId] === roleOf(c.id)) n += 1;
  }
  return n;
}
