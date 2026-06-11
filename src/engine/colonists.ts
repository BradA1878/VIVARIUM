/* ============================================================================
   Colonists on the surface — deterministic motion + gathering (doc §0 wall).
   The possessed colonist integrates the player's moveIntent and picks up /
   drops explicitly (interactPossessed); the rest follow a tod/hazard state
   machine toward the job the engine already decided they staff — and the idle
   ones work the deposit field on their own (engine/gather.ts). No Math.random,
   no Date.now — movement is a pure function of state + dt, so replay/save/
   determinism hold.

   Colonists REFLECT the existing staffing/population decisions; they never
   change the recipe math (that lives in tick.ts) — gather credits land in the
   pools like resupply does, outside net flow, so the existing passes are
   untouched.
   ============================================================================ */
import type { ColonistView, DepositView } from "@shared/types";
import { DEFS } from "./defs";
import {
  WALK_SPEED, PILOT_SPEED, ARRIVE_EPS, CARRY_CAP, DEPOT_RADIUS,
  AUTO_CARRY, GATHER_DWELL, ROVER_CARGO_CAP,
  DAY_START, DAY_END, MATERIALS_CAP, INJURED_SPEED, INJURED_PILOT_FACTOR,
} from "./tuning";
import type { ColonistInstance, ColonyState, DepositInstance } from "./state";
import { buildingFunctional, emptyColonist } from "./state";
import { idx, inBounds, cellsFor } from "./grid";
import { doorCells } from "./doors";
import { findPath } from "./pathfind";
import { BUILDING_ROLE, nameOf, roleOf } from "./roster";
import {
  cargoTotal, depotCenter, dropCargoAtDepot, dropCarryAtDepot,
  nearestDepositInReach, pickupFromDeposit, pickupIntoCargo,
  stepGatherer, stepToward, type Pt,
} from "./gather";

// the gather mechanics live on their own leaf (engine/gather.ts) so colonists
// and (later) robots can share them; re-export the bits that began life here
export { depotCenter } from "./gather";
export type { Pt } from "./gather";

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** continuous center of a building's footprint, in grid-cell coords */
function buildingCenter(b: { defId: string; gx: number; gy: number }): Pt {
  const d = DEFS[b.defId];
  const w = d?.foot[0] ?? 1, h = d?.foot[1] ?? 1;
  return { x: b.gx + (w - 1) / 2, y: b.gy + (h - 1) / 2 };
}

function hub(s: ColonyState): { defId: string; gx: number; gy: number } | null {
  return s.buildings.find((b) => DEFS[b.defId]?.isHub) ?? s.buildings[0] ?? null;
}

/** the colony's anchor point (hub center) — where new arrivals appear + base radius */
export function baseCenter(s: ColonyState): Pt {
  const h = hub(s);
  return h ? buildingCenter(h) : { x: (s.N - 1) / 2, y: (s.N - 1) / 2 };
}

/** a free cell to stand at for a building — its door's exit cell if open, else
 *  the first free orthogonally-adjacent cell, else the (clamped) center. So
 *  colonists wait at the door instead of standing inside the dome. */
export function accessCell(s: ColonyState, b: { defId: string; gx: number; gy: number; rot?: number }): Pt {
  const def = DEFS[b.defId];
  if (def?.door != null) {
    const dc = doorCells(def, b.gx, b.gy, (b.rot ?? 0) as 0 | 1 | 2 | 3);
    if (dc) {
      const [ex, ey] = dc.exit;
      if (inBounds(s.N, ex, ey) && s.grid[idx(s.N, ex, ey)] === 0) return { x: ex, y: ey };
    }
  }
  if (def) {
    for (const [cx, cy] of cellsFor(def, b.gx, b.gy)) {
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = cx + dx, ny = cy + dy;
        if (inBounds(s.N, nx, ny) && s.grid[idx(s.N, nx, ny)] === 0) return { x: nx, y: ny };
      }
    }
  }
  const c = buildingCenter(b);
  return { x: Math.min(s.N - 1, Math.max(0, c.x)), y: Math.min(s.N - 1, Math.max(0, c.y)) };
}

/** nearest treatable medbay's access cell to a point (functional + online), or
 *  null — the triage target for the wounded (engine/injury.ts does the healing) */
function nearestMedbay(s: ColonyState, p: Pt): Pt | null {
  let best: Pt | null = null, bestD = Infinity;
  for (const b of s.buildings) {
    if (b.defId !== "medbay" || !b.online || !buildingFunctional(b)) continue;
    const cell = accessCell(s, b);
    const dist = (cell.x - p.x) ** 2 + (cell.y - p.y) ** 2;
    if (dist < bestD) { bestD = dist; best = cell; }
  }
  return best;
}

/** nearest sealed building's access cell to a point (shelter target in a hazard) */
function nearestShelter(s: ColonyState, p: Pt): Pt {
  let best: { defId: string; gx: number; gy: number; rot?: number } | null = null, bestD = Infinity;
  for (const b of s.buildings) {
    const d = DEFS[b.defId];
    if (!d || !(d.requiresPressure || d.isHub)) continue;
    const c = buildingCenter(b);
    const dist = (c.x - p.x) ** 2 + (c.y - p.y) ** 2;
    if (dist < bestD) { bestD = dist; best = b; }
  }
  return best ? accessCell(s, best) : baseCenter(s);
}

/** an empty cell nearest a point — where new arrivals spawn and fresh rovers
 *  roll out (never on a building) */
export function freeCellNear(s: ColonyState, p: Pt): Pt {
  const ri = Math.round(p.x), rj = Math.round(p.y);
  for (let r = 0; r < s.N; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; // current ring only
      const x = ri + dx, y = rj + dy;
      if (inBounds(s.N, x, y) && s.grid[idx(s.N, x, y)] === 0) return { x, y };
    }
  }
  return p;
}

/** keep the colonist roster equal to the population (arrivals add, casualties
 *  remove) — deterministic: new colonists spawn at the hub, removals drop the
 *  highest id, and losing the possessed colonist clears possession. */
export function reconcileColonists(s: ColonyState): void {
  while (s.colonists.length > s.population) {
    // prefer to keep the possessed colonist alive in the UI; drop another
    let victimIdx = s.colonists.length - 1;
    if (s.colonists[victimIdx].id === s.possessed && s.colonists.length > 1) victimIdx -= 1;
    const removed = s.colonists.splice(victimIdx, 1)[0];
    if (removed.id === s.possessed) s.possessed = null;
  }
  while (s.colonists.length < s.population) {
    const b = freeCellNear(s, baseCenter(s)); // spawn outside, not on the hub
    s.colonists.push(emptyColonist(s.colonistCounter++, b.x, b.y));
  }
}

/** assign each colonist a job (a staffed building slot) + a home, deterministically.
 *  Slots come from buildings that need staffing, in uid order; pass 1 hands each
 *  slot the lowest-id unclaimed colonist whose role matches the building, pass 2
 *  backfills the rest in id order. The injured are off shift — eligible for
 *  neither pass. Surplus colonists idle at a hab. */
function assign(s: ColonyState): void {
  const byUid = [...s.buildings].sort((a, b) => a.uid - b.uid);
  const slots: { uid: number; defId: string }[] = [];
  for (const b of byUid) {
    const d = DEFS[b.defId];
    if (d && d.staffing > 0) for (let k = 0; k < d.staffing; k++) slots.push({ uid: b.uid, defId: b.defId });
  }
  const habs = byUid.filter((b) => (DEFS[b.defId]?.popCap ?? 0) > 0);
  const colonists = [...s.colonists].sort((a, b) => a.id - b.id);

  const workers: (ColonistInstance | null)[] = slots.map(() => null);
  const free = colonists.filter((c) => c.injury <= 0);
  const claim = (i: number, match: (c: ColonistInstance) => boolean): void => {
    const j = free.findIndex(match);
    if (j >= 0) workers[i] = free.splice(j, 1)[0];
  };
  slots.forEach((slot, i) => claim(i, (c) => BUILDING_ROLE[slot.defId] === roleOf(c.id)));
  slots.forEach((_, i) => { if (!workers[i]) claim(i, () => true); });

  for (const c of colonists) c.workUid = null;
  workers.forEach((c, i) => { if (c) c.workUid = slots[i].uid; });
  colonists.forEach((c, i) => {
    c.homeUid = habs.length ? habs[i % habs.length].uid : (hub(s)?.gx != null ? null : null);
  });
}

function buildingByUid(s: ColonyState, uid: number | null): { defId: string; gx: number; gy: number; rot?: number } | null {
  if (uid == null) return null;
  return s.buildings.find((b) => b.uid === uid) ?? null;
}

/** the possessed colonist: just integrate the standing moveIntent. Gathering is
 *  now explicit (interactPossessed), triggered by the player pressing P. */
function pilot(s: ColonyState, c: ColonistInstance, dt: number): void {
  const { dx, dy } = s.moveIntent;
  const m = Math.hypot(dx, dy);
  const speed = c.injury > 0 ? PILOT_SPEED * INJURED_PILOT_FACTOR : PILOT_SPEED;
  if (m > 0.0001) {
    c.x = clamp(c.x + (dx / m) * speed * dt, 0, s.N - 1);
    c.y = clamp(c.y + (dy / m) * speed * dt, 0, s.N - 1);
    c.facing = Math.atan2(dx, dy);
  }
  c.state = "piloted";
}

/** the nearest deposit the possessed colonist could pick up from right now */
export function depositInReach(s: ColonyState, c: ColonistInstance): DepositInstance | null {
  if (c.carryAmt >= CARRY_CAP) return null;
  // hands hold one kind — a carrying colonist only reaches same-kind nodes
  return nearestDepositInReach(s, c.x, c.y, c.carryKind ?? undefined);
}

/** explicit pick up / drop for the possessed actor (the player pressed P) —
 *  dispatched by actor type, since rover ids share the colonist counter.
 *  A COLONIST: drops the full load at the depot if carrying + in range,
 *  otherwise grabs a load from the nearest in-range deposit (one kind).
 *  A ROVER: one press at the depot banks ALL its bays in the fixed kind order;
 *  otherwise it tops the bed up from the nearest deposit of ANY kind. */
export function interactPossessed(s: ColonyState): "picked" | "dropped" | null {
  if (s.possessed == null) return null;

  const r = (s.rovers ?? []).find((x) => x.id === s.possessed);
  if (r) {
    if (cargoTotal(r.cargo) > 0) {
      const d = depotCenter(s);
      if (Math.hypot(d.x - r.x, d.y - r.y) <= DEPOT_RADIUS) {
        dropCargoAtDepot(s, r.cargo);
        return "dropped";
      }
    }
    const dep = nearestDepositInReach(s, r.x, r.y); // any kind — the bays are separate
    if (dep && pickupIntoCargo(s, r.cargo, dep, ROVER_CARGO_CAP) > 0) return "picked";
    return null;
  }

  const c = s.colonists.find((x) => x.id === s.possessed);
  if (!c) return null;

  // drop the whole load at the depot
  if (c.carryAmt > 0 && c.carryKind) {
    const d = depotCenter(s);
    if (Math.hypot(d.x - c.x, d.y - c.y) <= DEPOT_RADIUS) {
      dropCarryAtDepot(s, c);
      return "dropped";
    }
  }

  // otherwise fill the hands from the nearest deposit in reach
  const dep = depositInReach(s, c);
  if (dep) {
    pickupFromDeposit(s, c, dep, CARRY_CAP);
    return "picked";
  }
  return null;
}

/** the tick's colonist pass — runs after staffing/casualties are resolved */
export function stepColonists(s: ColonyState, dt: number): void {
  reconcileColonists(s);
  assign(s);

  const hazardActive = s.hazards.some((h) => h.phase === "active");
  const day = s.tod > DAY_START && s.tod < DAY_END;

  // sticky gather claims this pass — every live claim held by an auto colonist
  // (the possessed one is piloted, so its claim neither acts nor blocks)
  const claimed = new Set<number>();
  for (const c of s.colonists) {
    if (c.id !== s.possessed && c.gatherDepositId != null) claimed.add(c.gatherDepositId);
  }

  for (const c of s.colonists) {
    if (c.id === s.possessed) { pilot(s, c, dt); continue; }

    let goal: Pt;
    let arriveState: ColonistInstance["state"];
    if (hazardActive) {
      goal = nearestShelter(s, c); arriveState = "sheltering";
    } else if (c.injury > 0) {
      // the wounded limp to triage — a treatable medbay's door, else home
      const home = buildingByUid(s, c.homeUid);
      goal = nearestMedbay(s, c)
        ?? (home ? accessCell(s, home) : freeCellNear(s, baseCenter(s)));
      arriveState = "recovering";
    } else if (day && c.workUid != null) {
      const w = buildingByUid(s, c.workUid);
      goal = w ? accessCell(s, w) : baseCenter(s); arriveState = "working";
    } else if (
      // gathering is the day-idle default; a dusk carrier still finishes its
      // depot run before sleeping. stepGatherer returns false when there is
      // no gather work at all → fall through to home/idle.
      (day || c.carryAmt > 0) &&
      stepGatherer(s, c, dt, claimed, { speed: WALK_SPEED, carryCap: AUTO_CARRY, dwell: GATHER_DWELL })
    ) {
      continue; // the gather brain owned movement + state this tick
    } else {
      const home = buildingByUid(s, c.homeUid);
      goal = home ? accessCell(s, home) : freeCellNear(s, baseCenter(s)); arriveState = "idle";
    }

    // any non-gather branch releases the sticky claim — workers, shelterers,
    // and sleepers don't reserve nodes they aren't walking to
    c.gatherDepositId = null;
    c.gatherT = 0;

    if (Math.hypot(goal.x - c.x, goal.y - c.y) <= ARRIVE_EPS) { c.state = arriveState; continue; }

    // route around buildings; walk toward the next cell on the path
    const path = findPath(s, Math.round(c.x), Math.round(c.y), Math.round(goal.x), Math.round(goal.y));
    const wp: Pt = path && path.length > 1 ? { x: path[1][0], y: path[1][1] } : goal;
    stepToward(c, wp, c.injury > 0 ? INJURED_SPEED : WALK_SPEED, dt);
    c.state = arriveState === "working" ? "toWork"
      : arriveState === "sheltering" ? "sheltering"
      : arriveState === "recovering" ? "toMedbay"
      : "toHome";
  }
}

export function colonistViews(s: ColonyState): ColonistView[] {
  return s.colonists.map((c) => ({
    id: c.id, name: nameOf(c.id), role: roleOf(c.id),
    x: c.x, y: c.y, facing: c.facing, state: c.state, injury: c.injury,
    carryKind: c.carryKind, carryAmt: c.carryAmt, possessed: c.id === s.possessed,
  }));
}

export function depositViews(s: ColonyState): DepositView[] {
  return s.deposits.map((d) => ({
    id: d.id, gx: d.gx, gy: d.gy, kind: d.kind, amount: d.amount, max: d.max,
  }));
}

/** clamp materials to its cap (used after construction / trades) */
export function clampMaterials(s: ColonyState): void {
  s.materials.capacity = MATERIALS_CAP;
  s.materials.amount = clamp(s.materials.amount, 0, MATERIALS_CAP);
}
