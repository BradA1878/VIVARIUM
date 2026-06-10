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

export const GRID_N = 15; // buildable area (15×15 = 225 cells; was 11×11 = 121)

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
export const DEADLINE_SOL = 22; // the launch window closes at the start of this sol
// (widened from 12 once the explore/gather/trade layer landed — a run needs room
// to go mining and deal with the traders, not just race survival)
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

/** gathering — explicit pick up / drop (press P). One press fills your hands from
 *  a deposit; one press at the depot empties them into the pools. */
export const CARRY_CAP = 20;       // units a colonist can haul in one trip
export const PICKUP_RADIUS = 1.25; // cells: how close to a deposit to grab a load
export const DEPOT_RADIUS = 1.5;   // cells: how close to the depot to drop a load

/** the seeded deposit field (uses a SEPARATE env-rng so the main hazard/arrival
 *  stream is byte-for-byte unchanged) */
export const DEPOSIT_COUNT = 11;      // deposits scattered at colony start (more, for the bigger map)
export const DEPOSIT_MIN = 55;        // amount = MIN + rand*SPAN (a little richer)
export const DEPOSIT_SPAN = 85;
export const DEPOSIT_EDGE = 1;        // keep deposits this many cells off the border
export const DEPOSIT_CLEAR = 3;       // min cells from the colony center (4,4-ish)
export const DEPOSIT_RESPAWN = 85;    // seconds between new deposits surfacing
export const DEPOSIT_FIELD_MAX = 15;  // cap on concurrent deposits

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
/** some offers hand over permanent alien tech instead of a resource */
export const TRADE_TECH_CHANCE = 0.4;   // when an un-acquired tech exists
export const TRADE_TECH_TAKE_MIN = 40;  // price of alien tech, in materials (40-70)
export const TRADE_TECH_TAKE_SPAN = 30;

/* ----------------------------------------------------------------------------
   The evil UFO — a rare hostile abductor. Scheduling + the abduction roll use the
   SEPARATE env-rng (like deposits + traders), so the main hazard/arrival stream is
   byte-identical. Rare by design; safety floors keep it from being a cheap loss.
   ---------------------------------------------------------------------------- */
export const UFO_FIRST = 240;       // seconds to the first possible UFO
export const UFO_GAP_MIN = 240;     // gap between visits = MIN + rand*SPAN (rare)
export const UFO_GAP_SPAN = 200;
export const UFO_RETRY = 20;        // re-check delay when conditions aren't met
export const UFO_INBOUND = 6;       // telegraph seconds before it hovers
export const UFO_HOVER = 5;         // seconds locked on, beam down, before the grab
export const UFO_LEAVE = 5;         // lift-off seconds after the abduction beat
export const UFO_MIN_SOL = 3;       // never appears before this sol
export const UFO_MIN_POP = 3;       // never abducts at/below this population

/** the abduction deterrent. Each ONLINE + functional Deflector Array blocks the
 *  grab with base probability DEFLECTOR_BLOCK; the Aegis Resonator tech adds its
 *  own `deflectorBoost` (techs.ts) on top, per deflector. Multiple deflectors stack
 *  with diminishing returns (1 − Π(1 − perDeflector)). */
export const DEFLECTOR_BLOCK = 0.5; // per online deflector, before alien tech

/* ----------------------------------------------------------------------------
   The colonist roster — roles are pure id derivations (engine/roster.ts). A
   staffed building whose workers match its trade produces more; eff scales
   produces only, never consumes.
   ---------------------------------------------------------------------------- */
export const ROLE_BONUS = 0.25; // eff = 1 + ROLE_BONUS × matched/staffing

/* ----------------------------------------------------------------------------
   In-colony births — the settlement grows from within when it's thriving (surplus
   + spare housing + a population floor + no active life-support crisis). Uncapped,
   but rare. Uses the MAIN rng, like Earth arrivals which it mirrors.
   ---------------------------------------------------------------------------- */
export const BIRTH_FIRST = 180;     // seconds to the first possible birth
export const BIRTH_GAP_MIN = 240;   // gap between births = MIN + rand*SPAN (rare)
export const BIRTH_GAP_SPAN = 200;
export const BIRTH_RETRY = 15;      // re-check delay when conditions aren't met
export const BIRTH_MIN_POP = 4;     // need a real settlement before it grows itself
