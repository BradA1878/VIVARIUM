/* ============================================================================
   Grid pathfinding for colonists, gatherers, and robots — a deterministic
   4-direction BFS over free cells (building footprints block). Pure results,
   no RNG, so routes replay identically.

   Hot path: every moving agent calls this every tick (colonists.ts walk-to-
   goal, gather.ts walkToward for colonists AND robots), so the BFS scratch —
   visited marks, predecessor table, ring queue — is module-scoped and reused
   across calls instead of allocated per call (~3 KB × agents × 30 Hz of GC
   churn otherwise). A GENERATION STAMP invalidates the visited marks in O(1)
   per call: a cell is "seen" only if its stamp equals this call's generation,
   so no per-call fill and no residue between searches, states, or grid sizes.
   Every call is self-contained — the shared scratch never changes a result
   (pathfind.test.ts pins byte-identical paths across interleaved calls).
   ============================================================================ */
import { idx } from "./grid";
import type { ColonyState } from "./state";

const NEI: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function inB(N: number, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < N && y < N;
}

// ---- reusable scratch (grows to the largest grid seen; generation-stamped) ----
let cap = 0;
let prev = new Int32Array(0);
let seenGen = new Int32Array(0);
let gen = 0;
const queue: number[] = [];

/** Shortest free-cell path from (sx,sy) to (tx,ty), inclusive of both ends, or
 *  null if unreachable. The target cell is allowed even if occupied (a colonist
 *  may aim at a building's own cell); every intermediate cell must be empty. The
 *  start may itself be occupied — we still BFS outward from it. */
export function findPath(s: ColonyState, sx: number, sy: number, tx: number, ty: number): [number, number][] | null {
  const N = s.N;
  if (!inB(N, sx, sy) || !inB(N, tx, ty)) return null;
  if (sx === tx && sy === ty) return [[sx, sy]];

  const size = N * N;
  if (size > cap) {
    cap = size;
    prev = new Int32Array(size);
    seenGen = new Int32Array(size); // zeroed → stamps start clean
    gen = 0;
  }
  if (gen === 0x7fffffff) { seenGen.fill(0); gen = 0; } // stamp wrap (theoretical)
  gen++;

  const start = sy * N + sx;
  seenGen[start] = gen;
  prev[start] = -1;
  queue.length = 0;
  queue.push(start);
  let head = 0;

  while (head < queue.length) {
    const cur = queue[head++];
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
      queue.length = 0; // release references to this search's frontier
      return path.reverse();
    }
    for (const [dx, dy] of NEI) {
      const nx = cx + dx, ny = cy + dy;
      if (!inB(N, nx, ny)) continue;
      const ni = ny * N + nx;
      if (seenGen[ni] === gen) continue;
      seenGen[ni] = gen;
      const isTarget = nx === tx && ny === ty;
      if (!isTarget && s.grid[idx(N, nx, ny)] !== 0) continue; // blocked
      prev[ni] = cur;
      queue.push(ni);
    }
  }
  queue.length = 0;
  return null;
}
