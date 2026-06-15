/* ============================================================================
   The Colonies ledger (PTP) — a cross-run record of every world the player has
   settled, one row per save slot. This is META state on the main thread (the
   director/memory.ts pattern): plain JSON, versioned key, normalize-with-defaults,
   never a throw. It is NEVER engine state and never crosses into the tick — it
   only references the save slots the persistence layer holds (revisit = load that
   slot). Timestamps are stamped here on the main thread (the engine forbids Date).
   ============================================================================ */
import type { Difficulty, Outcome } from "@shared/types";

/** one settled world. `slotKey` is the persistence slot (loadBest(slotKey) revisits it). */
export interface ColonyRecord {
  worldId: string;
  slotKey: string;
  seed: number;
  difficulty: Difficulty;
  label: string;
  outcome: Outcome;
  sols: number;
  population: number;
  foundedAt: number;
  endedAt?: number;
  legacy?: { veterans: number[]; tech?: string };
}

export interface Ledger {
  v: 1;
  colonies: ColonyRecord[];
}

export type LedgerStorage = Pick<Storage, "getItem" | "setItem">;

export const COLONIES_KEY = "vivarium:colonies:v1";

function emptyLedger(): Ledger {
  return { v: 1, colonies: [] };
}

/** the browser's localStorage when reachable, else null (node, SSR) */
function defaultStorage(): LedgerStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** a record is usable only if it can address its slot — anything without a string
 *  slotKey is dropped rather than risk a ledger row that points nowhere. */
function isRecord(x: unknown): x is ColonyRecord {
  return !!x && typeof x === "object" && typeof (x as ColonyRecord).slotKey === "string";
}

/** rebuild a valid Ledger from anything — corrupt JSON, an old version, partial
 *  rows. Never throws; the worst case is an empty ledger. */
function normalize(raw: unknown): Ledger {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const colonies = Array.isArray(o.colonies) ? o.colonies.filter(isRecord) : [];
  return { v: 1, colonies };
}

export function loadLedger(storage?: LedgerStorage): Ledger {
  try {
    const st = storage ?? defaultStorage();
    const raw = st?.getItem(COLONIES_KEY);
    if (!raw) return emptyLedger();
    return normalize(JSON.parse(raw));
  } catch {
    return emptyLedger();
  }
}

function saveLedger(ledger: Ledger, storage?: LedgerStorage): void {
  try {
    const st = storage ?? defaultStorage();
    st?.setItem(COLONIES_KEY, JSON.stringify(ledger));
  } catch {
    /* private mode / quota — the in-memory ledger still rules this session */
  }
}

/** insert or replace a colony, keyed by slotKey (a re-launch of the same world
 *  updates its row rather than duplicating it). Returns the new ledger. */
export function upsertColony(rec: ColonyRecord, storage?: LedgerStorage): Ledger {
  const ledger = loadLedger(storage);
  const colonies = ledger.colonies.filter((c) => c.slotKey !== rec.slotKey);
  colonies.push(rec);
  const next: Ledger = { v: 1, colonies };
  saveLedger(next, storage);
  return next;
}

/** forget a settled world's ledger row (pairs with persistence deleteSlot). */
export function removeColony(slotKey: string, storage?: LedgerStorage): Ledger {
  const ledger = loadLedger(storage);
  const next: Ledger = { v: 1, colonies: ledger.colonies.filter((c) => c.slotKey !== slotKey) };
  saveLedger(next, storage);
  return next;
}
