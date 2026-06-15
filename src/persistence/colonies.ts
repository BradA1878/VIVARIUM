/* ============================================================================
   The Colonies ledger (PTP) — a cross-run record of every world the player has
   settled, one row per save slot. This is META state on the main thread (the
   director/memory.ts pattern): plain JSON, versioned key, normalize-with-defaults,
   never a throw. It is NEVER engine state and never crosses into the tick — it
   only references the save slots the persistence layer holds (revisit = load that
   slot). Timestamps are stamped here on the main thread (the engine forbids Date).
   ============================================================================ */
import type { Difficulty, Outcome, ShipmentManifest } from "@shared/types";
import { SOL_LENGTH } from "@/engine/tuning";

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
  /** wall-clock (ms) the colony's save was last current — the catch-up reads it to
   *  compute how long the colony has been away (parallel-colonies Round 4). Stamped
   *  main-side on every upsert; falls back to foundedAt for pre-Round-4 rows. */
  savedAt?: number;
  legacy?: { veterans: number[]; tech?: string };
}

/** an inter-planet shipment in transit (parallel-colonies). Lives in the ledger
 *  (main-thread, spans colonies) — never engine state. `dispatchedAt` is wall-clock;
 *  it matures (and credits the destination on switch) after transitSols of sim-time. */
export interface Shipment {
  id: number;
  fromSlot: string;
  toSlot: string;
  manifest: ShipmentManifest;
  dispatchedAt: number; // wall-clock ms
  transitSols: number;
}

export interface Ledger {
  v: 1;
  colonies: ColonyRecord[];
  shipments: Shipment[];
}

export type LedgerStorage = Pick<Storage, "getItem" | "setItem">;

export const COLONIES_KEY = "vivarium:colonies:v1";

function emptyLedger(): Ledger {
  return { v: 1, colonies: [], shipments: [] };
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

/** a shipment is usable only if it can address both endpoints + carries a manifest */
function isShipment(x: unknown): x is Shipment {
  const s = x as Shipment;
  return !!x && typeof x === "object"
    && typeof s.id === "number" && typeof s.toSlot === "string" && typeof s.fromSlot === "string"
    && typeof s.dispatchedAt === "number" && typeof s.transitSols === "number" && !!s.manifest;
}

/** rebuild a valid Ledger from anything — corrupt JSON, an old version, partial
 *  rows. Never throws; the worst case is an empty ledger. */
function normalize(raw: unknown): Ledger {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const colonies = Array.isArray(o.colonies) ? o.colonies.filter(isRecord) : [];
  const shipments = Array.isArray(o.shipments) ? o.shipments.filter(isShipment) : [];
  return { v: 1, colonies, shipments };
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
  const next: Ledger = { ...ledger, colonies }; // preserve the shipment queue
  saveLedger(next, storage);
  return next;
}

/** forget a settled world's ledger row (pairs with persistence deleteSlot). */
export function removeColony(slotKey: string, storage?: LedgerStorage): Ledger {
  const ledger = loadLedger(storage);
  const next: Ledger = { ...ledger, colonies: ledger.colonies.filter((c) => c.slotKey !== slotKey) };
  saveLedger(next, storage);
  return next;
}

// ---- the inter-planet shipment queue (parallel-colonies) ----------------------

/** queue a shipment (id auto-assigned). Returns the new ledger. */
export function addShipment(s: Omit<Shipment, "id">, storage?: LedgerStorage): Ledger {
  const ledger = loadLedger(storage);
  const id = ledger.shipments.reduce((m, x) => Math.max(m, x.id), 0) + 1;
  const next: Ledger = { ...ledger, shipments: [...ledger.shipments, { ...s, id }] };
  saveLedger(next, storage);
  return next;
}

/** shipments to `toSlot` that have ARRIVED by wall-clock `now` (transitSols of sim-time
 *  elapsed since dispatch), sorted by id for deterministic, exactly-once crediting. */
export function maturedShipments(toSlot: string, now: number, storage?: LedgerStorage): Shipment[] {
  return loadLedger(storage).shipments
    .filter((s) => s.toSlot === toSlot && now >= s.dispatchedAt + s.transitSols * SOL_LENGTH * 1000)
    .sort((a, b) => a.id - b.id);
}

/** drop shipments by id (after crediting). Returns the new ledger. */
export function removeShipments(ids: number[], storage?: LedgerStorage): Ledger {
  const drop = new Set(ids);
  const ledger = loadLedger(storage);
  const next: Ledger = { ...ledger, shipments: ledger.shipments.filter((s) => !drop.has(s.id)) };
  saveLedger(next, storage);
  return next;
}

/** every in-flight shipment (for the Colonies-map in-transit display) */
export function shipmentsInTransit(storage?: LedgerStorage): Shipment[] {
  return loadLedger(storage).shipments;
}
