/* ============================================================================
   The pressure seal — which buildings share a hub's atmosphere (doc §2.3).
   A flood-fill, not a flow simulation: SimCity's road check, reskinned.

   Rule: every hub seeds the flood. The seal passes cell to cell (4-neighbour)
   through hubs, corridors, and sealed buildings (requiresPressure), so docked
   modules share it and a second hub runs its own network. Surface buildings
   neither need nor pass the seal and are never marked connected.

   Pure and deterministic (fixed neighbour and scan order, no RNG, no clock):
   the tick's connectivity pass and the main thread's placement preview run the
   same code, on engine state and on snapshots alike.
   ============================================================================ */
import { DEFS } from "./defs";
import { cellsFor } from "./grid";

/** the building fields the seal reads — engine BuildingState and snapshot buildings both fit */
export interface SealBuilding {
  uid: number;
  defId: string;
  gx: number;
  gy: number;
}

export interface SealNetwork {
  /** cell indices (y * N + x) the seal reaches */
  cells: Set<number>;
  /** uids of the buildings it reaches: hubs, corridors, and sealed buildings */
  connected: Set<number>;
}

const NB: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** does a building of this def carry the seal on to its neighbours? */
export function passesSeal(defId: string): boolean {
  const d = DEFS[defId];
  return !!d && (!!d.isHub || !!d.conduit || !!d.requiresPressure);
}

/** cell index → the building covering it, from footprints (off-grid cells skipped) */
export function occupancyOf<B extends SealBuilding>(N: number, buildings: readonly B[]): Map<number, B> {
  const out = new Map<number, B>();
  for (const b of buildings) {
    const d = DEFS[b.defId];
    if (!d) continue;
    for (const [x, y] of cellsFor(d, b.gx, b.gy)) {
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      out.set(y * N + x, b);
    }
  }
  return out;
}

/** flood the seal from every hub through hubs, corridors, and sealed buildings */
export function sealNetwork(N: number, buildings: readonly SealBuilding[]): SealNetwork {
  const occ = occupancyOf(N, buildings);
  const cells = new Set<number>();
  const connected = new Set<number>();
  const queue: number[] = [];
  for (const b of buildings) {
    const d = DEFS[b.defId];
    if (!d?.isHub) continue;
    connected.add(b.uid);
    for (const [x, y] of cellsFor(d, b.gx, b.gy)) {
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      const k = y * N + x;
      if (!cells.has(k)) { cells.add(k); queue.push(k); }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head];
    const x = k % N, y = (k - x) / N;
    for (const [ox, oy] of NB) {
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nk = ny * N + nx;
      if (cells.has(nk)) continue;
      const nb = occ.get(nk);
      if (!nb || !passesSeal(nb.defId)) continue;
      cells.add(nk);
      connected.add(nb.uid);
      queue.push(nk);
    }
  }
  return { cells, connected };
}

/** how a new sealed building joins the network */
export type SealPlan =
  | { kind: "touching" }
  | { kind: "corridor"; path: [number, number][]; newCells: [number, number][]; cost: number }
  | { kind: "no-route" };

/**
 * The shortest corridor from a building's footprint to the sealed network.
 * `touching`: a footprint cell already borders the network. `corridor`: a
 * breadth-first search from the free cells around the footprint (footprint
 * scan order × NB order, so the answer is deterministic) through empty cells
 * and unconnected corridors (reused for free) to the first cell that borders
 * the network; `newCells` are the empty cells on that path, priced at the
 * corridor's matCost each. `no-route`: there is no network, or it is walled
 * off. The footprint is treated as occupied, so the building need not be
 * placed yet.
 */
export function planSealRoute(
  N: number,
  buildings: readonly SealBuilding[],
  network: SealNetwork,
  footprint: readonly [number, number][],
): SealPlan {
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < N && y < N;
  const bordersNetwork = (x: number, y: number): boolean => {
    for (const [ox, oy] of NB) {
      const nx = x + ox, ny = y + oy;
      if (inBounds(nx, ny) && network.cells.has(ny * N + nx)) return true;
    }
    return false;
  };
  if (footprint.some(([x, y]) => bordersNetwork(x, y))) return { kind: "touching" };
  if (network.cells.size === 0) return { kind: "no-route" };

  const occ = occupancyOf(N, buildings);
  const inFoot = new Set(footprint.map(([x, y]) => y * N + x));
  const passable = (x: number, y: number): boolean => {
    if (!inBounds(x, y)) return false;
    const k = y * N + x;
    if (inFoot.has(k)) return false;
    const b = occ.get(k);
    if (!b) return true;
    return !!DEFS[b.defId]?.conduit && !network.cells.has(k); // a dangling corridor
  };

  const prev = new Map<number, number>(); // cell → the cell it was reached from (-1 for a start cell)
  const queue: number[] = [];
  for (const [x, y] of footprint) {
    for (const [ox, oy] of NB) {
      const nx = x + ox, ny = y + oy;
      if (!passable(nx, ny)) continue;
      const k = ny * N + nx;
      if (prev.has(k)) continue;
      prev.set(k, -1);
      queue.push(k);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const k = queue[head];
    const x = k % N, y = (k - x) / N;
    if (bordersNetwork(x, y)) {
      const path: [number, number][] = [];
      for (let c = k; c !== -1; c = prev.get(c)!) path.push([c % N, Math.floor(c / N)]);
      path.reverse();
      const newCells = path.filter(([px, py]) => !occ.has(py * N + px));
      return { kind: "corridor", path, newCells, cost: newCells.length * (DEFS.corridor?.matCost ?? 0) };
    }
    for (const [ox, oy] of NB) {
      const nx = x + ox, ny = y + oy;
      if (!passable(nx, ny)) continue;
      const nk = ny * N + nx;
      if (prev.has(nk)) continue;
      prev.set(nk, k);
      queue.push(nk);
    }
  }
  return { kind: "no-route" };
}

/** a plan priced for the player: what the whole placement costs and whether it is affordable */
export type SealPreview =
  | { kind: "touching" }
  | { kind: "corridor"; path: [number, number][]; cells: number; cost: number; total: number; affordable: boolean }
  | { kind: "no-route" };

export function sealPreview(plan: SealPlan, buildingCost: number, materials: number): SealPreview {
  if (plan.kind !== "corridor") return plan;
  const total = buildingCost + plan.cost;
  return { kind: "corridor", path: plan.path, cells: plan.newCells.length, cost: plan.cost, total, affordable: total <= materials };
}
