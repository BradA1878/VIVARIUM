/* ============================================================================
   Alien traders — a window like Earth resupply, but you accept/decline a swap.
   Scheduling + offer generation use the SEPARATE env-rng so the main stream is
   untouched. Resolution happens only via the respondTrade command (player input),
   so replay stays deterministic. (doc §0)
   ============================================================================ */
import type { Resource, TradeView } from "@shared/types";
import {
  TRADE_INBOUND, TRADE_DECIDE, TRADE_LEAVE, TRADE_GAP,
  TRADE_TAKE_MIN, TRADE_TAKE_SPAN, TRADE_GIVE_MIN, TRADE_GIVE_SPAN,
} from "./tuning";
import type { ColonyState } from "./state";
import type { Emit } from "./tick";
import type { RNG } from "./rng";

type Tradeable = Resource | "materials";
const TRADEABLES: Tradeable[] = ["power", "water", "oxygen", "food", "materials"];

function poolOf(s: ColonyState, r: Tradeable): { amount: number; capacity: number } {
  return r === "materials" ? s.materials : s.pools[r];
}

/** a landed trader near the colony edge (deterministic landing cell) */
function landingCell(s: ColonyState, rng: RNG): { gx: number; gy: number } {
  const edge = rng.next() < 0.5 ? 1 : s.N - 2;
  const along = 1 + Math.floor(rng.next() * (s.N - 2));
  return rng.next() < 0.5 ? { gx: edge, gy: along } : { gx: along, gy: edge };
}

function makeOffer(s: ColonyState, rng: RNG): void {
  const ti = Math.floor(rng.next() * TRADEABLES.length);
  let gi = Math.floor(rng.next() * (TRADEABLES.length - 1));
  if (gi >= ti) gi += 1; // distinct give/take
  const take = TRADEABLES[ti], give = TRADEABLES[gi];
  const { gx, gy } = landingCell(s, rng);
  s.trade = {
    id: s.tradeCounter++,
    phase: "inbound",
    take: { res: take, amount: Math.round(TRADE_TAKE_MIN + rng.next() * TRADE_TAKE_SPAN) },
    give: { res: give, amount: Math.round(TRADE_GIVE_MIN + rng.next() * TRADE_GIVE_SPAN) },
    tLeft: TRADE_INBOUND,
    gx, gy,
  };
}

/** the tick's trade pass — schedule a window, advance the ship's lifecycle */
export function updateTrade(s: ColonyState, dt: number, rng: RNG, emit: Emit): void {
  if (!s.trade) {
    s.nextTrade -= dt;
    if (s.nextTrade <= 0) {
      s.nextTrade = TRADE_GAP;
      makeOffer(s, rng);
      emit({ type: "traders_inbound", detail: s.trade!.give.res });
    }
    return;
  }
  const tr = s.trade;
  tr.tLeft -= dt;
  if (tr.tLeft > 0) return;
  if (tr.phase === "inbound") { tr.phase = "landed"; tr.tLeft = TRADE_DECIDE; }
  else if (tr.phase === "landed") { tr.phase = "leaving"; tr.tLeft = TRADE_LEAVE; emit({ type: "trade_left" }); }
  else { s.trade = null; } // gone
}

/** can the colony currently pay the standing offer's `take`? */
export function canAffordTrade(s: ColonyState): boolean {
  return !!s.trade && s.trade.phase === "landed" && poolOf(s, s.trade.take.res).amount >= s.trade.take.amount;
}

/** player accepts/declines the landed offer (a command, so it's replay-safe) */
export function respondTrade(s: ColonyState, accept: boolean, emit: Emit): void {
  const tr = s.trade;
  if (!tr || tr.phase !== "landed") return;
  if (accept) {
    const have = poolOf(s, tr.take.res);
    if (have.amount < tr.take.amount) return; // can't pay — leave the offer open
    have.amount -= tr.take.amount;
    const got = poolOf(s, tr.give.res);
    got.amount = Math.min(got.capacity, got.amount + tr.give.amount);
    emit({ type: "trade_done", detail: tr.give.res });
  } else {
    emit({ type: "trade_left" });
  }
  tr.phase = "leaving";
  tr.tLeft = TRADE_LEAVE;
}

export function tradeView(s: ColonyState): TradeView | null {
  const tr = s.trade;
  if (!tr) return null;
  return {
    id: tr.id, phase: tr.phase, give: { ...tr.give }, take: { ...tr.take },
    deadline: tr.phase === "landed" ? tr.tLeft : 0, gx: tr.gx, gy: tr.gy,
  };
}
