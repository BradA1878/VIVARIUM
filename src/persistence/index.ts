/* ============================================================================
   Persistence orchestration: Mongo when reachable, localStorage always as the
   cache/fallback (doc §5). Load prefers the networked save (cross-device), then
   the local one. Save writes both so an offline reload still resumes.

   Slot-aware (PTP): every call carries a slot id — one settled world per slot.
   listSlots / deleteSlot back the cross-run Colonies ledger (revisit / abandon).
   ============================================================================ */
import type { SaveData } from "@/engine";
import { saveLocal, loadLocal, clearLocal, listLocal } from "./local";
import { saveRemote, loadRemote, listRemote, deleteRemote } from "./remote";

/** the best available save for `slot`: networked first, then local */
export async function loadBest(slot: string): Promise<SaveData | null> {
  const remote = await loadRemote(slot);
  if (remote) return remote;
  return loadLocal(slot);
}

/** persist `slot` everywhere — Mongo (best effort) + localStorage (always) */
export async function persist(slot: string, save: SaveData): Promise<void> {
  saveLocal(slot, save); // synchronous, can't fail the caller
  await saveRemote(slot, save); // best effort; falls back silently
}

/** every known slot — the union of networked and local (the ledger's source of truth) */
export async function listSlots(): Promise<string[]> {
  const remote = await listRemote(); // [] when the server is down
  return [...new Set([...remote, ...listLocal()])];
}

/** forget a settled world — remove its slot from Mongo and localStorage */
export async function deleteSlot(slot: string): Promise<void> {
  clearLocal(slot);
  await deleteRemote(slot);
}

export { clearLocal };
