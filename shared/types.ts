/* ============================================================================
   VIVARIUM — SHARED TYPES
   The contract spoken across the hard wall (doc §0): the engine produces
   ColonyEvent + Snapshot; the UI, agent layer, and server only consume them.
   Nothing here may import three, Vue, or Node — it is the neutral vocabulary.
   ============================================================================ */

export type Resource = "power" | "water" | "oxygen" | "food";

export const RESOURCES: Resource[] = ["power", "water", "oxygen", "food"];

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
  /** capacity this building adds to a pool (batteries, tanks, cisterns) */
  caps?: Partial<Record<Resource, number>>;
  /** colonists this building houses */
  popCap?: number;
  /** the pressure source */
  isHub?: boolean;
  /** extends the seal between hub and habs */
  conduit?: boolean;
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
  online: boolean;
  connected: boolean;
  staffed: boolean;
  fed: boolean;
  /** 0..1 utilization this tick */
  util: number;
}

export type Weather = "clear" | "dust";

/** The read-only view of the colony the UI/agent layer consume each frame.
 *  Serializable; carries no functions. */
export interface Snapshot {
  /** grid edge length */
  N: number;
  buildings: BuildingState[];
  pools: Record<Resource, Pool>;
  /** net per-second flow for each resource (for the HUD readouts) */
  flow: Record<Resource, number>;
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
  /** seconds until the next Earth resupply window (doc §2.5) */
  nextResupply: number;
  /** seconds the current resupply window stays open (0 = none) */
  resupplyT: number;
  /** seconds remaining before a depleted pool turns lethal; null if safe */
  timers: Record<"oxygen" | "water" | "food", number | null>;
  grace: number;
  dead: number;
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
  | "brownout"
  | "power_back"
  | "crit_start"
  | "crit_clear"
  | "casualty"
  | "arrival"
  | "resupply"
  /** agent-layer only — emitted by the Sentinel (Phase 13), never by the engine */
  | "anomaly";

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
  /** free-text detail (e.g. the Sentinel's anomalous feature) */
  detail?: string;
  /** anomaly magnitude in standard deviations above learned-normal */
  sigma?: number;
}
