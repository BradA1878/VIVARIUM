/* ============================================================================
   Alien traders — a window like Earth resupply, but you accept/decline a swap.
   Scheduling + offer generation use the SEPARATE env-rng so the main stream is
   untouched. Resolution happens only via the respondTrade command (player input),
   so replay stays deterministic. (doc §0)
   ============================================================================ */
import type { Resource, TradeView } from "@shared/types";
import {
  MORALE_BUMP, TRADE_INBOUND, TRADE_DECIDE, TRADE_LEAVE, TRADE_GAP,
  TRADE_TAKE_MIN, TRADE_TAKE_SPAN, TRADE_GIVE_MIN, TRADE_GIVE_SPAN,
  TRADE_TECH_CHANCE, TRADE_TECH_TAKE_MIN, TRADE_TECH_TAKE_SPAN,
} from "./tuning";
import type { ColonyState } from "./state";
import type { Emit } from "./tick";
import type { RNG } from "./rng";
import { TECH_DEFS, TECH_IDS } from "./techs";
import { recomputeCaps } from "./caps";
import { bumpMorale } from "./morale";

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

/** never ask for more of a resource than the colony can physically store, or the
 *  offer would be impossible to accept */
function clampTake(s: ColonyState, res: Tradeable, amount: number): number {
  return Math.min(Math.round(amount), Math.floor(poolOf(s, res).capacity));
}

function makeOffer(s: ColonyState, rng: RNG): void {
  const ti = Math.floor(rng.next() * TRADEABLES.length);
  const take = TRADEABLES[ti];
  const { gx, gy } = landingCell(s, rng);

  // some offers hand over permanent alien tech (one we don't already have).
  // Alien tech is bought with MATERIALS — the gather currency — so the two new
  // systems tie together: mine ore → materials → trade for tech.
  const techPool = TECH_IDS.filter((id) => !s.acquiredTech.includes(id));
  if (techPool.length > 0 && rng.next() < TRADE_TECH_CHANCE) {
    const tech = techPool[Math.floor(rng.next() * techPool.length)];
    s.trade = {
      id: s.tradeCounter++,
      phase: "inbound",
      take: { res: "materials", amount: clampTake(s, "materials", TRADE_TECH_TAKE_MIN + rng.next() * TRADE_TECH_TAKE_SPAN) },
      give: { res: "tech", amount: 1, tech },
      tLeft: TRADE_INBOUND,
      gx, gy,
    };
    return;
  }

  // otherwise a plain resource swap (give must differ from take)
  let gi = Math.floor(rng.next() * (TRADEABLES.length - 1));
  if (gi >= ti) gi += 1;
  s.trade = {
    id: s.tradeCounter++,
    phase: "inbound",
    take: { res: take, amount: clampTake(s, take, TRADE_TAKE_MIN + rng.next() * TRADE_TAKE_SPAN) },
    give: { res: TRADEABLES[gi], amount: Math.round(TRADE_GIVE_MIN + rng.next() * TRADE_GIVE_SPAN) },
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
      const g = s.trade!.give;
      emit({ type: "traders_inbound", detail: g.res === "tech" ? TECH_DEFS[g.tech]?.name ?? "tech" : g.res });
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
    if (tr.give.res === "tech") {
      // a permanent upgrade — bank it and let the caps pass apply any bonus now
      if (!s.acquiredTech.includes(tr.give.tech)) s.acquiredTech.push(tr.give.tech);
      recomputeCaps(s);
      emit({ type: "trade_done", detail: TECH_DEFS[tr.give.tech]?.name ?? tr.give.tech });
    } else {
      const got = poolOf(s, tr.give.res);
      got.amount = Math.min(got.capacity, got.amount + tr.give.amount);
      emit({ type: "trade_done", detail: tr.give.res });
    }
    bumpMorale(s, MORALE_BUMP.trade);
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
