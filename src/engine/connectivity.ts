/* ============================================================================
   Connectivity is a boolean gate (doc §2.3). A requiresPressure building is
   "online" only if a flood-fill from the hub reaches it through adjacent
   pressurized conduits (corridors) or the hub itself. We are explicitly NOT
   simulating flow through pipes — this is SimCity's road check, reskinned.
   ============================================================================ */
import { DEFS } from "./defs";
import { cellsFor, idx } from "./grid";
import type { ColonyState } from "./state";

const NB: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

export function recomputeConnectivity(s: ColonyState): void {
  for (const b of s.buildings) b.connected = false;

  const hub = s.buildings.find((b) => DEFS[b.defId].isHub);
  if (!hub) return;

  // Flood the seal across hub + conduit cells.
  const reached = new Set<number>();
  const q: [number, number][] = [];
  const seed = (gx: number, gy: number, foot: [number, number]) => {
    for (let dx = 0; dx < foot[0]; dx++)
      for (let dy = 0; dy < foot[1]; dy++) {
        const x = gx + dx, y = gy + dy, k = idx(s.N, x, y);
        if (!reached.has(k)) { reached.add(k); q.push([x, y]); }
      }
  };
  seed(hub.gx, hub.gy, DEFS[hub.defId].foot);
  hub.connected = true;

  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [ox, oy] of NB) {
      const nx = x + ox, ny = y + oy;
      if (nx < 0 || ny < 0 || nx >= s.N || ny >= s.N) continue;
      const k = idx(s.N, nx, ny);
      const id = s.grid[k];
      if (id === 0 || reached.has(k)) continue;
      const nb = s.buildings.find((b) => b.uid === id);
      if (!nb) continue;
      const def = DEFS[nb.defId];
      // conduits and the hub extend the seal; habs/units only attach.
      if (def.isHub || def.conduit) {
        reached.add(k);
        q.push([nx, ny]);
        nb.connected = true;
      }
    }
  }

  // Attach any pressurized building adjacent to the reached seal.
  for (const b of s.buildings) {
    if (b.connected) continue;
    const def = DEFS[b.defId];
    for (const [x, y] of cellsFor(def, b.gx, b.gy)) {
      for (const [ox, oy] of NB) {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= s.N || ny >= s.N) continue;
        if (reached.has(idx(s.N, nx, ny))) { b.connected = true; break; }
      }
      if (b.connected) break;
    }
  }
}
