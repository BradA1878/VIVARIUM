/* ============================================================================
   Persistence orchestration: Mongo when reachable, localStorage always as the
   cache/fallback (doc §5). Load prefers the networked save (cross-device), then
   the local one. Save writes both so an offline reload still resumes.
   ============================================================================ */
import type { SaveData } from "@/engine";
import { saveLocal, loadLocal, clearLocal } from "./local";
import { saveRemote, loadRemote } from "./remote";

/** the best available save: networked first, then local */
export async function loadBest(): Promise<SaveData | null> {
  const remote = await loadRemote();
  if (remote) return remote;
  return loadLocal();
}

/** persist everywhere — Mongo (best effort) + localStorage (always) */
export async function persist(save: SaveData): Promise<void> {
  saveLocal(save); // synchronous, can't fail the caller
  await saveRemote(save); // best effort; falls back silently
}

export { clearLocal };
