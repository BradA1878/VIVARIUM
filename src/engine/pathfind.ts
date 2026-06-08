/* ============================================================================
   Grid pathfinding for colonists — a deterministic 4-direction BFS over free
   cells (building footprints block). Pure, no RNG, so colonist routes replay
   identically. Cheap: N×N is tiny and only the handful of colonists call it.
   ============================================================================ */
import { idx } from "./grid";
import type { ColonyState } from "./state";

const NEI: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function inB(N: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < N && y < N;
}

/** Shortest free-cell path from (sx,sy) to (tx,ty), inclusive of both ends, or
 *  null if unreachable. The target cell is allowed even if occupied (a colonist
 *  may aim at a building's own cell); every intermediate cell must be empty. The
 *  start may itself be occupied — we still BFS outward from it. */
export function findPath(s: ColonyState, sx: number, sy: number, tx: number, ty: number): [number, number][] | null {
  const N = s.N;
  if (!inB(N, sx, sy) || !inB(N, tx, ty)) return null;
  if (sx === tx && sy === ty) return [[sx, sy]];

  const prev = new Int32Array(N * N).fill(-1);
  const seen = new Uint8Array(N * N);
  const start = sy * N + sx;
  seen[start] = 1;
  const q: number[] = [start];
  let head = 0;

  while (head < q.length) {
    const cur = q[head++];
    const cx = cur % N;
    const cy = (cur - cx) / N;
    if (cx === tx && cy === ty) {
      const path: [number, number][] = [];
      let p = cur;
      while (p !== -1) {
        const px = p % N;
        path.push([px, (p - px) / N]);
        p = prev[p];
      }
      return path.reverse();
    }
    for (const [dx, dy] of NEI) {
      const nx = cx + dx, ny = cy + dy;
      if (!inB(N, nx, ny)) continue;
      const ni = ny * N + nx;
      if (seen[ni]) continue;
      seen[ni] = 1;
      const isTarget = nx === tx && ny === ty;
      if (!isTarget && s.grid[idx(N, nx, ny)] !== 0) continue; // blocked
      prev[ni] = cur;
      q.push(ni);
    }
  }
  return null;
}
