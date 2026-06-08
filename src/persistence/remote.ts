/* ============================================================================
   Remote (Mongo-backed) persistence via the Hono server. Networked save state
   across devices (doc §5). Every call degrades gracefully — a null/false return
   means "use localStorage instead", so the game never blocks on the server.
   ============================================================================ */
import type { SaveData } from "@/engine";
import { toJSON, fromJSON, type SaveJSON } from "./save";

const SLOT = "default";

// The backend is optional (doc §1). When it isn't running, every autosave would
// otherwise hammer /api/save and spam the dev console with ECONNREFUSED. A simple
// circuit breaker backs off after a failure and only re-probes occasionally, so a
// missing server costs ~one request per cooldown instead of one every 12s.
const COOLDOWN_MS = 5 * 60_000;
let backoffUntil = 0;
const isDown = (): boolean => Date.now() < backoffUntil;
const trip = (): void => { backoffUntil = Date.now() + COOLDOWN_MS; };
const clear = (): void => { backoffUntil = 0; };

/** push a save to Mongo. Returns true on success, false to fall back to local. */
export async function saveRemote(save: SaveData): Promise<boolean> {
  if (isDown()) return false;
  try {
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot: SLOT, save: toJSON(save) }),
    });
    if (!res.ok) { trip(); return false; }
    clear();
    return true;
  } catch {
    trip();
    return false;
  }
}

/** load a save from Mongo. Returns null if absent/unavailable. */
export async function loadRemote(): Promise<SaveData | null> {
  if (isDown()) return null;
  try {
    const res = await fetch(`/api/load?slot=${encodeURIComponent(SLOT)}`);
    if (!res.ok) { trip(); return null; }
    clear();
    const data = (await res.json()) as { save?: SaveJSON | null };
    return data.save ? fromJSON(data.save) : null;
  } catch {
    trip();
    return null;
  }
}
