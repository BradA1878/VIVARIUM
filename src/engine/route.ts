/* ============================================================================
   Corridor auto-routing — a pure axis-aligned BFS from one building's door to
   another's. Used twice over the same code: the worker runs it on its
   authoritative grid to place corridors; the main thread runs it on snapshot-
   derived occupancy to preview the ghost. (Doc: agent/UI never mutates the tick.)
   ============================================================================ */
import type { BuildingState } from "@shared/types";
import { DEFS } from "./defs";
import { doorCellsOf } from "./doors";

const NB: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

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

/** Resolve two buildings' door exits and route between them. `isBlocked`
 *  excludes the two endpoint exit cells (a corridor may sit there). */
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
  const da = doorCellsOf(DEFS[a.defId], a);
  const db = doorCellsOf(DEFS[b.defId], b);
  if (!da || !db) return null; // both endpoints must have a door

  const eq = (x: number, y: number, c: [number, number]) => x === c[0] && y === c[1];
  const q: RouteQuery = {
    N,
    isBlocked: (x, y) =>
      eq(x, y, da.exit) || eq(x, y, db.exit) ? false : isBlocked(x, y),
  };
  return routeCorridor(q, da.exit, db.exit);
}
