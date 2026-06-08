/* ============================================================================
   Colonists on the surface — deterministic motion + gathering (doc §0 wall).
   The possessed colonist integrates the player's moveIntent and auto-mines /
   auto-unloads by proximity; the rest follow a tod/hazard state machine toward
   the job the engine already decided they staff. No Math.random, no Date.now —
   movement is a pure function of state + dt, so replay/save/determinism hold.

   Colonists REFLECT the existing staffing/population decisions; they never change
   the resource math (that lives in tick.ts), so the existing passes are untouched.
   ============================================================================ */
import type {
  ColonistView, DepositView, Resource,
} from "@shared/types";
import { DEPOSIT_YIELD } from "@shared/types";
import { DEFS } from "./defs";
import {
  WALK_SPEED, PILOT_SPEED, ARRIVE_EPS, CARRY_CAP, MINE_RATE, UNLOAD_RATE,
  MINE_RADIUS, BASE_RADIUS, DAY_START, DAY_END, MATERIALS_CAP,
} from "./tuning";
import type { ColonistInstance, ColonyState } from "./state";
import { emptyColonist } from "./state";
import { idx, inBounds, cellsFor } from "./grid";
import { doorCells } from "./doors";
import { findPath } from "./pathfind";

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

interface Pt { x: number; y: number }

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
function accessCell(s: ColonyState, b: { defId: string; gx: number; gy: number; rot?: number }): Pt {
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

/** an empty cell nearest a point — where new arrivals spawn (not on a building) */
function freeCellNear(s: ColonyState, p: Pt): Pt {
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

/** move a colonist toward a target; returns true once it has arrived */
function stepToward(c: ColonistInstance, t: Pt, speed: number, dt: number): boolean {
  const dx = t.x - c.x, dy = t.y - c.y;
  const d = Math.hypot(dx, dy);
  if (d <= ARRIVE_EPS) return true;
  const step = Math.min(d, speed * dt);
  c.x += (dx / d) * step;
  c.y += (dy / d) * step;
  c.facing = Math.atan2(dx, dy);
  return false;
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
 *  Slots come from buildings that need staffing, in uid order; colonists fill them
 *  in id order. Surplus colonists idle at a hab. */
function assign(s: ColonyState): void {
  const slots: number[] = [];
  const byUid = [...s.buildings].sort((a, b) => a.uid - b.uid);
  for (const b of byUid) {
    const d = DEFS[b.defId];
    if (d && d.staffing > 0) for (let k = 0; k < d.staffing; k++) slots.push(b.uid);
  }
  const habs = byUid.filter((b) => (DEFS[b.defId]?.popCap ?? 0) > 0);
  const colonists = [...s.colonists].sort((a, b) => a.id - b.id);
  colonists.forEach((c, i) => {
    c.workUid = i < slots.length ? slots[i] : null;
    c.homeUid = habs.length ? habs[i % habs.length].uid : (hub(s)?.gx != null ? null : null);
  });
}

function buildingByUid(s: ColonyState, uid: number | null): { defId: string; gx: number; gy: number; rot?: number } | null {
  if (uid == null) return null;
  return s.buildings.find((b) => b.uid === uid) ?? null;
}

function addToPool(s: ColonyState, target: Resource | "materials", amt: number): void {
  const p = target === "materials" ? s.materials : s.pools[target];
  p.amount = Math.min(p.capacity, p.amount + amt);
}

/** the possessed colonist: integrate moveIntent, then auto-mine / auto-unload */
function pilot(s: ColonyState, c: ColonistInstance, dt: number): void {
  const { dx, dy } = s.moveIntent;
  const m = Math.hypot(dx, dy);
  if (m > 0.0001) {
    c.x = clamp(c.x + (dx / m) * PILOT_SPEED * dt, 0, s.N - 1);
    c.y = clamp(c.y + (dy / m) * PILOT_SPEED * dt, 0, s.N - 1);
    c.facing = Math.atan2(dx, dy);
  }
  c.state = "piloted";

  // auto-mine: standing on a deposit, carry not full, same kind (or empty-handed)
  let mined = false;
  if (c.carryAmt < CARRY_CAP) {
    for (const dep of s.deposits) {
      if (dep.amount <= 0) continue;
      if (c.carryKind && c.carryKind !== dep.kind) continue;
      const dist = Math.hypot(dep.gx - c.x, dep.gy - c.y);
      if (dist > MINE_RADIUS) continue;
      const amt = Math.min(MINE_RATE * dt, dep.amount, CARRY_CAP - c.carryAmt);
      dep.amount -= amt;
      c.carryAmt += amt;
      c.carryKind = dep.kind;
      c.state = "mining";
      mined = true;
      break;
    }
    s.deposits = s.deposits.filter((d) => d.amount > 0.001);
  }

  // auto-unload: carrying, near the hub → drop into the matching pool
  if (!mined && c.carryAmt > 0) {
    const b = baseCenter(s);
    if (Math.hypot(b.x - c.x, b.y - c.y) <= BASE_RADIUS && c.carryKind) {
      const amt = Math.min(UNLOAD_RATE * dt, c.carryAmt);
      addToPool(s, DEPOSIT_YIELD[c.carryKind], amt);
      c.carryAmt -= amt;
      c.state = "hauling";
      if (c.carryAmt <= 0.001) { c.carryAmt = 0; c.carryKind = null; }
    }
  }
}

/** the tick's colonist pass — runs after staffing/casualties are resolved */
export function stepColonists(s: ColonyState, dt: number): void {
  reconcileColonists(s);
  assign(s);

  const hazardActive = s.hazards.some((h) => h.phase === "active");
  const day = s.tod > DAY_START && s.tod < DAY_END;

  for (const c of s.colonists) {
    if (c.id === s.possessed) { pilot(s, c, dt); continue; }

    let goal: Pt;
    let arriveState: ColonistInstance["state"];
    if (hazardActive) {
      goal = nearestShelter(s, c); arriveState = "sheltering";
    } else if (day && c.workUid != null) {
      const w = buildingByUid(s, c.workUid);
      goal = w ? accessCell(s, w) : baseCenter(s); arriveState = "working";
    } else {
      const home = buildingByUid(s, c.homeUid);
      goal = home ? accessCell(s, home) : freeCellNear(s, baseCenter(s)); arriveState = "idle";
    }

    if (Math.hypot(goal.x - c.x, goal.y - c.y) <= ARRIVE_EPS) { c.state = arriveState; continue; }

    // route around buildings; walk toward the next cell on the path
    const path = findPath(s, Math.round(c.x), Math.round(c.y), Math.round(goal.x), Math.round(goal.y));
    const wp: Pt = path && path.length > 1 ? { x: path[1][0], y: path[1][1] } : goal;
    stepToward(c, wp, WALK_SPEED, dt);
    c.state = arriveState === "working" ? "toWork" : arriveState === "sheltering" ? "sheltering" : "toHome";
  }
}

export function colonistViews(s: ColonyState): ColonistView[] {
  return s.colonists.map((c) => ({
    id: c.id, x: c.x, y: c.y, facing: c.facing, state: c.state,
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
