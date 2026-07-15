/* ============================================================================
   Save serialization (doc §5). The engine's SaveData carries a typed-array grid
   and is structuredClone-friendly for the worker, but NOT JSON-clean. These
   helpers convert it to/from a plain JSON object so it can live in localStorage
   or Mongo. The whole save is tiny: grid, buildings, pools, sol/weather, RNG
   seed+state.
   ============================================================================ */
import type { SaveData } from "@/engine";

/** JSON-safe save: identical to SaveData except grid is a plain number[] */
export interface SaveJSON {
  version: 1;
  seed: number;
  rngState: number;
  envRngState: number;
  state: Omit<SaveData["state"], "grid"> & { grid: number[] };
}

/** SaveData → JSON-safe object (typed-array grid → number[]) */
export function toJSON(save: SaveData): SaveJSON {
  return {
    version: save.version,
    seed: save.seed,
    rngState: save.rngState,
    envRngState: save.envRngState,
    state: { ...save.state, grid: Array.from(save.state.grid) },
  };
}

/** JSON-safe object → SaveData. Colony.load rebuilds the Int32Array from the
 *  number[] grid, so we can hand it through as-is. */
export function fromJSON(json: SaveJSON): SaveData {
  return json as unknown as SaveData;
}

export function encode(save: SaveData): string {
  return JSON.stringify(toJSON(save));
}

/** the shapes Colony.load dereferences UNCONDITIONALLY — everything else it
 *  backfills (legacy saves), so guarding more than this would reject loadable
 *  saves, and guarding less lets a truncated save throw inside the worker. */
function loadable(state: SaveJSON["state"]): boolean {
  if (!state || typeof state !== "object") return false;
  if (typeof state.N !== "number" || typeof state.t !== "number") return false;
  if (!Array.isArray(state.grid) || !Array.isArray(state.buildings)) return false;
  const pools = state.pools as Partial<Record<string, unknown>> | undefined;
  if (!pools || typeof pools !== "object") return false;
  for (const k of ["power", "water", "oxygen", "food"]) if (!pools[k]) return false;
  return true;
}

export function decode(text: string): SaveData | null {
  try {
    const json = JSON.parse(text) as SaveJSON;
    if (!json || json.version !== 1 || !loadable(json.state)) return null;
    return fromJSON(json);
  } catch {
    return null;
  }
}
