/* ============================================================================
   Mining robots — rung 3 of the automation ladder (homeostasis update). The
   Robotics Bay fabricates a small fleet (ROBOT_CAP per bay) of autonomous
   workers. A robot takes any crew post no colonist is free for — the tick
   counts it as labor and assign() posts it after the colonists — and otherwise
   runs the SHARED gather brain (engine/gather.ts) with its own speed/carry
   knobs. Unlike colonists they work sol and night, never shelter, draw no life
   support, never count in population, and earn no trade bonus; unlike the
   rover they are NOT possessable (Colony.possess resolves colonists + rovers
   only).

   Ids draw from s.colonistCounter — the shared actor counter — and the
   deposit-claim set is unified: built in stepColonists (fresh claims in
   colonist-id order), then threaded through stepRobots (robot-id order), so a
   robot and a colonist never thrash over a node — a colonist out-claims a
   robot contesting the same node within a tick, by pass order.
   Zero RNG anywhere: fabrication is a countdown whose completion
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
  ARRIVE_EPS, GATHER_DWELL, ROBOT_BUILD_TIME, ROBOT_CAP, ROBOT_CARRY, ROBOT_FLARE_FAULT,
  ROBOT_HIT_RADIUS, ROBOT_MAT_COST, ROBOT_SPEED,
} from "./tuning";
import { accessCell, freeCellNear } from "./colonists";
import { stepGatherer, stepToward } from "./gather";
import { findPath } from "./pathfind";

const BAY_ID = "roboticsbay";

/** how many robots the colony may have: ROBOT_CAP for each Robotics Bay built.
 *  Pure over the building list, so the renderer can ask the same question. */
export function fleetCap(buildings: readonly { defId: string }[]): number {
  return ROBOT_CAP * buildings.reduce((n, b) => n + (b.defId === BAY_ID ? 1 : 0), 0);
}

/** the Robotics Bay's fabrication line. The countdown runs only while some bay
 *  is online && functional && STAFFED (the staffed line is what separates this
 *  shop from the rover's unstaffed garage; a robot can staff it) and the fleet
 *  is under fleetCap — a dark or empty bench PAUSES it where it stopped (never
 *  resets). One line for the colony however many bays stand: more bays raise
 *  the cap, not the pace. At zero the ROBOT_MAT_COST fee is drawn AT
 *  COMPLETION: an unaffordable chassis HOLDS at zero until the stock covers it,
 *  then deducts exactly the fee, rolls the robot out onto a free cell by the
 *  bay's door (id from the shared actor counter), and robot_ready fires. */
export function updateRobotFab(s: ColonyState, dt: number, emit: Emit): void {
  if (s.robots.length >= fleetCap(s.buildings)) return;
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
    carryKind: null, carryAmt: 0, faulted: 0, gatherDepositId: null, gatherT: 0, workUid: null,
  };
  s.robots.push(robot);
  emit({ type: "robot_ready", defId: BAY_ID, gx: Math.round(at.x), gy: Math.round(at.y) });
}

/** the robots' tick: a robot with a crew post (assign() gave it one this tick)
 *  walks to the building's door and works there, sol and night; every other
 *  non-faulted robot runs the shared gather brain — hazards or calm, it works
 *  the field. `claimed` is the SAME set the colonists' pass built and added
 *  to, so each node is claimed once per tick across both species — colonists
 *  first (id order), then robots (id order). A faulted robot stands exactly
 *  where the flare front caught it while the stun decrements (its claim
 *  survives — sticky, like a dusk carrier's). */
export function stepRobots(s: ColonyState, dt: number, claimed: Set<number>): void {
  for (const r of s.robots ?? []) {
    if (r.faulted > 0) {
      r.faulted = Math.max(0, r.faulted - dt);
      continue;
    }
    const post = r.workUid == null ? undefined : s.buildings.find((b) => b.uid === r.workUid);
    if (post) {
      const goal = accessCell(s, post);
      if (Math.hypot(goal.x - r.x, goal.y - r.y) <= ARRIVE_EPS) { r.state = "working"; continue; }
      // route around buildings, as colonists do, one path cell at a time
      const path = findPath(s, Math.round(r.x), Math.round(r.y), Math.round(goal.x), Math.round(goal.y));
      const next = path && path.length > 1 ? { x: path[1][0], y: path[1][1] } : goal;
      stepToward(r, next, ROBOT_SPEED, dt);
      r.state = "toWork";
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
 *  the stun runs; anything outside the gather loop and a post reads as idle) */
function viewState(r: RobotInstance): RobotView["state"] {
  if (r.faulted > 0) return "faulted";
  const a = r.state;
  return a === "gathering" || a === "mining" || a === "hauling" || a === "toWork" || a === "working" ? a : "idle";
}

/** snapshot view — state mirrors the brain, "faulted" derived from the stun */
export function robotViews(s: ColonyState): RobotView[] {
  return s.robots.map((r) => ({
    id: r.id, x: r.x, y: r.y, facing: r.facing,
    carryKind: r.carryKind, carryAmt: r.carryAmt, faulted: r.faulted,
    state: viewState(r),
    // a stunned robot is off its post; the engine only remembers where it was
    workUid: r.faulted > 0 ? null : r.workUid ?? null,
  }));
}
