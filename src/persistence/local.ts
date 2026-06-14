/* ============================================================================
   localStorage adapter — the offline persistence floor (doc §5: "localStorage is
   genuinely sufficient for an Easter egg"). Also the fallback cache when Mongo
   is unreachable.

   Slot-aware (PTP): each settled world persists under its own key. The default
   slot keeps the legacy unsuffixed key so saves from before planet-hopping
   survive untouched. Storage is injectable (the settings.ts pattern) so the
   adapter is testable in plain node, where there is no localStorage.
   ============================================================================ */
import type { SaveData } from "@/engine";
import { encode, decode } from "./save";

export type PersistStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const PREFIX = "vivarium:save:v1";
const INDEX_KEY = `${PREFIX}:index`;
/** the default slot keeps the legacy unsuffixed key — existing saves survive */
const keyFor = (slot: string): string => (slot === "default" ? PREFIX : `${PREFIX}:${slot}`);

/** the browser's localStorage when it exists and is reachable, else null (node, SSR) */
function defaultStorage(): PersistStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** the set of known slots. A legacy default save predates the index, so surface
 *  it whenever the unsuffixed key is present. */
function readIndex(st: PersistStorage): string[] {
  try {
    const raw = st.getItem(INDEX_KEY);
    const arr = raw ? (JSON.parse(raw) as unknown) : [];
    const list = Array.isArray(arr) ? arr.filter((x): x is string => typeof x === "string") : [];
    if (st.getItem(PREFIX) && !list.includes("default")) list.push("default");
    return list;
  } catch {
    return [];
  }
}

function writeIndex(st: PersistStorage, slots: string[]): void {
  try {
    st.setItem(INDEX_KEY, JSON.stringify([...new Set(slots)]));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

export function saveLocal(slot: string, save: SaveData, storage?: PersistStorage): void {
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    st.setItem(keyFor(slot), encode(save));
    writeIndex(st, [...readIndex(st), slot]);
  } catch {
    /* quota / private mode — non-fatal */
  }
}

export function loadLocal(slot: string, storage?: PersistStorage): SaveData | null {
  const st = storage ?? defaultStorage();
  if (!st) return null;
  try {
    const text = st.getItem(keyFor(slot));
    return text ? decode(text) : null;
  } catch {
    return null;
  }
}

export function clearLocal(slot: string, storage?: PersistStorage): void {
  const st = storage ?? defaultStorage();
  if (!st) return;
  try {
    st.removeItem(keyFor(slot));
    writeIndex(st, readIndex(st).filter((s) => s !== slot));
  } catch {
    /* ignore */
  }
}

export function listLocal(storage?: PersistStorage): string[] {
  const st = storage ?? defaultStorage();
  return st ? readIndex(st) : [];
}
