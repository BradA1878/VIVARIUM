/* ============================================================================
   PTP founding helpers (main thread). When you launch the Transport Pod, the
   store founds the next run on a new world: the next seed is DERIVED from this
   run's seed (so the whole multi-world campaign stays reproducible — reusing the
   engine's terrain-backfill idiom of a throwaway RNG that never touches a live
   stream), and each settled world is addressed by a deterministic slot id.

   These live on the main thread by design — the engine never originates a seed
   (the wall). World metadata (labels + the picker blurbs) lives here too.
   ============================================================================ */
import type { World } from "@shared/types";
import { RNG } from "@/engine/rng";

/** distinct from the envRng salt (0x9e3779b9) so world seeds don't correlate with terrain */
export const WORLD_SALT = 0xc2b2ae35;

/** derive the next world's seed from this run's seed — deterministic + reproducible */
export function nextSeedFrom(seed: number): number {
  const r = new RNG((seed ^ WORLD_SALT) >>> 0);
  r.next(); // advance once so the result isn't just the salted seed
  return r.getState();
}

/** the persistence slot a settled world is stored under (world + seed is unique) */
export function slotId(world: World, seed: number): string {
  return `${world}:${seed >>> 0}`;
}

export const WORLD_META: Record<World, { label: string; blurb: string }> = {
  mars: { label: "Mars", blurb: "The balanced origin — sun, wind, and dust in measure." },
  ceres: { label: "Ceres", blurb: "Ice everywhere, but a weak sun. Power is the squeeze." },
  io: { label: "Io", blurb: "Abundant geothermal — but the ground will not stay still." },
  titan: { label: "Titan", blurb: "No sun at all. Strong, steady wind is the lifeline." },
};

/** the worlds you can launch TO — every world except the one you're leaving */
export function destinationsFrom(world: World): World[] {
  return (["mars", "ceres", "io", "titan"] as World[]).filter((w) => w !== world);
}
