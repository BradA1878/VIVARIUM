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

/** Campaign arc — the launch-window deadline (doc §2.5). Reach self-sufficiency
 *  before Earth's window closes, or the colony is stranded. */
export const DEADLINE_SOL = 12; // the launch window closes at the start of this sol
export const TARGET_POP = 8; // colonists required to count as a real settlement
/** seconds of sustained non-negative net on all life support (excluding resupply)
 *  with the target population, to be judged self-sufficient */
export const SELF_SUFFICIENCY_GOAL = 45;

/** brownout latch thresholds */
export const BROWNOUT_DEFICIT = -0.2;
export const BROWNOUT_LOW = 2;
export const BROWNOUT_RECOVER_FRAC = 0.15;

export const DEFAULT_SEED = 0x5eed1234;

/* ----------------------------------------------------------------------------
   Embodied colony — astronauts, gathering, the materials economy, traders.
   Movement is in grid cells; speeds are cells/sec. All deterministic: the
   possessed colonist integrates the player's moveIntent at PILOT_SPEED, the
   rest follow a tod/hazard state machine at WALK_SPEED. No Math.random.
   ---------------------------------------------------------------------------- */
export const WALK_SPEED = 1.1;   // auto-colonists
export const PILOT_SPEED = 2.6;  // the colonist you possess
export const ARRIVE_EPS = 0.14;  // "reached the target" distance
export const COLONIST_Y = 0;     // ground plane (render uses its own height)

/** gathering */
export const CARRY_CAP = 20;     // units a colonist can haul
export const MINE_RATE = 9;      // units/sec mined while standing on a deposit
export const UNLOAD_RATE = 18;   // units/sec dropped into the pools at base
export const MINE_RADIUS = 0.75; // cells: how close to a deposit to mine it
export const BASE_RADIUS = 2.4;  // cells from the hub center to auto-unload

/** the seeded deposit field (uses a SEPARATE env-rng so the main hazard/arrival
 *  stream is byte-for-byte unchanged) */
export const DEPOSIT_COUNT = 7;       // deposits scattered at colony start
export const DEPOSIT_MIN = 45;        // amount = MIN + rand*SPAN
export const DEPOSIT_SPAN = 70;
export const DEPOSIT_EDGE = 1;        // keep deposits this many cells off the border
export const DEPOSIT_CLEAR = 3;       // min cells from the colony center (4,4-ish)
export const DEPOSIT_RESPAWN = 85;    // seconds between new deposits surfacing
export const DEPOSIT_FIELD_MAX = 11;  // cap on concurrent deposits

/** materials — the build currency */
export const START_MATERIALS = 90;
export const MATERIALS_CAP = 400;

/** alien traders — a window like resupply, but you accept/decline a swap */
export const TRADE_FIRST = 70;     // seconds to the first traders
export const TRADE_GAP = 165;      // seconds between trade windows
export const TRADE_INBOUND = 8;    // telegraph seconds before the ship lands
export const TRADE_DECIDE = 42;    // seconds the offer stays open while landed
export const TRADE_LEAVE = 6;      // lift-off seconds after you resolve it
/** offer sizing: they TAKE take.amount of one resource, GIVE give.amount of another */
export const TRADE_TAKE_MIN = 18;
export const TRADE_TAKE_SPAN = 22;
export const TRADE_GIVE_MIN = 26;
export const TRADE_GIVE_SPAN = 30;
