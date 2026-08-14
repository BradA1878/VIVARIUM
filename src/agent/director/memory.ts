/* ============================================================================
   Cross-run memory — the planet remembers how *this* player dies. A small
   persisted tally of which resource axis and which hazard tend to end runs; the
   Director leans its opening toward them. This is the genuine job for the
   deferred persistent model (doc §3.3): learning that survives a run. localStorage
   today; a Mongo adapter can drop in behind load/save later.
   ============================================================================ */
import type { DefeatCause, HazardKind } from "@shared/types";

export type Axis = "power" | "oxygen" | "water" | "food";

export interface PlayerModel {
  runs: number;
  wins: number;
  deaths: number;
  /** exact resource cause of a lost run (v2 data only) */
  byAxis: Record<Axis, number>;
  /** exact direct-impact cause of a lost run (v2 data only) */
  byHazard: Record<HazardKind, number>;
  solsSum: number;
}

export type PlayerModelStorage = Pick<Storage, "getItem" | "setItem">;

export const PLAYER_MODEL_KEY = "vivarium:director:v2";
export const LEGACY_PLAYER_MODEL_KEY = "vivarium:director:v1";

export function emptyModel(): PlayerModel {
  return {
    runs: 0, wins: 0, deaths: 0, solsSum: 0,
    byAxis: { power: 0, oxygen: 0, water: 0, food: 0 },
    byHazard: { dust: 0, meteor: 0, flare: 0, coldsnap: 0, quake: 0 },
  };
}

function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

function modelOf(raw: unknown, keepAttribution: boolean): PlayerModel {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out = emptyModel();
  out.runs = count(value.runs);
  out.wins = Math.min(out.runs, count(value.wins));
  out.deaths = Math.min(out.runs, count(value.deaths));
  out.solsSum = typeof value.solsSum === "number" && Number.isFinite(value.solsSum)
    ? Math.max(0, value.solsSum)
    : 0;
  if (!keepAttribution) return out;

  const axes = (value.byAxis && typeof value.byAxis === "object"
    ? value.byAxis : {}) as Record<string, unknown>;
  for (const key of Object.keys(out.byAxis) as Axis[]) {
    out.byAxis[key] = Math.min(out.deaths, count(axes[key]));
  }
  const hazards = (value.byHazard && typeof value.byHazard === "object"
    ? value.byHazard : {}) as Record<string, unknown>;
  for (const key of Object.keys(out.byHazard) as HazardKind[]) {
    out.byHazard[key] = Math.min(out.deaths, count(hazards[key]));
  }
  return out;
}

function defaultStorage(): PlayerModelStorage | null {
  try { return typeof localStorage === "undefined" ? null : localStorage; }
  catch { return null; }
}

export function loadModel(storage?: PlayerModelStorage): PlayerModel {
  try {
    const target = storage ?? defaultStorage();
    if (!target) return emptyModel();
    const current = target.getItem(PLAYER_MODEL_KEY);
    if (current) {
      try { return modelOf(JSON.parse(current), true); }
      catch { /* corrupt v2: try the legacy totals before starting fresh */ }
    }

    // v1 called the most recent warning a cause. Preserve honest run totals,
    // but discard those unverifiable breakdowns before labeling v2 as exact.
    const legacy = target.getItem(LEGACY_PLAYER_MODEL_KEY);
    if (!legacy) return emptyModel();
    let migrated: PlayerModel;
    try { migrated = modelOf(JSON.parse(legacy), false); }
    catch { return emptyModel(); }
    try { target.setItem(PLAYER_MODEL_KEY, JSON.stringify(migrated)); }
    catch { /* read-only/quota-limited storage: keep the in-memory migration */ }
    return migrated;
  } catch {
    return emptyModel();
  }
}

export function saveModel(m: PlayerModel, storage?: PlayerModelStorage): void {
  try { (storage ?? defaultStorage())?.setItem(PLAYER_MODEL_KEY, JSON.stringify(modelOf(m, true))); }
  catch { /* private mode */ }
}

export interface Outcome {
  won: boolean;
  /** exact terminal cause from the engine; absent only for legacy/unknown runs */
  cause?: DefeatCause;
  sols: number;
}

export function recordOutcome(m: PlayerModel, o: Outcome): void {
  m.runs++;
  m.solsSum += o.sols;
  if (o.won) { m.wins++; return; }
  m.deaths++;
  if (o.cause?.type === "resource") m.byAxis[o.cause.resource]++;
  if (o.cause?.type === "strike") m.byHazard[o.cause.hazard]++;
}

/** which hazards press which axis */
const AXIS_HAZARDS: Record<Axis, HazardKind[]> = {
  power: ["flare", "coldsnap", "dust"],
  oxygen: ["meteor", "quake"],
  water: ["meteor", "quake"],
  food: ["meteor", "quake"],
};

/** per-hazard opening bias (1 = neutral) — leans toward how this player dies */
export function openingBias(m: PlayerModel): Record<HazardKind, number> {
  const out: Record<HazardKind, number> = { dust: 1, meteor: 1, flare: 1, coldsnap: 1, quake: 1 };
  if (m.deaths < 1) return out;
  for (const axis of Object.keys(m.byAxis) as Axis[]) {
    const frac = m.byAxis[axis] / m.deaths;
    for (const h of AXIS_HAZARDS[axis]) out[h] += frac * 0.8;
  }
  for (const h of Object.keys(m.byHazard) as HazardKind[]) {
    out[h] += (m.byHazard[h] / m.deaths) * 0.6;
  }
  return out;
}
