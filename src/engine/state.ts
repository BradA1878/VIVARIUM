/* ============================================================================
   Internal colony state — the engine's private working set. The serializable
   view the rest of the app sees is Snapshot (shared/types); this carries the
   extra bookkeeping (storm schedule, arrival timers, brownout latch, uid
   counter) the tick needs but the UI doesn't.
   ============================================================================ */
import type {
  BuildingState, ColonistAct, DepositKind, Difficulty, HazardKind, HazardPhase,
  Outcome, Pool, Resource, Side, TradeGive, TradePhase, UfoPhase, Weather,
} from "@shared/types";

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

/** a colonist on the surface (the renderer sees ColonistView). Continuous coords;
 *  movement is deterministic — possessed integrates moveIntent, the rest follow AI. */
export interface ColonistInstance {
  id: number;
  x: number;
  y: number;
  facing: number;
  state: ColonistAct;
  carryKind: DepositKind | null;
  carryAmt: number;
  /** base-seconds of recovery remaining; 0 = healthy (engine/injury.ts) */
  injury: number;
  /** building uid this colonist is assigned to staff, or null */
  workUid: number | null;
  /** hab uid this colonist shelters in, or null */
  homeUid: number | null;
  /** the deposit this colonist has claimed to gather, or null (engine/gather.ts) */
  gatherDepositId: number | null;
  /** seconds spent mining at the claimed node so far (the dwell timer) */
  gatherT: number;
}

/** a drivable rover (the renderer sees RoverView) — a separate possessable
 *  entity, not a colonist buff. Its id draws from colonistCounter so the
 *  existing possess protocol addresses either species without a new command. */
export interface RoverInstance {
  id: number;
  x: number;
  y: number;
  facing: number;
  /** multi-kind cargo bays, capped at ROVER_CARGO_CAP across all kinds */
  cargo: Partial<Record<DepositKind, number>>;
  /** 0..1 — strikes dent it, it self-repairs, and it is never destroyed */
  integrity: number;
}

/** a surface resource node */
export interface DepositInstance {
  id: number;
  gx: number;
  gy: number;
  kind: DepositKind;
  amount: number;
  max: number;
}

/** a geothermal vent — static world-gen terrain (the HUD sees VentView).
 *  Seeded once, never depletes, never moves. */
export interface VentInstance {
  id: number;
  gx: number;
  gy: number;
}

/** a live alien trade offer */
export interface TradeInstance {
  id: number;
  phase: TradePhase;
  give: TradeGive;
  take: { res: Resource | "materials"; amount: number };
  /** seconds left in the current phase */
  tLeft: number;
  gx: number;
  gy: number;
}

/** a live hostile UFO — the abductor. Lifecycle mirrors the trader's, but it
 *  takes a colonist (the renderer sees UfoView). */
export interface UfoInstance {
  id: number;
  phase: UfoPhase;
  /** seconds left in the current phase */
  tLeft: number;
  /** the colonist id the beam is locked onto, or null once the target is lost */
  targetId: number | null;
  /** last-known cell of the target — updated each tick while it exists */
  gx: number;
  gy: number;
}

export interface ColonyState {
  N: number;
  /** N*N occupancy grid; cell = building uid, 0 = empty (typed array, doc §1) */
  grid: Int32Array;
  buildings: BuildingState[];
  pools: Record<Resource, Pool>;
  flow: Record<Resource, number>;
  /** the build currency (gathered as ore), separate from the survival pools */
  materials: Pool;

  // ---- embodied colony ----
  colonists: ColonistInstance[];
  /** drivable rovers fabricated by the Rover Bay (ids share the colonist counter) */
  rovers: RoverInstance[];
  /** the Rover Bay's fabrication countdown, seconds — pauses (never resets)
   *  while the bay is offline */
  roverFab: number;
  deposits: DepositInstance[];
  /** geothermal vents — static world-gen terrain the geothermal tap sits on */
  vents: VentInstance[];
  /** the collection depot cell — where the possessed colonist drops materials */
  depot: { gx: number; gy: number };
  /** id of the possessed colonist, or null */
  possessed: number | null;
  /** the player's standing WASD direction for the possessed colonist (normalized) */
  moveIntent: { dx: number; dy: number };
  /** seconds until the next deposit surfaces */
  depositRespawn: number;
  /** a live alien trade offer, or null */
  trade: TradeInstance | null;
  /** seconds to the next trade window */
  nextTrade: number;
  /** a live hostile UFO, or null */
  ufo: UfoInstance | null;
  /** seconds to the next UFO appearance */
  nextUfo: number;
  /** seconds to the next possible in-colony birth */
  nextBirth: number;
  /** permanent alien tech upgrades acquired through trade */
  acquiredTech: string[];
  /** monotonic id counters */
  colonistCounter: number;
  depositCounter: number;
  tradeCounter: number;
  ufoCounter: number;

  population: number;
  housing: number;
  labor: number;
  laborUsed: number;

  sol: number;
  tod: number;
  solLength: number;

  weather: Weather;
  solarMul: number;
  /** current wind level (pure derivation, engine/wind.ts) — stored each tick
   *  beside solarMul for the snapshot */
  windLevel: number;
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
  /** colony morale in [moraleFloor, 1] — drivers live in engine/morale.ts */
  morale: number;
  /** morale_low latch — mirrors brownLatch, serializes with the colony */
  moraleLatch: boolean;
  /** the active difficulty profile (tuning.ts DIFFICULTY) — chosen at reset,
   *  multipliers consumed by hazards/ufo, persisted with the colony */
  difficulty: Difficulty;
}

/** Save payload: state plus the RNG seed/state for a bit-identical resume. */
export interface SaveData {
  version: 1;
  seed: number;
  rngState: number;
  /** the separate env-rng (deposits + trades) so resume stays deterministic */
  envRngState: number;
  state: ColonyState;
}

export function emptyColonist(id: number, x: number, y: number): ColonistInstance {
  return {
    id, x, y, facing: 0, state: "idle",
    carryKind: null, carryAmt: 0, injury: 0, workUid: null, homeUid: null,
    gatherDepositId: null, gatherT: 0,
  };
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

export const FUNC_THRESHOLD = 0.45; // below this integrity → non-functional

/** can this building operate? (intact + not faulted) — lives on this leaf so
 *  hazards/injury/colonists/tick can all use it without a runtime import cycle */
export function buildingFunctional(b: BuildingState): boolean {
  return b.integrity >= FUNC_THRESHOLD && b.faulted <= 0;
}
