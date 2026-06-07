/* ============================================================================
   Cross-run memory — the planet remembers how *this* player dies. A small
   persisted tally of which resource axis and which hazard tend to end runs; the
   Director leans its opening toward them. This is the genuine job for the
   deferred persistent model (doc §3.3): learning that survives a run. localStorage
   today; a Mongo adapter can drop in behind load/save later.
   ============================================================================ */
import type { HazardKind } from "@shared/types";

export type Axis = "power" | "oxygen" | "water" | "food";

export interface PlayerModel {
  runs: number;
  wins: number;
  deaths: number;
  /** which resource was going lethal at death */
  byAxis: Record<Axis, number>;
  /** which hazard was active/recent at death */
  byHazard: Record<HazardKind, number>;
  solsSum: number;
}

const KEY = "vivarium:director:v1";

export function emptyModel(): PlayerModel {
  return {
    runs: 0, wins: 0, deaths: 0, solsSum: 0,
    byAxis: { power: 0, oxygen: 0, water: 0, food: 0 },
    byHazard: { dust: 0, meteor: 0, flare: 0, coldsnap: 0, quake: 0 },
  };
}

export function loadModel(): PlayerModel {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyModel();
    return { ...emptyModel(), ...(JSON.parse(raw) as PlayerModel) };
  } catch {
    return emptyModel();
  }
}

export function saveModel(m: PlayerModel): void {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode */ }
}

export interface Outcome {
  won: boolean;
  lethalAxis?: Axis;
  recentHazard?: HazardKind;
  sols: number;
}

export function recordOutcome(m: PlayerModel, o: Outcome): void {
  m.runs++;
  m.solsSum += o.sols;
  if (o.won) { m.wins++; return; }
  m.deaths++;
  if (o.lethalAxis) m.byAxis[o.lethalAxis]++;
  if (o.recentHazard) m.byHazard[o.recentHazard]++;
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
