/* ============================================================================
   Run history — the PURE telemetry recorder behind the end-of-run report. The
   colony store feeds it from its existing bridge subscriptions; the EndScreen
   reads it back as sparkline curves and event tallies. Nothing here touches the
   tick — it only ever observes Snapshot/ColonyEvent (doc §0).

   Sampling: one RunSample every `interval` sim-seconds (starts at 2 s). When the
   buffer hits SAMPLE_CAP it drops the odd-index samples and doubles the interval
   (2 → 4 → 8 …), so a full 22-sol ≈ 3300 s campaign always fits in ≤600 points
   while the early curve keeps its shape.

   Persistence is storage-injectable with merge-with-defaults inside try/catch
   (the settings/memory.ts loadModel pattern) — vitest runs in plain Node, and
   the browser may be in private mode. No window access at import time.
   ============================================================================ */
import type { ColonyEvent, EventType, HazardKind, Snapshot } from "@shared/types";
import { HAZARD_KINDS } from "@shared/types";

/** one point on the run's resource curves */
export interface RunSample {
  t: number;
  sol: number;
  power: number;
  water: number;
  oxygen: number;
  food: number;
  pop: number;
}

export interface RunHistory {
  v: 1;
  /** sim-seconds between samples; doubles at every decimation (2 → 4 → 8 …) */
  interval: number;
  /** sim-time of the last sample taken */
  lastT: number;
  samples: RunSample[];
  /** whitelist tallies of the run's notable events */
  events: Partial<Record<EventType, number>>;
  /** hazard_start counts by kind */
  hazards: Partial<Record<HazardKind, number>>;
  /** hazards the Director threw this run (counted by the store, not an event) */
  directorStrikes: number;
}

export type HistoryStorage = Pick<Storage, "getItem" | "setItem">;

export const HISTORY_KEY = "vivarium:history:v1";
export const SAMPLE_CAP = 600;
const START_INTERVAL = 2;

/** the events worth tallying on the run report (hazard kinds split out below) */
const TALLIED: ReadonlySet<EventType> = new Set<EventType>([
  "casualty", "abducted", "birth", "building_destroyed", "brownout",
  "trade_done", "resupply", "arrival", "hazard_start",
]);

export function emptyHistory(): RunHistory {
  return {
    v: 1,
    interval: START_INTERVAL,
    lastT: 0,
    samples: [],
    events: {},
    hazards: {},
    directorStrikes: 0,
  };
}

// ---- recording (pure) ----------------------------------------------------------

/** sample the snapshot if a full interval has passed; decimate at the cap */
export function recordSnapshot(h: RunHistory, s: Snapshot): void {
  if (s.t - h.lastT < h.interval) return;
  h.lastT = s.t;
  h.samples.push({
    t: s.t,
    sol: s.sol,
    power: s.pools.power.amount,
    water: s.pools.water.amount,
    oxygen: s.pools.oxygen.amount,
    food: s.pools.food.amount,
    pop: s.population,
  });
  if (h.samples.length >= SAMPLE_CAP) {
    h.samples = h.samples.filter((_, i) => i % 2 === 0);
    h.interval *= 2;
  }
}

/** tally a whitelisted event (plus the hazard kind on hazard_start) */
export function recordEvent(h: RunHistory, e: ColonyEvent): void {
  if (!TALLIED.has(e.type)) return;
  h.events[e.type] = (h.events[e.type] ?? 0) + 1;
  if (e.type === "hazard_start" && e.kind) h.hazards[e.kind] = (h.hazards[e.kind] ?? 0) + 1;
}

// ---- persistence ----------------------------------------------------------------

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function sampleOf(raw: unknown): RunSample | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const keys = ["t", "sol", "power", "water", "oxygen", "food", "pop"] as const;
  const out = {} as Record<(typeof keys)[number], number>;
  for (const k of keys) {
    const v = o[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out[k] = v;
  }
  return out;
}

/** keep only finite, positive counts under known keys */
function tallyOf<K extends string>(raw: unknown, valid?: readonly K[]): Partial<Record<K, number>> {
  const out: Partial<Record<K, number>> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (valid && !(valid as readonly string[]).includes(k)) continue;
    if (typeof v === "number" && Number.isFinite(v) && v > 0) out[k as K] = v;
  }
  return out;
}

/** rebuild a full, valid RunHistory from anything (unknown JSON, an old version) */
function normalize(raw: unknown): RunHistory {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const samples = Array.isArray(o.samples)
    ? (o.samples as unknown[]).map(sampleOf).filter((s): s is RunSample => s !== null).slice(-SAMPLE_CAP)
    : [];
  return {
    v: 1,
    interval: Math.max(START_INTERVAL, num(o.interval, START_INTERVAL)),
    lastT: num(o.lastT, 0),
    samples,
    events: tallyOf<EventType>(o.events, [...TALLIED]),
    hazards: tallyOf<HazardKind>(o.hazards, HAZARD_KINDS),
    directorStrikes: Math.max(0, num(o.directorStrikes, 0)),
  };
}

/** the browser's localStorage when it exists and is reachable, else null (Node) */
function defaultStorage(): HistoryStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadHistory(storage?: HistoryStorage): RunHistory {
  try {
    const st = storage ?? defaultStorage();
    const raw = st?.getItem(HISTORY_KEY);
    if (!raw) return normalize(null);
    return normalize(JSON.parse(raw));
  } catch {
    return normalize(null); // corrupt JSON / private mode / no storage — a fresh run
  }
}

export function saveHistory(h: RunHistory, storage?: HistoryStorage): void {
  try {
    const st = storage ?? defaultStorage();
    st?.setItem(HISTORY_KEY, JSON.stringify(h));
  } catch {
    /* private mode / quota — non-fatal, the in-memory record still rules */
  }
}

/** a fresh history for a fresh run, persisted immediately (new-run / reset) */
export function resetHistory(storage?: HistoryStorage): RunHistory {
  const h = emptyHistory();
  saveHistory(h, storage);
  return h;
}
