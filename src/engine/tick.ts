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
  PERSON, DAY_START, DAY_END,
  ARRIVAL_BATCH, ARRIVAL_GAP_MIN, ARRIVAL_GAP_SPAN, ARRIVAL_RETRY,
  BROWNOUT_DEFICIT, BROWNOUT_LOW, BROWNOUT_RECOVER_FRAC,
  RESUPPLY_GAP, RESUPPLY_WINDOW, RESUPPLY_AMOUNT,
  BIRTH_MIN_POP, BIRTH_GAP_MIN, BIRTH_GAP_SPAN, BIRTH_RETRY,
  ROLE_BONUS, MORALE_BUMP,
} from "./tuning";
import { RESOURCES } from "@shared/types";
import type { ColonyState } from "./state";
import { buildingFunctional } from "./state";
import { recomputeConnectivity } from "./connectivity";
import { updateHazards, hazardMods, type HazardMods } from "./hazards";
import { stepColonists } from "./colonists";
import { updateInjuries, injuredCount } from "./injury";
import { pilotRover, updateRoverFab } from "./rover";
import { stepRobots, updateRobotFab } from "./robots";
import { roleMatchCount } from "./roster";
import { bumpMorale, moraleMult, updateMorale } from "./morale";
import { respawnDeposits } from "./deposits";
import { updateTrade } from "./trade";
import { updateUfo } from "./ufo";
import { techPassivePower, techDemandMult } from "./techs";
import { updateUnlocks } from "./unlocks";
import { windLevel } from "./wind";
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

/** a building's power draw, with cold-snap heating on pressurized structures */
function powerNeed(b: { defId: string }, mods: HazardMods): number {
  const d = DEFS[b.defId];
  const base = d.consumes.power ?? 0;
  return base > 0 && d.requiresPressure ? base * mods.pressurePowerMult : base;
}

/** daytime solar curve, 0..1 — the dust/hazard throttle is applied separately
 *  via hazardMods().solarFactor (doc §2.4 pass 1) */
export function solarOutput(s: ColonyState): number {
  const t = s.tod;
  let day = 0;
  if (t > DAY_START && t < DAY_END) {
    const phase = (t - DAY_START) / (DAY_END - DAY_START);
    day = Math.sin(phase * Math.PI);
  }
  return Math.max(0, day);
}

export function tick(s: ColonyState, dt: number, rng: RNG, envRng: RNG, emit: Emit): void {
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

  // hazards — the living environment (scheduler + lifecycle + effects + damage)
  updateHazards(s, dt, rng, emit);
  const mods = hazardMods(s);
  s.solarMul = solarOutput(s) * mods.solarFactor;
  s.windLevel = windLevel(s); // pure derivation — peaks exactly when solar dies

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

  // labor pool = housed population, less the wounded (triage pulls them off shift)
  s.labor = Math.max(0, s.population - injuredCount(s));
  s.laborUsed = 0;

  const net: Record<Resource, number> = { power: 0, water: 0, oxygen: 0, food: 0 };

  // 2. Generation into the power buffer ----------------------------------------
  let gen = 0;
  for (const b of s.buildings) {
    const def = DEFS[b.defId];
    if (def.solar) gen += def.solar * s.solarMul;
    // environmental generation — wind rides the weather curve, geothermal is
    // flat; both gate only on buildingFunctional (no staffing, no inputs:
    // generation is weather, not production). Solar keeps its original behavior.
    if ((def.wind || def.steady) && buildingFunctional(b)) {
      gen += (def.wind ?? 0) * s.windLevel + (def.steady ?? 0);
    }
  }
  gen += techPassivePower(s); // alien fusion cell — flat, day or night
  addPool(s, "power", gen * dt);
  net.power += gen;

  // solar flare siphons power straight off the grid
  if (mods.powerDrain > 0) { takePool(s, "power", mods.powerDrain * dt); net.power -= mods.powerDrain; }

  // 3. Power demand by priority — brownout sheds the bottom first ---------------
  const consumers = s.buildings
    .filter((b) => powerNeed(b, mods) > 0)
    .sort((a, b) => DEFS[b.defId].priority - DEFS[a.defId].priority);
  let powerAvail = s.pools.power.amount; // what's in the battery this tick
  for (const b of s.buildings) b.online = false;
  for (const b of consumers) {
    const need = powerNeed(b, mods) * dt;
    if (powerAvail >= need) { b.online = true; powerAvail -= need; }
    else b.online = false;
  }
  // buildings with no power draw are "online" if other gates pass
  for (const b of s.buildings) if (!(powerNeed(b, mods) > 0)) b.online = true;

  // 4. Production — online AND connected AND staffed AND fed AND intact ---------
  for (const b of s.buildings) {
    b.util = 0; b.staffed = true; b.fed = true;
    const d = DEFS[b.defId];
    if (!b.online) continue;
    if (!buildingFunctional(b)) { b.online = false; continue; } // hazard damage / fault
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
    // run recipe (power draw is inflated by cold-snap heating)
    for (const k in d.consumes) {
      const r = k as Resource;
      const rate = r === "power" ? powerNeed(b, mods) : d.consumes[r]!;
      takePool(s, r, rate * dt);
      net[r] -= rate;
    }
    // role-matched staffing + colony mood work the recipe harder — eff scales
    // produces only, never consumes
    let roleMult = 1;
    if (d.staffing > 0) {
      const matched = roleMatchCount(s, b.uid, b.defId);
      roleMult = 1 + ROLE_BONUS * (Math.min(matched, d.staffing) / d.staffing);
    }
    const eff = moraleMult(s) * roleMult;
    for (const k in d.produces) {
      const r = k as Resource;
      addPool(s, r, d.produces[r]! * eff * dt);
      net[r] += d.produces[r]! * eff;
    }
    // the materials printer — the build currency's on-planet source. Same eff
    // scaling as produces; clamped to the materials cap (outside net flow,
    // which tracks the four survival pools only).
    if (d.producesMat) {
      s.materials.amount = Math.min(
        s.materials.capacity, s.materials.amount + d.producesMat * eff * dt,
      );
    }
    b.util = 1;
  }

  // 5. Colonist consumption ----------------------------------------------------
  if (s.population > 0) {
    for (const k of ["oxygen", "water", "food"] as const) {
      const demand = PERSON[k] * techDemandMult(s, k) * s.population; // alien bioscrubber, etc.
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
          bumpMorale(s, -MORALE_BUMP.casualty);
        }
      }
    } else if (s.timers[k] != null) {
      s.timers[k] = null;
      emit({ type: "crit_clear", res: k });
    }
  }

  // brownout latch (any pressurized consumer shed purely for power)
  detectBrownout(s, net, emit);

  // 6b. Morale — continuous drivers + the latched low/recovered thresholds -----
  updateMorale(s, dt, emit);

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
      bumpMorale(s, MORALE_BUMP.arrival);
    } else {
      s.nextArrival = ARRIVAL_RETRY;
    }
  }

  // 7c. Births — the settlement grows from within when it's thriving (surplus +
  // spare housing + a population floor + no active crisis). Rare; main rng.
  maybeBirth(s, net, dt, rng, emit);

  s.flow = net;

  // 7b. Embodied colony — surface life on top of the resolved sim state.
  // Colonists reflect staffing/population (set above); the env-rng drives the
  // deposit field + trade window without perturbing the main stream.
  respawnDeposits(s, dt, envRng);
  updateTrade(s, dt, envRng, emit);
  updateUfo(s, dt, envRng, emit);
  updateInjuries(s, dt, emit); // before stepColonists: the healed rejoin assign now
  const claims = stepColonists(s, dt); // the unified gather-claim set (colonists + robots)
  // rung 2 of the automation ladder — the Rover Bay's fabrication line, the
  // fleet's self-repair, and piloting for whichever possessed actor is a rover
  // (stepColonists already piloted a possessed colonist; ids never collide).
  updateRoverFab(s, dt, emit);
  const rover = s.rovers.find((r) => r.id === s.possessed);
  if (rover) pilotRover(s, rover, dt);
  // rung 3 — the Robotics Bay's line + the autonomous miners. Robots work sol
  // AND night and never shelter; they step through the SAME claim set the
  // colonists' pass built, so the species never thrash over a node.
  updateRobotFab(s, dt, emit);
  stepRobots(s, dt, claims);

  // 7d. Abundance unlocks — the expansion palette latches open as the colony
  // proves itself (pure derivations over the resolved state, zero rng draws)
  updateUnlocks(s, emit);

  // 8. Campaign — the launch-window arc (doc §2.5) -----------------------------
  if (s.outcome === null) {
    // self-sufficiency: producing at least what we consume on all life support
    // (net excludes resupply by design), with a real settlement's population
    const balanced =
      s.population >= s.targetPop &&
      net.oxygen >= 0 && net.water >= 0 && net.food >= 0 && net.power >= 0;
    s.selfSufficientFor = balanced ? s.selfSufficientFor + dt : 0;

    if (s.selfSufficientFor >= s.selfSufficiencyGoal) {
      s.outcome = "victory";
      s.outcomeReason = "self-sufficient";
      s.paused = true;
      emit({ type: "victory" });
    } else if (s.population <= 0) {
      s.outcome = "defeat";
      s.outcomeReason = "colony";
      s.paused = true;
      emit({ type: "defeat", detail: "colony" });
    } else if (s.sol >= s.deadlineSol) {
      s.outcome = "defeat";
      s.outcomeReason = "window";
      s.paused = true;
      emit({ type: "defeat", detail: "window" });
    }
  }
}

/** a rare in-colony birth: the settlement grows from within when it's thriving —
 *  a surplus on every life-support resource, spare housing, a real population, and
 *  no active crisis. Mirrors Earth arrivals but uncapped, rarer, and self-driven.
 *  Counts toward the campaign's targetPop like any colonist. (main rng) */
export function maybeBirth(s: ColonyState, net: Record<Resource, number>, dt: number, rng: RNG, emit: Emit): void {
  s.nextBirth -= dt;
  if (s.nextBirth > 0) return;
  const thriving = net.oxygen > 0 && net.water > 0 && net.food > 0;
  const room = s.population + 1 <= s.housing;
  const settled = s.population >= BIRTH_MIN_POP;
  const calm = s.timers.oxygen == null && s.timers.water == null && s.timers.food == null;
  if (thriving && room && settled && calm) {
    s.population += 1;
    s.nextBirth = BIRTH_GAP_MIN + rng.next() * BIRTH_GAP_SPAN;
    emit({ type: "birth", n: 1, pop: s.population });
    bumpMorale(s, MORALE_BUMP.birth);
  } else {
    s.nextBirth = BIRTH_RETRY;
  }
}

function detectBrownout(s: ColonyState, net: Record<Resource, number>, emit: Emit): void {
  const short = net.power < BROWNOUT_DEFICIT && s.pools.power.amount < BROWNOUT_LOW;
  if (short && !s.brownLatch) { s.brownLatch = true; emit({ type: "brownout" }); }
  if (!short && s.brownLatch && s.pools.power.amount > s.pools.power.capacity * BROWNOUT_RECOVER_FRAC) {
    s.brownLatch = false;
    emit({ type: "power_back" });
  }
}
