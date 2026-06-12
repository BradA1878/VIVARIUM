/* ============================================================================
   The surface terrain — geothermal vents and the deposit field. Vents seed
   first (deposits reject vent cells) and never deplete; deposits are the
   scatter of ice / ore / cache nodes the colonists mine. Both use a SEPARATE
   env-rng (passed in) so generating the surface never perturbs the main
   hazard/arrival rng stream — the existing determinism tests stay
   byte-for-byte identical. Legacy saves backfill vents from a DERIVED rng
   (colony.ts), never the live env stream.
   ============================================================================ */
import type { DepositKind } from "@shared/types";
import {
  DEPOSIT_COUNT, DEPOSIT_MIN, DEPOSIT_SPAN, DEPOSIT_EDGE, DEPOSIT_CLEAR,
  DEPOSIT_RESPAWN, DEPOSIT_FIELD_MAX,
  VENT_CLEAR, VENT_COUNT, VENT_EDGE, VENT_SPACING,
} from "./tuning";
import type { ColonyState } from "./state";
import { idx } from "./grid";
import { baseCenter } from "./colonists";
import type { RNG } from "./rng";

/** kind weights: ore 40% / ice 32% / cache 28%. Caches were 21% and the larder
 *  underran demand by ~sol 4 on an untouched colony — food needs the share.
 *  Still exactly ONE rng draw, so the env stream's draw count (and every
 *  position/amount after it) is unchanged. */
function pickKind(rng: RNG): DepositKind {
  const r = rng.next();
  if (r < 0.4) return "ore";    // build economy
  if (r < 0.72) return "ice";   // → water
  return "cache";               // → food — common enough to keep pace
}

/** try to place one deposit on a free cell away from the base; returns true if placed */
function tryPlace(s: ColonyState, rng: RNG): boolean {
  const lo = DEPOSIT_EDGE, hi = s.N - 1 - DEPOSIT_EDGE;
  const span = hi - lo;
  const base = baseCenter(s);
  for (let attempt = 0; attempt < 12; attempt++) {
    const gx = lo + Math.floor(rng.next() * (span + 1));
    const gy = lo + Math.floor(rng.next() * (span + 1));
    if (s.grid[idx(s.N, gx, gy)] !== 0) continue;                  // not on a building
    if (s.deposits.some((d) => d.gx === gx && d.gy === gy)) continue; // not on a deposit
    if (s.vents.some((v) => v.gx === gx && v.gy === gy)) continue;    // not on a vent
    if (Math.hypot(gx - base.x, gy - base.y) < DEPOSIT_CLEAR) continue; // not in the yard
    const kind = pickKind(rng);
    s.deposits.push({
      id: s.depositCounter++, gx, gy, kind,
      amount: DEPOSIT_MIN + rng.next() * DEPOSIT_SPAN,
      max: DEPOSIT_MIN + DEPOSIT_SPAN,
    });
    return true;
  }
  return false;
}

/** initial scatter at colony construction */
export function seedDeposits(s: ColonyState, rng: RNG): void {
  for (let i = 0; i < DEPOSIT_COUNT; i++) tryPlace(s, rng);
}

/** scatter the geothermal vents — static terrain, seeded BEFORE the deposit
 *  field so deposits can reject vent cells. Same rejection-loop style as
 *  tryPlace: off the border, clear of the base, spaced apart, never on a
 *  building. Called with the envRng on a fresh colony, or with a derived
 *  RNG(seed ^ VENT_BACKFILL_SALT) when backfilling a legacy save. */
export function seedVents(s: ColonyState, rng: RNG): void {
  const lo = VENT_EDGE, hi = s.N - 1 - VENT_EDGE;
  const span = hi - lo;
  const base = baseCenter(s);
  for (let i = 0; i < VENT_COUNT; i++) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const gx = lo + Math.floor(rng.next() * (span + 1));
      const gy = lo + Math.floor(rng.next() * (span + 1));
      if (s.grid[idx(s.N, gx, gy)] !== 0) continue;                       // not on a building
      if (s.vents.some((v) => Math.hypot(v.gx - gx, v.gy - gy) < VENT_SPACING)) continue;
      if (Math.hypot(gx - base.x, gy - base.y) < VENT_CLEAR) continue;    // not in the yard
      s.vents.push({ id: s.vents.length + 1, gx, gy });
      break;
    }
  }
}

/** surface a fresh deposit every so often so exploration never fully runs dry */
export function respawnDeposits(s: ColonyState, dt: number, rng: RNG): void {
  s.depositRespawn -= dt;
  if (s.depositRespawn > 0) return;
  s.depositRespawn = DEPOSIT_RESPAWN;
  if (s.deposits.length < DEPOSIT_FIELD_MAX) tryPlace(s, rng);
}
