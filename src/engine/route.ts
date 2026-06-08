/* ============================================================================
   Corridor auto-routing — a pure axis-aligned BFS from one building's door to
   another's. Used twice over the same code: the worker runs it on its
   authoritative grid to place corridors; the main thread runs it on snapshot-
   derived occupancy to preview the ghost. (Doc: agent/UI never mutates the tick.)
   ============================================================================ */
import type { BuildingState } from "@shared/types";
import { DEFS } from "./defs";
import { cellsFor } from "./grid";

const NB: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** the in-bounds cells orthogonally adjacent to a building's footprint — the
 *  candidate points a corridor can attach to. Deterministic order. */
function perimeter(b: BuildingState, N: number): [number, number][] {
  const def = DEFS[b.defId];
  if (!def) return [];
  const foot = cellsFor(def, b.gx, b.gy);
  const inFoot = new Set(foot.map(([x, y]) => `${x},${y}`));
  const out: [number, number][] = [];
  const seen = new Set<string>();
  for (const [cx, cy] of foot) {
    for (const [ox, oy] of NB) {
      const nx = cx + ox, ny = cy + oy, k = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      if (inFoot.has(k) || seen.has(k)) continue;
      seen.add(k);
      out.push([nx, ny]);
    }
  }
  return out;
}

export interface RouteQuery {
  N: number;
  /** is cell (x,y) impassable for a corridor? (occupied by a non-corridor) */
  isBlocked(x: number, y: number): boolean;
}

/** BFS from `from` to `to` through unblocked, in-bounds cells (4-neighbour).
 *  Returns the inclusive path, or null if there's no route. */
export function routeCorridor(
  q: RouteQuery,
  from: [number, number],
  to: [number, number],
): [number, number][] | null {
  const key = (x: number, y: number) => y * q.N + x;
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < q.N && y < q.N;
  const passable = (x: number, y: number) => inBounds(x, y) && !q.isBlocked(x, y);

  if (!passable(from[0], from[1]) || !passable(to[0], to[1])) return null;

  const start = key(from[0], from[1]);
  const goal = key(to[0], to[1]);
  if (start === goal) return [from];

  const prev = new Map<number, number>();
  const seen = new Set<number>([start]);
  let frontier: [number, number][] = [from];

  while (frontier.length) {
    const next: [number, number][] = [];
    for (const [x, y] of frontier) {
      for (const [ox, oy] of NB) {
        const nx = x + ox, ny = y + oy, k = key(nx, ny);
        if (seen.has(k) || !passable(nx, ny)) continue;
        seen.add(k);
        prev.set(k, key(x, y));
        if (k === goal) {
          // reconstruct
          const path: [number, number][] = [[nx, ny]];
          let cur = k;
          while (cur !== start) {
            const p = prev.get(cur)!;
            path.push([p % q.N, Math.floor(p / q.N)]);
            cur = p;
          }
          return path.reverse();
        }
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return null;
}

/** Route a corridor between two buildings along the SHORTEST path between their
 *  nearest free faces (not their doors), so a run never has to wrap around a
 *  building to reach a door that happens to face away. Doors stay a visual detail;
 *  the junction airlock marks wherever the corridor actually meets the wall.
 *  `isBlocked` excludes the two chosen endpoint cells (a corridor may sit there). */
export function planRoute(
  buildings: BuildingState[],
  N: number,
  isBlocked: (x: number, y: number) => boolean,
  fromUid: number,
  toUid: number,
): [number, number][] | null {
  const a = buildings.find((b) => b.uid === fromUid);
  const b = buildings.find((b) => b.uid === toUid);
  if (!a || !b) return null;

  // candidate attach cells = each building's free perimeter
  const aP = perimeter(a, N).filter(([x, y]) => !isBlocked(x, y));
  const bP = perimeter(b, N).filter(([x, y]) => !isBlocked(x, y));
  if (!aP.length || !bP.length) return null;

  // pick the closest pair of faces (Manhattan; deterministic scan-order tie-break)
  let from: [number, number] | null = null, to: [number, number] | null = null, bestD = Infinity;
  for (const pa of aP) {
    for (const pb of bP) {
      const d = Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]);
      if (d < bestD) { bestD = d; from = pa; to = pb; }
    }
  }
  if (!from || !to) return null;

  const f = from, t = to;
  const eq = (x: number, y: number, c: [number, number]) => x === c[0] && y === c[1];
  const q: RouteQuery = {
    N,
    isBlocked: (x, y) => (eq(x, y, f) || eq(x, y, t) ? false : isBlocked(x, y)),
  };
  return routeCorridor(q, f, t);
}
