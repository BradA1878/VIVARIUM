/* ============================================================================
   Gathering — the shared pick-up / haul / drop mechanics (doc §0 wall: pure,
   deterministic, zero RNG draws). Two callers share these internals:

   - the POSSESSED colonist (engine/colonists.ts interactPossessed): the player
     presses P to fill or empty the hands explicitly;
   - the AUTO-GATHER brain (stepGatherer): an idle colonist claims a node, walks
     to it, dwells to mine a load, hauls it to the depot, banks it, and repeats.
     Fresh claims are NEED-AWARE (kindsByNeed): empty hands serve the scarcest
     pool first, so a starving colony works caches before stockpiling more ore.

   Any agent matching GatherAgent structurally can run the brain — colonists
   today, robots later. Movement uses findPath/stepToward only, so routes replay
   identically; claims are plain ids on the agent, so they serialize for free.
   ============================================================================ */
import type { DepositKind, Resource } from "@shared/types";
import { DEPOSIT_YIELD } from "@shared/types";
import { ARRIVE_EPS, DEPOT_RADIUS, PICKUP_RADIUS } from "./tuning";
import type { ColonyState, DepositInstance } from "./state";
import { findPath } from "./pathfind";

export interface Pt { x: number; y: number }

/** the slice of an agent the carry helpers touch (hands only) */
export interface CarryAgent {
  carryKind: DepositKind | null;
  carryAmt: number;
}

/** what an agent must look like to run the gather brain. ColonistInstance
 *  satisfies it structurally (RobotInstance will too); `state` is wide on
 *  purpose — stepGatherer only ever writes "gathering" | "mining" | "hauling". */
export interface GatherAgent extends CarryAgent {
  id: number;
  x: number;
  y: number;
  facing: number;
  state: string;
  /** the deposit this agent has claimed, or null */
  gatherDepositId: number | null;
  /** seconds spent mining at the claimed node so far (the dwell timer) */
  gatherT: number;
}

export interface GatherOpts {
  /** walk speed, cells/sec */
  speed: number;
  /** units the agent hauls per trip */
  carryCap: number;
  /** seconds spent mining at the node before the load comes free */
  dwell: number;
}

/** add a banked load to its pool (ore → the materials currency) */
function addToPool(s: ColonyState, target: Resource | "materials", amt: number): void {
  const p = target === "materials" ? s.materials : s.pools[target];
  p.amount = Math.min(p.capacity, p.amount + amt);
}

/** the collection depot's cell center */
export function depotCenter(s: ColonyState): Pt {
  return { x: s.depot.gx, y: s.depot.gy };
}

/** move an agent toward a target; returns true once it has arrived */
export function stepToward(
  c: { x: number; y: number; facing: number },
  t: Pt,
  speed: number,
  dt: number,
): boolean {
  const dx = t.x - c.x, dy = t.y - c.y;
  const d = Math.hypot(dx, dy);
  if (d <= ARRIVE_EPS) return true;
  const step = Math.min(d, speed * dt);
  c.x += (dx / d) * step;
  c.y += (dy / d) * step;
  c.facing = Math.atan2(dx, dy);
  return false;
}

/** the nearest live deposit within pickup reach of (x,y), optionally one kind
 *  only (hands hold one kind) — generalized from the possessed reach check */
export function nearestDepositInReach(
  s: ColonyState, x: number, y: number, kind?: DepositKind,
): DepositInstance | null {
  let best: DepositInstance | null = null, bestD = PICKUP_RADIUS;
  for (const dep of s.deposits) {
    if (dep.amount <= 0) continue;
    if (kind && dep.kind !== kind) continue;
    const dist = Math.hypot(dep.gx - x, dep.gy - y);
    if (dist <= bestD) { bestD = dist; best = dep; }
  }
  return best;
}

/** transfer up to `cap − carry` units from a deposit into the agent's hands;
 *  owns the depleted-node filter. Returns the units picked. */
export function pickupFromDeposit(
  s: ColonyState, agent: CarryAgent, dep: DepositInstance, cap: number,
): number {
  const amt = Math.min(dep.amount, cap - agent.carryAmt);
  if (amt <= 0) return 0;
  dep.amount -= amt;
  agent.carryAmt += amt;
  agent.carryKind = dep.kind;
  s.deposits = s.deposits.filter((d) => d.amount > 0.001);
  return amt;
}

/** bank the whole load into its pool (via DEPOSIT_YIELD) and empty the hands */
export function dropCarryAtDepot(s: ColonyState, agent: CarryAgent): void {
  if (agent.carryAmt > 0 && agent.carryKind) {
    addToPool(s, DEPOSIT_YIELD[agent.carryKind], agent.carryAmt);
  }
  agent.carryAmt = 0;
  agent.carryKind = null;
}

// ---- multi-kind cargo (the rover's bays — kinds stack side by side) ---------

/** the fixed order a multi-kind bed banks in at the depot — determinism by
 *  declaration, never object-key iteration */
export const CARGO_KINDS: DepositKind[] = ["ice", "ore", "cache"];

/** total units across a multi-kind cargo bed */
export function cargoTotal(cargo: Partial<Record<DepositKind, number>>): number {
  let t = 0;
  for (const k of CARGO_KINDS) t += cargo[k] ?? 0;
  return t;
}

/** transfer up to `cap − total` units from a deposit into a multi-kind cargo
 *  bed (no kind lock — unlike a suit's hands). Returns the units taken. */
export function pickupIntoCargo(
  s: ColonyState, cargo: Partial<Record<DepositKind, number>>, dep: DepositInstance, cap: number,
): number {
  const amt = Math.min(dep.amount, cap - cargoTotal(cargo));
  if (amt <= 0) return 0;
  dep.amount -= amt;
  cargo[dep.kind] = (cargo[dep.kind] ?? 0) + amt;
  s.deposits = s.deposits.filter((d) => d.amount > 0.001);
  return amt;
}

/** bank EVERY bay into its pool (via DEPOSIT_YIELD) in CARGO_KINDS order,
 *  emptying the bed — one press at the depot clears the whole load */
export function dropCargoAtDepot(
  s: ColonyState, cargo: Partial<Record<DepositKind, number>>,
): void {
  for (const k of CARGO_KINDS) {
    const amt = cargo[k] ?? 0;
    if (amt > 0) addToPool(s, DEPOSIT_YIELD[k], amt);
    delete cargo[k];
  }
}

/** route around buildings toward a goal: one waypoint of BFS path per tick */
function walkToward(s: ColonyState, a: GatherAgent, goal: Pt, speed: number, dt: number): void {
  const path = findPath(s, Math.round(a.x), Math.round(a.y), Math.round(goal.x), Math.round(goal.y));
  const wp: Pt = path && path.length > 1 ? { x: path[1][0], y: path[1][1] } : goal;
  stepToward(a, wp, speed, dt);
}

/** the pool a kind banks into, for the need ranking (ore → the materials bank) */
function poolFor(s: ColonyState, kind: DepositKind): { amount: number; capacity: number } {
  const target = DEPOSIT_YIELD[kind];
  return target === "materials" ? s.materials : s.pools[target];
}

/** the fixed tie order — survival first: food, then water, then build currency */
const NEED_TIE_ORDER: DepositKind[] = ["cache", "ice", "ore"];

/** deposit kinds ranked by colony need: ascending fill fraction of each kind's
 *  destination pool (the emptiest pool eats first). A pure derivation of state
 *  — zero RNG draws — so replay/save/lockstep hold; exact ties break in
 *  NEED_TIE_ORDER (stable sort), making the ranking total and deterministic. */
export function kindsByNeed(s: ColonyState): DepositKind[] {
  const fill = (k: DepositKind): number => {
    const p = poolFor(s, k);
    return p.capacity > 0 ? p.amount / p.capacity : 1;
  };
  return [...NEED_TIE_ORDER].sort((a, b) => fill(a) - fill(b));
}

/** the nearest live node OF ONE KIND by distance-squared (tie → lowest id),
 *  skipping nodes claimed by other agents and falling back to sharing the
 *  nearest when every node of the kind is claimed. Claims the pick. */
function claimNearestOfKind(
  s: ColonyState, a: GatherAgent, claimed: Set<number>, kind: DepositKind,
): DepositInstance | null {
  let best: DepositInstance | null = null, bestD = Infinity;       // unclaimed
  let bestAny: DepositInstance | null = null, bestAnyD = Infinity; // any node
  for (const dep of s.deposits) {
    if (dep.amount <= 0 || dep.kind !== kind) continue;
    const d2 = (dep.gx - a.x) ** 2 + (dep.gy - a.y) ** 2;
    if (d2 < bestAnyD || (d2 === bestAnyD && bestAny != null && dep.id < bestAny.id)) {
      bestAnyD = d2; bestAny = dep;
    }
    if (claimed.has(dep.id)) continue;
    if (d2 < bestD || (d2 === bestD && best != null && dep.id < best.id)) {
      bestD = d2; best = dep;
    }
  }
  const pick = best ?? bestAny;
  if (pick) {
    a.gatherDepositId = pick.id;
    a.gatherT = 0;
    claimed.add(pick.id);
  }
  return pick;
}

/** the agent's deposit target this tick. Sticky: the current claim holds while
 *  its node lives. A carrying agent only considers its own kind — one load,
 *  one pool. An EMPTY-HANDED agent serves the colony's scarcest pool first
 *  (kindsByNeed), falling through to the next-scarcest kind whenever the field
 *  has no live node of one; within a kind the pick is the nearest by
 *  distance-squared (tie → lowest id), unclaimed preferred, sharing the
 *  nearest when every node of the kind is claimed. */
function gatherTarget(s: ColonyState, a: GatherAgent, claimed: Set<number>): DepositInstance | null {
  if (a.gatherDepositId != null) {
    const cur = s.deposits.find((d) => d.id === a.gatherDepositId && d.amount > 0);
    if (cur) return cur;
    a.gatherDepositId = null;
    a.gatherT = 0;
  }
  if (a.carryKind) return claimNearestOfKind(s, a, claimed, a.carryKind);
  for (const kind of kindsByNeed(s)) {
    const pick = claimNearestOfKind(s, a, claimed, kind);
    if (pick) return pick;
  }
  return null;
}

/** the depot leg: haul the load home and bank it the moment it's in range */
function haulToDepot(s: ColonyState, a: GatherAgent, dt: number, opts: GatherOpts): true {
  a.state = "hauling";
  const d = depotCenter(s);
  if (Math.hypot(d.x - a.x, d.y - a.y) <= DEPOT_RADIUS) {
    dropCarryAtDepot(s, a);
    return true;
  }
  walkToward(s, a, d, opts.speed, dt);
  return true;
}

/** One agent-tick of the gather brain: walk to the claimed deposit
 *  ("gathering"), dwell at it ("mining"), pick up to carryCap, haul the load
 *  to the depot ("hauling"), drop instantly, repeat. Returns false when there
 *  is no gather work at all (empty hands and no live node to target) so the
 *  caller can fall through to its idle behavior. */
export function stepGatherer(
  s: ColonyState, a: GatherAgent, dt: number, claimed: Set<number>, opts: GatherOpts,
): boolean {
  // full hands → bank the load (the sticky claim survives for the return trip)
  if (a.carryAmt >= opts.carryCap - 1e-9) return haulToDepot(s, a, dt, opts);

  const dep = gatherTarget(s, a, claimed);
  if (dep) {
    if (Math.hypot(dep.gx - a.x, dep.gy - a.y) <= PICKUP_RADIUS) {
      a.state = "mining";
      a.gatherT += dt;
      if (a.gatherT >= opts.dwell) {
        a.gatherT = 0;
        pickupFromDeposit(s, a, dep, opts.carryCap);
      }
    } else {
      a.state = "gathering";
      a.gatherT = 0;
      walkToward(s, a, { x: dep.gx, y: dep.gy }, opts.speed, dt);
    }
    return true;
  }
  // carrying with no same-kind node left → bank what we have
  if (a.carryAmt > 0) return haulToDepot(s, a, dt, opts);
  return false;
}
