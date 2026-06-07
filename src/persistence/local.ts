/* ============================================================================
   localStorage adapter — the offline persistence floor (doc §5: "localStorage is
   genuinely sufficient for an Easter egg"). Also the fallback cache when Mongo
   is unreachable.
   ============================================================================ */
import type { SaveData } from "@/engine";
import { encode, decode } from "./save";

const KEY = "vivarium:save:v1";

export function saveLocal(save: SaveData): void {
  try {
    localStorage.setItem(KEY, encode(save));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

export function loadLocal(): SaveData | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? decode(text) : null;
  } catch {
    return null;
  }
}

export function clearLocal(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
