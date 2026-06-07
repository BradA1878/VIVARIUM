/* ============================================================================
   The tick: ordered passes, not one equation (doc §2.4). Deterministic,
   debuggable, replayable. The whole feel of the genre lives in the power-by-
   priority pass and the shortfall-timer pass.

   Pure function of (state, dt, rng, emit). Mutates state in place. Emits events
   for the UI and (optionally) for VIVARIUM — never read back into the tick.
   ============================================================================ */
import type { ColonyEvent, Resource } from "@shared/types";
import { DEFS } from "./defs";
import {
  PERSON, STORM_SOLAR_MULT, DAY_START, DAY_END,
  STORM_DUR_MIN, STORM_DUR_SPAN, STORM_GAP_MIN, STORM_GAP_SPAN,
  ARRIVAL_BATCH, ARRIVAL_GAP_MIN, ARRIVAL_GAP_SPAN, ARRIVAL_RETRY,
  BROWNOUT_DEFICIT, BROWNOUT_LOW, BROWNOUT_RECOVER_FRAC,
  RESUPPLY_GAP, RESUPPLY_WINDOW, RESUPPLY_AMOUNT,
} from "./tuning";
import { RESOURCES } from "@shared/types";
import type { ColonyState } from "./state";
import { recomputeConnectivity } from "./connectivity";
import type { RNG } from "./rng";

/** event emitter — the colony stamps t/sol/tod before recording */
export type Emit = (e: Omit<ColonyEvent, "t" | "sol" | "tod">) => void;

function addPool(s: ColonyState, k: Resource, amt: number): void {
  const p = s.pools[k];
  p.amount = Math.min(p.capacity, p.amount + amt);
}
function takePool(s: ColonyState, k: Resource, amt: number): void {
  const p = s.pools[k];
  p.amount = Math.max(0, p.amount - amt);
}

/** daytime solar curve × storm throttle, 0..1 (doc §2.4 pass 1) */
export function solarOutput(s: ColonyState): number {
  const t = s.tod;
  let day = 0;
  if (t > DAY_START && t < DAY_END) {
    const phase = (t - DAY_START) / (DAY_END - DAY_START);
    day = Math.sin(phase * Math.PI);
  }
  const stormMul = s.weather === "dust" ? STORM_SOLAR_MULT : 1;
  return Math.max(0, day) * stormMul;
}

export function tick(s: ColonyState, dt: number, rng: RNG, emit: Emit): void {
  s.t += dt;

  // 1. Environment / sol clock --------------------------------------------------
  const prevTod = s.tod;
  s.tod += dt / s.solLength;
  while (s.tod >= 1) {
    s.tod -= 1;
    s.sol += 1;
    emit({ type: "new_sol" });
  }
  if (prevTod < DAY_END && s.tod >= DAY_END) emit({ type: "dusk" });
  if (prevTod < DAY_START && s.tod >= DAY_START) emit({ type: "dawn" });

  // weather scheduling
  if (s.weather === "clear") {
    s.nextStorm -= dt;
    if (s.nextStorm <= 0) {
      s.weather = "dust";
      s.stormDur = STORM_DUR_MIN + rng.next() * STORM_DUR_SPAN;
      s.stormT = s.stormDur;
      emit({ type: "storm_in", secs: Math.round(s.stormDur) });
    }
  } else {
    s.stormT -= dt;
    if (s.stormT <= 0) {
      s.weather = "clear";
      s.nextStorm = STORM_GAP_MIN + rng.next() * STORM_GAP_SPAN;
      emit({ type: "storm_clear" });
    }
  }
  s.solarMul = solarOutput(s);

  // Earth resupply windows (doc §2.5) — a window opens on a schedule and trickles
  // a batch of resources into the buffers while open. External delivery, so it is
  // deliberately NOT counted in net flow.
  if (isFinite(s.nextResupply)) {
    if (s.resupplyT > 0) {
      for (const k of RESOURCES) addPool(s, k, (RESUPPLY_AMOUNT[k] / RESUPPLY_WINDOW) * dt);
      s.resupplyT = Math.max(0, s.resupplyT - dt);
    }
    s.nextResupply -= dt;
    if (s.nextResupply <= 0) {
      s.resupplyT = RESUPPLY_WINDOW;
      s.nextResupply = RESUPPLY_GAP;
      emit({ type: "resupply" });
    }
  }

  recomputeConnectivity(s);

  // labor pool = housed population
  s.labor = s.population;
  s.laborUsed = 0;

  const net: Record<Resource, number> = { power: 0, water: 0, oxygen: 0, food: 0 };

  // 2. Generation into the power buffer ----------------------------------------
  let gen = 0;
  for (const b of s.buildings) {
    const def = DEFS[b.defId];
    if (def.solar) gen += def.solar * s.solarMul;
  }
  addPool(s, "power", gen * dt);
  net.power += gen;

  // 3. Power demand by priority — brownout sheds the bottom first ---------------
  const consumers = s.buildings
    .filter((b) => (DEFS[b.defId].consumes.power ?? 0) > 0)
    .sort((a, b) => DEFS[b.defId].priority - DEFS[a.defId].priority);
  let powerAvail = s.pools.power.amount; // what's in the battery this tick
  for (const b of s.buildings) b.online = false;
  for (const b of consumers) {
    const need = (DEFS[b.defId].consumes.power ?? 0) * dt;
    if (powerAvail >= need) { b.online = true; powerAvail -= need; }
    else b.online = false;
  }
  // buildings with no power draw are "online" if other gates pass
  for (const b of s.buildings) if (!((DEFS[b.defId].consumes.power ?? 0) > 0)) b.online = true;

  // 4. Production — online AND connected AND staffed AND fed --------------------
  for (const b of s.buildings) {
    b.util = 0; b.staffed = true; b.fed = true;
    const d = DEFS[b.defId];
    if (!b.online) continue;
    if (d.requiresPressure && !b.connected) { b.online = false; continue; }
    // staffing
    if (d.staffing > 0) {
      if (s.laborUsed + d.staffing <= s.labor) s.laborUsed += d.staffing;
      else { b.staffed = false; b.online = false; continue; }
    }
    // non-power inputs available?
    let ok = true;
    for (const k in d.consumes) {
      if (k === "power") continue;
      if (s.pools[k as Resource].amount < (d.consumes[k as Resource]! * dt)) { ok = false; break; }
    }
    if (!ok) {
      b.fed = false; b.online = false;
      if (d.staffing > 0) s.laborUsed -= d.staffing; // release the labor it claimed
      continue;
    }
    // run recipe
    for (const k in d.consumes) {
      const r = k as Resource;
      takePool(s, r, d.consumes[r]! * dt);
      net[r] -= d.consumes[r]!;
    }
    for (const k in d.produces) {
      const r = k as Resource;
      addPool(s, r, d.produces[r]! * dt);
      net[r] += d.produces[r]!;
    }
    b.util = 1;
  }

  // 5. Colonist consumption ----------------------------------------------------
  if (s.population > 0) {
    for (const k of ["oxygen", "water", "food"] as const) {
      const demand = PERSON[k] * s.population;
      takePool(s, k, demand * dt);
      net[k] -= demand;
    }
  }

  // 6. Shortfalls become TIMERS, not instant death (grace + drama) -------------
  for (const k of ["oxygen", "water", "food"] as const) {
    const empty = s.pools[k].amount <= 0.001 && net[k] < 0 && s.population > 0;
    if (empty) {
      if (s.timers[k] == null) {
        s.timers[k] = s.grace;
        emit({ type: "crit_start", res: k });
      } else {
        s.timers[k]! -= dt;
        if (s.timers[k]! <= 0) {
          const lost = Math.min(s.population, 1);
          s.population -= lost;
          s.dead += lost;
          s.timers[k] = s.grace * 0.5;
          emit({ type: "casualty", res: k, n: lost });
        }
      }
    } else if (s.timers[k] != null) {
      s.timers[k] = null;
      emit({ type: "crit_clear", res: k });
    }
  }

  // brownout latch (any pressurized consumer shed purely for power)
  detectBrownout(s, net, emit);

  // 7. Arrivals — only on a real surplus with housing --------------------------
  s.nextArrival -= dt;
  if (s.arrivalsLeft > 0 && s.nextArrival <= 0) {
    const surplus = net.oxygen > 0 && net.food > 0 && net.water > 0;
    const room = s.population + ARRIVAL_BATCH <= s.housing;
    if (surplus && room && s.population > 0) {
      s.population += ARRIVAL_BATCH;
      s.arrivalsLeft -= 1;
      s.nextArrival = ARRIVAL_GAP_MIN + rng.next() * ARRIVAL_GAP_SPAN;
      emit({ type: "arrival", n: ARRIVAL_BATCH, pop: s.population });
    } else {
      s.nextArrival = ARRIVAL_RETRY;
    }
  }

  s.flow = net;
}

function detectBrownout(s: ColonyState, net: Record<Resource, number>, emit: Emit): void {
  const short = net.power < BROWNOUT_DEFICIT && s.pools.power.amount < BROWNOUT_LOW;
  if (short && !s.brownLatch) { s.brownLatch = true; emit({ type: "brownout" }); }
  if (!short && s.brownLatch && s.pools.power.amount > s.pools.power.capacity * BROWNOUT_RECOVER_FRAC) {
    s.brownLatch = false;
    emit({ type: "power_back" });
  }
}
