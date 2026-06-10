/* ============================================================================
   VIVARIUM — SHARED TYPES
   The contract spoken across the hard wall (doc §0): the engine produces
   ColonyEvent + Snapshot; the UI, agent layer, and server only consume them.
   Nothing here may import three, Vue, or Node — it is the neutral vocabulary.
   ============================================================================ */

export type Resource = "power" | "water" | "oxygen" | "food";

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

/** what a colonist is doing — drives the renderer's pose + the auto-AI */
export type ColonistAct =
  | "idle"
  | "toWork"
  | "working"
  | "toHome"
  | "sheltering"
  | "piloted"
  | "mining"
  | "hauling";

/** a colonist as the renderer/HUD sees it. Continuous grid coords; the renderer
 *  interpolates between snapshots. */
export interface ColonistView {
  id: number;
  x: number;
  y: number;
  /** facing angle in radians (world XZ) */
  facing: number;
  state: ColonistAct;
  carryKind: DepositKind | null;
  carryAmt: number;
  possessed: boolean;
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
  | "arrival"
  | "resupply"
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
  /** campaign end states (doc §2.5) */
  | "victory"
  | "defeat"
  /** agent-layer only — emitted by the Sentinel (Phase 13), never by the engine */
  | "anomaly";

export type Outcome = "victory" | "defeat" | null;

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
  n?: number;
  pop?: number;
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
}
