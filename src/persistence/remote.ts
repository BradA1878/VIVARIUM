/* ============================================================================
   Remote (Mongo-backed) persistence via the Hono server. Networked save state
   across devices (doc §5). Every call degrades gracefully — a null/false/[] return
   means "use localStorage instead", so the game never blocks on the server.

   Slot-aware (PTP): the slot id selects which world's save to read/write. List +
   delete back the Colonies ledger (revisit / abandon a settled world).
   ============================================================================ */
import type { SaveData } from "@/engine";
import { toJSON, fromJSON, type SaveJSON } from "./save";

// The backend is optional (doc §1). When it isn't running, every autosave would
// otherwise hammer /api/save and spam the dev console with ECONNREFUSED. A simple
// circuit breaker backs off after a failure and only re-probes occasionally, so a
// missing server costs ~one request per cooldown instead of one every 12s.
const COOLDOWN_MS = 5 * 60_000;
let backoffUntil = 0;
const isDown = (): boolean => Date.now() < backoffUntil;
const trip = (): void => { backoffUntil = Date.now() + COOLDOWN_MS; };
const clear = (): void => { backoffUntil = 0; };

/** test-only: clear the module-level breaker so a negative-path test can't leak
 *  its tripped state into the next test (the breaker is shared module state). */
export function __resetBreaker(): void { backoffUntil = 0; }

/** push a save to Mongo under `slot`. Returns true on success, false to fall back to local. */
export async function saveRemote(slot: string, save: SaveData): Promise<boolean> {
  if (isDown()) return false;
  try {
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ slot, save: toJSON(save) }),
    });
    if (!res.ok) { trip(); return false; }
    clear();
    return true;
  } catch {
    trip();
    return false;
  }
}

/** load a save from Mongo by `slot`. Returns null if absent/unavailable. */
export async function loadRemote(slot: string): Promise<SaveData | null> {
  if (isDown()) return null;
  try {
    const res = await fetch(`/api/load?slot=${encodeURIComponent(slot)}`);
    if (!res.ok) { trip(); return null; }
    clear();
    const data = (await res.json()) as { save?: SaveJSON | null };
    return data.save ? fromJSON(data.save) : null;
  } catch {
    trip();
    return null;
  }
}

/** list the slots Mongo holds. Returns [] when absent/unavailable (client falls back to local). */
export async function listRemote(): Promise<string[]> {
  if (isDown()) return [];
  try {
    const res = await fetch("/api/saves");
    if (!res.ok) { trip(); return []; }
    clear();
    const data = (await res.json()) as { slots?: Array<{ slot?: string }> };
    return Array.isArray(data.slots)
      ? data.slots.map((s) => s.slot).filter((s): s is string => typeof s === "string")
      : [];
  } catch {
    trip();
    return [];
  }
}

/** delete a slot from Mongo. Returns true on success, false to fall back to local-only. */
export async function deleteRemote(slot: string): Promise<boolean> {
  if (isDown()) return false;
  try {
    const res = await fetch(`/api/save?slot=${encodeURIComponent(slot)}`, { method: "DELETE" });
    if (!res.ok) { trip(); return false; }
    clear();
    return true;
  } catch {
    trip();
    return false;
  }
}
