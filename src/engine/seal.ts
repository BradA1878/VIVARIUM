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
