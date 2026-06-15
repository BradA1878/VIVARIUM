/* ============================================================================
   VIVARIUM — SHARED TYPES
   The contract spoken across the hard wall (doc §0): the engine produces
   ColonyEvent + Snapshot; the UI, agent layer, and server only consume them.
   Nothing here may import three, Vue, or Node — it is the neutral vocabulary.
   ============================================================================ */

export type Resource = "power" | "water" | "oxygen" | "food";

/** campaign difficulty — the profiles (grace, deadline, hazard/UFO scaling,
 *  starting materials) live in engine/tuning.ts DIFFICULTY */
export type Difficulty = "easy" | "normal" | "hard";

/** the world a run is founded on. mars is the origin/anchor (its profile is
   today's constants); ceres/io/titan are destinations reached via the PTP. World
   is an axis orthogonal to Difficulty — the two profiles compose. */
export type World = "mars" | "ceres" | "io" | "titan";

/** what a PTP launch carries from the world you leave into the next run (PTP):
   a couple of veteran colonists BY THEIR LITERAL ID (name + role derive from the
   id, so they're recognizably the same person — the lowest becomes the new
   commander) and one alien tech. Applied as plain seed state, never live mutation. */
export interface LegacyManifest {
  veterans: number[];
  tech?: string;
}

/** what an inter-planet shipment carries between colonies (parallel-colonies). The
 *  sender DEBITS it from its own pools in its tick; the receiver CREDITS it as plain
 *  seed-state on load (capacity-clamped resources; crew as fresh headcount) — never a
 *  live cross-colony write. Crew is a headcount (arrives at fresh ids), not specific
 *  colonists, so there's no id-collision/commander-succession risk. */
export interface ShipmentManifest {
  resources?: Partial<Record<Resource, number>>;
  materials?: number;
  crew?: number;
}

export const RESOURCES: Resource[] = ["power", "water", "oxygen", "food"];

/** A side of a footprint / a rotation step. N=0, E=1, S=2, W=3. Grid deltas:
 *  0→(0,-1) 1→(1,0) 2→(0,1) 3→(-1,0). */
export type Side = 0 | 1 | 2 | 3;

/** A building definition is data, not code (doc §2.1). consumes/produces are
 *  per-second at full operation; the engine scales by dt internally. */
export interface BuildingDef {
  id: string;
  name: string;
  glyph: string;
  /** [w, h] in grid cells */
  foot: [number, number];
  /** silhouette height hint (render only) */
  h: number;
  color: string;
  cost: Partial<Record<Resource, number>>;
  staffing: number;
  consumes: Partial<Record<Resource, number>>;
  produces: Partial<Record<Resource, number>>;
  /** must flood-fill to the hub through conduits to operate (doc §2.3) */
  requiresPressure: boolean;
  /** power-allocation rank; brownout sheds the LOWEST first (doc §2.4) */
  priority: number;
  /** solar generation at full sun, before sol/storm multipliers */
  solar?: number;
  /** wind generation at full wind — scaled by the windLevel curve (pass 2, like solar) */
  wind?: number;
  /** flat generation, sol or night (geothermal) — pass 2, like solar */
  steady?: number;
  /** materials trickled per second at full operation (the printer) — pass 4, × eff */
  producesMat?: number;
  /** placement requires a footprint cell on a geothermal vent */
  needsVent?: true;
  /** placement requires a footprint cell on a subsurface aquifer (parallel to needsVent) */
  needsAquifer?: true;
  /** greywater loop — returns `frac` of the colony's per-tick water draw, capped
   *  at `max` water/s per building (pure tick arithmetic, no flat `produces`) */
  reclaim?: { frac: number; max: number };
  /** materials it costs to place (the gather-to-build economy). 0/undefined = free. */
  matCost?: number;
  /** capacity this building adds to a pool (batteries, tanks, cisterns) */
  caps?: Partial<Record<Resource, number>>;
  /** colonists this building houses */
  popCap?: number;
  /** the pressure source */
  isHub?: boolean;
  /** extends the seal between hub and habs */
  conduit?: boolean;
  /** which local side the airlock/door is on (pressure buildings only). The
   *  world door side is (door + rot) % 4; corridors auto-route to its exit cell. */
  door?: Side;
  desc: string;
}

/** A buffer. The buffer is what makes the sim solvable (doc §2.2). */
export interface Pool {
  amount: number;
  capacity: number;
}

/** A placed building's live state (the parts the renderer/HUD read). */
export interface BuildingState {
  uid: number;
  defId: string;
  gx: number;
  gy: number;
  /** quarter-turn rotation (0-3); aims the door + orients the mesh */
  rot: Side;
  online: boolean;
  connected: boolean;
  staffed: boolean;
  fed: boolean;
  /** 0..1 utilization this tick */
  util: number;
  /** structural integrity 0..1; below a threshold the building can't operate,
   *  it self-repairs slowly, and 0 destroys it (doc: hazard damage) */
  integrity: number;
  /** seconds an electronics fault keeps it offline (solar flare) */
  faulted: number;
}

export type Weather = "clear" | "dust";

/** environmental hazards the planet throws at the colony */
export type HazardKind = "dust" | "meteor" | "flare" | "coldsnap" | "quake";

export const HAZARD_KINDS: HazardKind[] = ["dust", "meteor", "flare", "coldsnap", "quake"];

export type HazardPhase = "telegraph" | "active";

/** a hazard as the HUD/renderer sees it */
export interface HazardView {
  kind: HazardKind;
  phase: HazardPhase;
  /** 0..1 severity */
  intensity: number;
  /** seconds left in the current phase */
  remaining: number;
}

// ---- embodied colony: astronauts, deposits, trade ---------------------------

/** a surface resource node the possessed colonist mines */
export type DepositKind = "ice" | "ore" | "cache";

/** which pool a mined deposit unloads into. ore → the build `materials` pool;
 *  ice → water, cache → food. */
export const DEPOSIT_YIELD: Record<DepositKind, Resource | "materials"> = {
  ice: "water",
  ore: "materials",
  cache: "food",
};

export interface DepositView {
  id: number;
  gx: number;
  gy: number;
  kind: DepositKind;
  /** units remaining */
  amount: number;
  /** initial units (render scale) */
  max: number;
}

/** a geothermal vent — static world-gen terrain, never depletes. The geothermal
 *  tap must sit on one (BuildingDef.needsVent). */
export interface VentView {
  id: number;
  gx: number;
  gy: number;
}

/** a subsurface aquifer site — static world-gen terrain, never depletes. The
 *  aquifer well must sit on one (BuildingDef.needsAquifer). Mirrors VentView. */
export interface AquiferView {
  id: number;
  gx: number;
  gy: number;
}

/** a colonist's trade — a pure derivation of its id (engine/roster.ts), so it
 *  costs no RNG draws and survives save/load for free */
export type ColonistRole = "miner" | "engineer" | "botanist" | "medic";

/** what a colonist is doing — drives the renderer's pose + the auto-AI */
export type ColonistAct =
  | "idle"
  | "toWork"
  | "working"
  | "toHome"
  | "sheltering"
  | "toMedbay"
  | "recovering"
  | "piloted"
  | "gathering"
  | "mining"
  | "hauling";

/** a colonist as the renderer/HUD sees it. Continuous grid coords; the renderer
 *  interpolates between snapshots. */
export interface ColonistView {
  id: number;
  /** deterministic display name, derived from the id */
  name: string;
  role: ColonistRole;
  x: number;
  y: number;
  /** facing angle in radians (world XZ) */
  facing: number;
  state: ColonistAct;
  /** base-seconds of recovery remaining; 0 = healthy */
  injury: number;
  carryKind: DepositKind | null;
  carryAmt: number;
  possessed: boolean;
}

/** a drivable rover — the colony's bulk hauler, possessed through the SAME id
 *  space as colonists (the engine draws rover ids from the colonist counter,
 *  so `possess {id}` addresses either). Its bays carry MULTIPLE deposit kinds
 *  at once, unlike a suit's one-kind hands. */
export interface RoverView {
  id: number;
  x: number;
  y: number;
  /** facing angle in radians (world XZ) */
  facing: number;
  /** per-kind cargo bays */
  cargo: Partial<Record<DepositKind, number>>;
  /** sum across the bays (precomputed for the HUD) */
  cargoTotal: number;
  /** 0..1 — strikes dent it; below the functional threshold it can't drive
   *  (it self-repairs, and is never destroyed) */
  integrity: number;
  possessed: boolean;
}

/** an autonomous mining robot — rung 3 of the automation ladder. NOT
 *  possessable (possession resolves colonists + rovers only): it runs the
 *  shared gather brain sol and night, never shelters, and draws no life
 *  support. A flare's activation stuns the fleet ("faulted"); a meteor/quake
 *  strike close enough scraps one outright. */
export interface RobotView {
  id: number;
  x: number;
  y: number;
  /** facing angle in radians (world XZ) */
  facing: number;
  /** single-kind hands, like a suit's (the rover is the multi-kind hauler) */
  carryKind: DepositKind | null;
  carryAmt: number;
  /** seconds of flare stun remaining; 0 = running */
  faulted: number;
  state: "idle" | "gathering" | "mining" | "hauling" | "faulted";
}

export type TradePhase = "inbound" | "landed" | "leaving";

/** what an offer hands over: a resource, the build currency, or a permanent
 *  alien tech upgrade (res "tech", with the tech id) */
export type TradeGive =
  | { res: Resource | "materials"; amount: number; tech?: undefined }
  | { res: "tech"; amount: number; tech: string };

/** a live alien trade offer (modeled on the Earth-resupply window) */
export interface TradeView {
  id: number;
  phase: TradePhase;
  /** what the traders GIVE you (a resource, materials, or alien tech) */
  give: TradeGive;
  /** what they TAKE in return (always a resource or materials) */
  take: { res: Resource | "materials"; amount: number };
  /** seconds left to decide while landed (0 in other phases) */
  deadline: number;
  /** landing cell */
  gx: number;
  gy: number;
}

/** the evil UFO's lifecycle: descend → hover with a beam on its target → leave */
export type UfoPhase = "inbound" | "hovering" | "leaving";

/** a live hostile UFO (a rare abductor — sibling of the trader, but it takes a
 *  colonist instead of bartering). The renderer positions the beam over `targetId`. */
export interface UfoView {
  id: number;
  phase: UfoPhase;
  /** the colonist the beam is locked onto, or null (target lost / already taken) */
  targetId: number | null;
  /** last-known cell of the target — a fallback hover point for the renderer */
  gx: number;
  gy: number;
}

/** The read-only view of the colony the UI/agent layer consume each frame.
 *  Serializable; carries no functions. */
export interface Snapshot {
  /** grid edge length */
  N: number;
  buildings: BuildingState[];
  pools: Record<Resource, Pool>;
  /** net per-second flow for each resource (for the HUD readouts) */
  flow: Record<Resource, number>;
  /** the build currency, gathered as ore (separate from the survival pools) */
  materials: Pool;
  /** colonists on the surface (count == population) */
  colonists: ColonistView[];
  /** surface resource deposits to mine */
  deposits: DepositView[];
  /** geothermal vents — static terrain the geothermal tap must sit on */
  vents: VentView[];
  /** subsurface aquifer sites — static terrain the aquifer well must sit on */
  aquifers: AquiferView[];
  /** drivable rovers — bulk haulers fabricated at the Rover Bay */
  rovers: RoverView[];
  /** autonomous mining robots — fabricated at the Robotics Bay, never possessable */
  robots: RobotView[];
  /** the collection depot cell — where the possessed colonist drops materials */
  depot: { gx: number; gy: number };
  /** the id of the colonist the player is piloting, or null */
  possessed: number | null;
  /** a live alien trade offer, or null */
  trade: TradeView | null;
  /** a live hostile UFO abduction in progress, or null */
  ufo: UfoView | null;
  /** ids of permanent alien tech upgrades acquired through trade */
  acquiredTech: string[];
  population: number;
  housing: number;
  labor: number;
  laborUsed: number;
  sol: number;
  /** time of day, 0..1 */
  tod: number;
  solLength: number;
  weather: Weather;
  stormT: number;
  /** current solar multiplier (sun curve × storm), 0..1 */
  solarMul: number;
  /** current wind level (pure anti-solar curve, engine/wind.ts), WIND_MIN..1 */
  windLevel: number;
  /** palette availability — every def id → placeable? The founding tier is
   *  always true; the expansion tier latches open as the colony proves itself
   *  (engine/unlocks.ts; an unlock never revokes). */
  unlocks: Record<string, boolean>;
  /** live hazards (telegraphed + active) for the HUD + renderer */
  hazards: HazardView[];
  /** whether an external Director is driving hazards (engine scheduler stands down) */
  directorControlled: boolean;
  /** seconds until the next Earth resupply window (doc §2.5) */
  nextResupply: number;
  /** seconds the current resupply window stays open (0 = none) */
  resupplyT: number;
  /** seconds remaining before a depleted pool turns lethal; null if safe */
  timers: Record<"oxygen" | "water" | "food", number | null>;
  grace: number;
  dead: number;
  /** colony morale, clamped to [floor, 1] — scales production, never movement */
  morale: number;
  /** the active difficulty profile (chosen at reset, persisted in state) */
  difficulty: Difficulty;
  /** the world this run was founded on (PTP) — mars unless reached via expansion */
  world: World;

  // ---- campaign (doc §2.5) ----
  /** the sol Earth's launch window closes; reach self-sufficiency before then */
  deadlineSol: number;
  /** colonists required to count as a settlement */
  targetPop: number;
  /** seconds of sustained self-sufficiency accrued so far */
  selfSufficientFor: number;
  /** seconds of sustained self-sufficiency needed to win */
  selfSufficiencyGoal: number;
  /** set once when the campaign ends */
  outcome: Outcome;
  outcomeReason: string;

  paused: boolean;
  speed: number;
  /** elapsed sim seconds */
  t: number;
  started: boolean;
}

export type EventType =
  | "boot"
  | "build"
  | "hub_online"
  | "dawn"
  | "dusk"
  | "new_sol"
  | "storm_in"
  | "storm_clear"
  /** generic hazard lifecycle (kind in `detail`) */
  | "hazard_warn"
  | "hazard_start"
  | "hazard_end"
  /** a meteor/quake impact (cell in n/pop unused; res unused) */
  | "strike"
  | "building_damaged"
  | "building_destroyed"
  | "brownout"
  | "power_back"
  | "crit_start"
  | "crit_clear"
  | "casualty"
  /** a strike wounded a colonist / an injury finished healing (colonist id payload) */
  | "colonist_injured"
  | "colonist_recovered"
  /** colony morale crossed below its low threshold / recovered past ok (latched) */
  | "morale_low"
  | "morale_recovered"
  | "arrival"
  | "resupply"
  /** a resupply window closed — carries the actual banked per-resource totals */
  | "resupply_done"
  /** alien traders (doc: first contact) */
  | "traders_inbound"
  | "trade_done"
  | "trade_left"
  /** the evil UFO — a rare hostile abductor */
  | "ufo_inbound"
  | "abducted"
  | "abduction_blocked"
  | "ufo_left"
  /** a colonist born in-colony as the settlement thrives */
  | "birth"
  /** a gated building def opened for placement (defId + display name in detail) */
  | "unlock"
  /** the Rover Bay finished fabricating a rover (it rolls out by the bay door) */
  | "rover_ready"
  /** the Robotics Bay finished a mining robot (it rolls out by the bay door) */
  | "robot_ready"
  /** a meteor/quake strike scrapped a robot (its cell in gx/gy) */
  | "robot_destroyed"
  /** campaign end states (doc §2.5) */
  | "victory"
  | "defeat"
  /** the PTP launched — a deliberate run-ending that founds the next world */
  | "expansion"
  /** agent-layer only — emitted by the Sentinel (Phase 13), never by the engine */
  | "anomaly"
  /** agent-layer only — the council's idle-banter beat, never emitted by the engine */
  | "idle";

export type Outcome = "victory" | "defeat" | "expansion" | null;

/** Emitted by the engine for the UI and (optionally) for VIVARIUM. Never read
 *  back into the tick (doc §0). */
export interface ColonyEvent {
  type: EventType;
  /** elapsed sim seconds when emitted */
  t: number;
  sol: number;
  tod: number;
  /** event-specific payload */
  defId?: string;
  name?: string;
  res?: "oxygen" | "water" | "food";
  secs?: number;
  /** per-resource totals (e.g. resupply_done: what actually banked, post-clamp) */
  amounts?: Partial<Record<Resource, number>>;
  n?: number;
  pop?: number;
  /** colonist id for colonist_injured / colonist_recovered */
  id?: number;
  /** free-text detail (e.g. the Sentinel's anomalous feature, or a hazard kind) */
  detail?: string;
  /** anomaly magnitude in standard deviations above learned-normal */
  sigma?: number;
  /** hazard kind for hazard_* events */
  kind?: HazardKind;
  /** impact cell for strike / building_* events */
  gx?: number;
  gy?: number;
  /** whether a strike hit a building */
  hit?: boolean;
  /** UI-side annotation: the Director chose this hazard (the engine never sets it) */
  directed?: boolean;
}
