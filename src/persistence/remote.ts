/* ============================================================================
   Remote (Mongo-backed) persistence via the Hono server. Networked save state
   across devices (doc §5). Every call degrades gracefully — a null/false return
   means "use localStorage instead", so the game never blocks on the server.
   ============================================================================ */
import type { SaveData } from "@/engine";
import { toJSON, fromJSON, type SaveJSON } from "./save";

const SLOT = "default";

/** push a save to Mongo. Returns true on success, false to fall back to local. */
export async function saveRemote(save: SaveData): Promise<boolean> {
  try {
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot: SLOT, save: toJSON(save) }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** load a save from Mongo. Returns null if absent/unavailable. */
export async function loadRemote(): Promise<SaveData | null> {
  try {
    const res = await fetch(`/api/load?slot=${encodeURIComponent(SLOT)}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { save?: SaveJSON | null };
    return data.save ? fromJSON(data.save) : null;
  } catch {
    return null;
  }
}
