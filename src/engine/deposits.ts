/* ============================================================================
   The surface deposit field — seeded scatter of ice / ore / cache nodes the
   possessed colonist mines. Uses a SEPARATE env-rng (passed in) so generating
   the field never perturbs the main hazard/arrival rng stream — the existing
   determinism tests stay byte-for-byte identical.
   ============================================================================ */
import type { DepositKind } from "@shared/types";
import {
  DEPOSIT_COUNT, DEPOSIT_MIN, DEPOSIT_SPAN, DEPOSIT_EDGE, DEPOSIT_CLEAR,
  DEPOSIT_RESPAWN, DEPOSIT_FIELD_MAX,
} from "./tuning";
import type { ColonyState } from "./state";
import { idx } from "./grid";
import { baseCenter } from "./colonists";
import type { RNG } from "./rng";

function pickKind(rng: RNG): DepositKind {
  const r = rng.next();
  if (r < 0.46) return "ore";   // build economy — a touch more common
  if (r < 0.79) return "ice";   // → water
  return "cache";               // → food, rarer
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

/** surface a fresh deposit every so often so exploration never fully runs dry */
export function respawnDeposits(s: ColonyState, dt: number, rng: RNG): void {
  s.depositRespawn -= dt;
  if (s.depositRespawn > 0) return;
  s.depositRespawn = DEPOSIT_RESPAWN;
  if (s.deposits.length < DEPOSIT_FIELD_MAX) tryPlace(s, rng);
}
