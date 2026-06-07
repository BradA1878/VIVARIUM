/* ============================================================================
   Internal colony state — the engine's private working set. The serializable
   view the rest of the app sees is Snapshot (shared/types); this carries the
   extra bookkeeping (storm schedule, arrival timers, brownout latch, uid
   counter) the tick needs but the UI doesn't.
   ============================================================================ */
import type { BuildingState, HazardKind, HazardPhase, Outcome, Pool, Resource, Side, Weather } from "@shared/types";

/** a live hazard with the bookkeeping the tick needs (the HUD sees HazardView) */
export interface HazardInstance {
  kind: HazardKind;
  phase: HazardPhase;
  /** seconds left in the current phase */
  tLeft: number;
  /** active-phase duration (for HUD remaining + scheduling) */
  activeDur: number;
  intensity: number;
  /** per-kind cadence timer (meteor strikes, quake jolts) */
  cadence: number;
}

export interface ColonyState {
  N: number;
  /** N*N occupancy grid; cell = building uid, 0 = empty (typed array, doc §1) */
  grid: Int32Array;
  buildings: BuildingState[];
  pools: Record<Resource, Pool>;
  flow: Record<Resource, number>;

  population: number;
  housing: number;
  labor: number;
  laborUsed: number;

  sol: number;
  tod: number;
  solLength: number;

  weather: Weather;
  solarMul: number;
  /** live hazards (telegraph + active) */
  hazards: HazardInstance[];
  /** seconds to the next auto-scheduled hazard (ignored when director-controlled) */
  nextHazard: number;
  /** an external Director is driving hazards → the engine scheduler stands down */
  directorControlled: boolean;

  timers: Record<"oxygen" | "water" | "food", number | null>;
  grace: number;
  dead: number;

  // campaign (doc §2.5)
  deadlineSol: number;
  targetPop: number;
  selfSufficientFor: number;
  selfSufficiencyGoal: number;
  outcome: Outcome;
  outcomeReason: string;

  arrivalsLeft: number;
  nextArrival: number;

  /** Earth resupply windows — implemented in Phase 6 (doc §2.5). */
  nextResupply: number;
  resupplyT: number;

  paused: boolean;
  speed: number;

  t: number;
  started: boolean;

  /** next building uid to assign */
  uidCounter: number;
  /** brownout latch — kept on state so it serializes with the colony */
  brownLatch: boolean;
}

/** Save payload: state plus the RNG seed/state for a bit-identical resume. */
export interface SaveData {
  version: 1;
  seed: number;
  rngState: number;
  state: ColonyState;
}

export function emptyBuilding(
  uid: number,
  defId: string,
  gx: number,
  gy: number,
  rot: Side = 0,
): BuildingState {
  return {
    uid, defId, gx, gy, rot,
    online: false, connected: false, staffed: false, fed: false, util: 0,
    integrity: 1, faulted: 0,
  };
}
