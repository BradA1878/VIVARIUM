/* ============================================================================
   Mining robots — rung 3 of the automation ladder (homeostasis update). The
   Robotics Bay fabricates a small fleet of autonomous gatherers that run the
   SHARED gather brain (engine/gather.ts) with their own speed/carry knobs.
   Unlike colonists they work sol and night, never shelter, draw no life
   support, and never count in population/labor; unlike the rover they are NOT
   possessable (Colony.possess resolves colonists + rovers only).

   Ids draw from s.colonistCounter — the shared actor counter — so the unified
   deposit-claim set (built in stepColonists, threaded through stepRobots)
   resolves in one global id order and a robot and a colonist never thrash
   over a node. Zero RNG anywhere: fabrication is a countdown whose completion
   fee is charged when the chassis finishes (holding at zero until the stock
   covers it), and the counterplay is deterministic — a flare's activation
   stuns the whole fleet (faultRobots), a meteor/quake strike inside
   ROBOT_HIT_RADIUS scraps a robot outright (destroyRobotsNear, hooked into
   applyStrikeMachines) — so the main hazard/arrival rng stream stays
   byte-identical (doc §0 wall).
   ============================================================================ */
import type { RobotView } from "@shared/types";
import type { ColonyState, RobotInstance } from "./state";
import { buildingFunctional } from "./state";
import type { Emit } from "./tick";
import {
  GATHER_DWELL, ROBOT_BUILD_TIME, ROBOT_CAP, ROBOT_CARRY, ROBOT_FLARE_FAULT,
  ROBOT_HIT_RADIUS, ROBOT_MAT_COST, ROBOT_SPEED,
} from "./tuning";
import { accessCell, freeCellNear } from "./colonists";
import { stepGatherer } from "./gather";

const BAY_ID = "roboticsbay";

/** the Robotics Bay's fabrication line. The countdown runs only while some bay
 *  is online && functional && STAFFED (the staffed line is what separates this
 *  shop from the rover's unstaffed garage) and the fleet is under ROBOT_CAP —
 *  a dark or empty bench PAUSES it where it stopped (never resets). At zero the
 *  ROBOT_MAT_COST fee is drawn AT COMPLETION: an unaffordable chassis HOLDS at
 *  zero until the stock covers it, then deducts exactly the fee, rolls the
 *  robot out onto a free cell by the bay's door (id from the shared actor
 *  counter), and robot_ready fires. */
export function updateRobotFab(s: ColonyState, dt: number, emit: Emit): void {
  if (s.robots.length >= ROBOT_CAP) return;
  const bay = s.buildings.find(
    (b) => b.defId === BAY_ID && b.online && b.staffed && buildingFunctional(b),
  );
  if (!bay) return; // no working line → the countdown holds
  s.robotFab = Math.max(0, s.robotFab - dt);
  if (s.robotFab > 0) return;
  if (s.materials.amount < ROBOT_MAT_COST) return; // finished chassis, waiting on the fee
  s.materials.amount -= ROBOT_MAT_COST;
  s.robotFab = ROBOT_BUILD_TIME;
  const at = freeCellNear(s, accessCell(s, bay));
  const robot: RobotInstance = {
    id: s.colonistCounter++, x: at.x, y: at.y, facing: 0, state: "idle",
    carryKind: null, carryAmt: 0, faulted: 0, gatherDepositId: null, gatherT: 0,
  };
  s.robots.push(robot);
  emit({ type: "robot_ready", defId: BAY_ID, gx: Math.round(at.x), gy: Math.round(at.y) });
}

/** the robots' tick: every non-faulted robot runs the shared gather brain —
 *  sol and night, hazards or calm, it works the field. `claimed` is the SAME
 *  set the colonists' pass built and added to, so claims resolve once, in
 *  actor-id order, across both species. A faulted robot stands exactly where
 *  the flare front caught it while the stun decrements (its claim survives —
 *  sticky, like a dusk carrier's). */
export function stepRobots(s: ColonyState, dt: number, claimed: Set<number>): void {
  for (const r of s.robots ?? []) {
    if (r.faulted > 0) {
      r.faulted = Math.max(0, r.faulted - dt);
      continue;
    }
    const worked = stepGatherer(s, r, dt, claimed, {
      speed: ROBOT_SPEED, carryCap: ROBOT_CARRY, dwell: GATHER_DWELL,
    });
    if (!worked) r.state = "idle"; // field mined out and nothing in hand
  }
}

/** flare counterplay: the activation front stuns the WHOLE fleet for
 *  ROBOT_FLARE_FAULT seconds — deterministic, zero rng draws, so the main
 *  hazard stream is untouched. Called by hazards.ts on telegraph → active.
 *  Guarded for minimal test states. */
export function faultRobots(s: ColonyState): void {
  for (const r of s.robots ?? []) r.faulted = Math.max(r.faulted, ROBOT_FLARE_FAULT);
}

/** strike counterplay: a meteor/quake impact at (gx,gy) DESTROYS every robot
 *  inside ROBOT_HIT_RADIUS — removed outright, robot_destroyed emitted with
 *  the robot's cell (unlike the rover, which is only dented and self-repairs).
 *  Called from applyStrikeMachines (rover.ts) on every strike path. Guarded
 *  for minimal test states. */
export function destroyRobotsNear(s: ColonyState, gx: number, gy: number, emit: Emit): void {
  const robots = s.robots ?? [];
  if (robots.length === 0) return;
  const keep: RobotInstance[] = [];
  for (const r of robots) {
    if (Math.hypot(r.x - gx, r.y - gy) <= ROBOT_HIT_RADIUS) {
      emit({ type: "robot_destroyed", gx: Math.round(r.x), gy: Math.round(r.y) });
    } else {
      keep.push(r);
    }
  }
  if (keep.length !== robots.length) s.robots = keep;
}

/** the brain's act, narrowed to the view's vocabulary ("faulted" wins while
 *  the stun runs; anything outside the gather loop reads as idle) */
function viewState(r: RobotInstance): RobotView["state"] {
  if (r.faulted > 0) return "faulted";
  const a = r.state;
  return a === "gathering" || a === "mining" || a === "hauling" ? a : "idle";
}

/** snapshot view — state mirrors the brain, "faulted" derived from the stun */
export function robotViews(s: ColonyState): RobotView[] {
  return s.robots.map((r) => ({
    id: r.id, x: r.x, y: r.y, facing: r.facing,
    carryKind: r.carryKind, carryAmt: r.carryAmt, faulted: r.faulted,
    state: viewState(r),
  }));
}
