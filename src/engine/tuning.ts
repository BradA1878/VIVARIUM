/* ============================================================================
   Tuning knobs — the balance lives here, never in the engine logic (doc §2.1).
   These are the values the prototype settled on (doc §4.4).
   ============================================================================ */
import type { Resource } from "@shared/types";

/** Per-colonist life-support demand, per second (doc §4.4). */
export const PERSON: Record<"oxygen" | "water" | "food", number> = {
  oxygen: 0.22,
  water: 0.16,
  food: 0.12,
};

/** Base pool capacity before any storage buildings add to it. */
export const BASE_CAP: Record<Resource, number> = {
  power: 80,
  water: 60,
  oxygen: 40,
  food: 60,
};

/** Starting pool amounts on a fresh colony. */
export const START_AMOUNT: Record<Resource, number> = {
  power: 60,
  water: 40,
  oxygen: 35,
  food: 45,
};

export const GRID_N = 11;

/** seconds per sol (compressed) */
export const SOL_LENGTH = 150;

/** time of day a fresh colony starts at — mid-morning */
export const START_TOD = 0.32;

/** seconds a pool may sit empty before it turns lethal (doc §4.4) */
export const GRACE = 55;

/** dust storms gut solar to this fraction (doc §4.4) */
export const STORM_SOLAR_MULT = 0.12;

/** sun is above the horizon between these tod values */
export const DAY_START = 0.22;
export const DAY_END = 0.8;

/** storm scheduling (seconds) */
export const STORM_FIRST = 95;
export const STORM_DUR_MIN = 26;
export const STORM_DUR_SPAN = 14;
export const STORM_GAP_MIN = 80;
export const STORM_GAP_SPAN = 70;

/** colonist arrivals */
export const ARRIVALS_TOTAL = 3;
export const ARRIVAL_FIRST = 30;
export const ARRIVAL_BATCH = 4;
export const ARRIVAL_GAP_MIN = 55;
export const ARRIVAL_GAP_SPAN = 40;
/** retry delay when conditions for an arrival aren't met */
export const ARRIVAL_RETRY = 12;

/** Earth resupply windows — the campaign arc (doc §2.5). A window opens on a
 *  schedule and delivers a batch of resources gradually while it's open. */
export const RESUPPLY_FIRST = 180;
export const RESUPPLY_GAP = 280;
export const RESUPPLY_WINDOW = 22;
export const RESUPPLY_AMOUNT: Record<Resource, number> = {
  power: 40, water: 60, oxygen: 30, food: 45,
};

/** brownout latch thresholds */
export const BROWNOUT_DEFICIT = -0.2;
export const BROWNOUT_LOW = 2;
export const BROWNOUT_RECOVER_FRAC = 0.15;

export const DEFAULT_SEED = 0x5eed1234;
