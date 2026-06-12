/* ============================================================================
   The commander — a pure derivation of the snapshot, shared by the store (the
   F possession chain), the PilotBar (the CMDR tag + board hint), and the
   renderer (the amber suit). The leader is simply the lowest LIVING colonist
   id: deterministic, and succession is automatic — when the leader dies or is
   abducted, the next-lowest id is already in command on the very next
   snapshot. No engine state, no randomness, no storage.
   ============================================================================ */
import type { RoverView, Snapshot } from "@shared/types";
import { FUNC_THRESHOLD } from "@/engine";

/** how close (grid cells) a functional rover must be for the leader to board it */
export const MOUNT_RADIUS = 1.8;

/** the commander = the lowest living colonist id, or null when no one is left */
export function leaderId(snap: Snapshot): number | null {
  let best: number | null = null;
  for (const c of snap.colonists) if (best === null || c.id < best) best = c.id;
  return best;
}

/** the rover the commander could board right now: functional (integrity ≥ the
 *  engine's drive threshold) and within MOUNT_RADIUS of the leader. Nearest
 *  wins; ties go to the lower id (same convention as possessNearest). */
export function boardableRover(snap: Snapshot): RoverView | null {
  const lid = leaderId(snap);
  if (lid == null) return null;
  const lead = snap.colonists.find((c) => c.id === lid);
  if (!lead) return null;
  let best: RoverView | null = null;
  let bestD = Infinity;
  for (const r of snap.rovers) {
    if (r.integrity < FUNC_THRESHOLD) continue;
    const d = Math.hypot(r.x - lead.x, r.y - lead.y);
    if (d > MOUNT_RADIUS) continue;
    if (d < bestD || (d === bestD && best !== null && r.id < best.id)) {
      bestD = d;
      best = r;
    }
  }
  return best;
}
