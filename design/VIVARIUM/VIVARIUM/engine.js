/* ============================================================================
   VIVARIUM — THE ENGINE
   Deterministic, synchronous simulation. No network, no async, no agent.
   A building is data, not code. Pools are buffers. Connectivity is a boolean.
   The tick is ordered passes. (See design doc §2.)
   ============================================================================ */
(function () {
  "use strict";

  // ---- Building definitions: the entire tech tree is JSON --------------------
  // consumes/produces are PER SECOND at full operation (engine runs at 5 Hz and
  // scales by dt internally). priority = power-allocation rank; brownout sheds
  // the LOWEST priority first, so farming dies before life support.
  const DEFS = {
    hub: {
      id: "hub", name: "Pressure Hub", glyph: "HUB",
      foot: [2, 2], h: 30, color: "#3a4750",
      cost: { power: 0 },
      staffing: 0, consumes: { power: 1.5 }, produces: {},
      requiresPressure: false, isHub: true, priority: 99,
      caps: { oxygen: 30 },
      desc: "Source of pressure. Everything sealed flood-fills from here.",
    },
    corridor: {
      id: "corridor", name: "Corridor", glyph: "===",
      foot: [1, 1], h: 10, color: "#2c363d",
      cost: { power: 0 },
      staffing: 0, consumes: { power: 0.2 }, produces: {},
      requiresPressure: false, conduit: true, priority: 95,
      desc: "Pressurized link. Carries the seal between hub and habs.",
    },
    hab: {
      id: "hab", name: "Habitat", glyph: "HAB",
      foot: [1, 1], h: 22, color: "#39444c",
      cost: { power: 0 },
      staffing: 0, consumes: { power: 1.0 }, produces: {},
      requiresPressure: true, priority: 88, popCap: 4,
      desc: "Houses 4 colonists. Heated. Must stay pressurized.",
    },
    solar: {
      id: "solar", name: "Solar Array", glyph: "PV",
      foot: [2, 2], h: 8, color: "#1d2730",
      cost: { power: 0 },
      staffing: 0, consumes: {}, produces: {}, solar: 22,
      requiresPressure: false, priority: 0,
      desc: "Power from sunlight. Follows the sol. Gutted by dust storms.",
    },
    battery: {
      id: "battery", name: "Battery Bank", glyph: "BAT",
      foot: [1, 1], h: 14, color: "#222d34",
      cost: { power: 0 },
      staffing: 0, consumes: {}, produces: {},
      requiresPressure: false, priority: 0, caps: { power: 120 },
      desc: "Stores power. The only thing between you and the dark.",
    },
    extractor: {
      id: "extractor", name: "Ice Extractor", glyph: "H2O",
      foot: [1, 1], h: 18, color: "#33403a",
      cost: { power: 0 },
      staffing: 1, consumes: { power: 5 }, produces: { water: 4 },
      requiresPressure: false, priority: 45,
      desc: "Sublimes subsurface ice. Power in, water out.",
    },
    electrolysis: {
      id: "electrolysis", name: "Electrolysis Unit", glyph: "O2",
      foot: [1, 1], h: 20, color: "#2f3a44",
      cost: { power: 0 },
      staffing: 1, consumes: { power: 7, water: 2.5 }, produces: { oxygen: 5 },
      requiresPressure: true, priority: 82,
      desc: "Splits water for breathable oxygen. Life support — served first.",
    },
    greenhouse: {
      id: "greenhouse", name: "Hydroponics", glyph: "GRO",
      foot: [2, 2], h: 16, color: "#33422f",
      cost: { power: 0 },
      staffing: 2, consumes: { power: 6, water: 3 }, produces: { food: 5, oxygen: 2 },
      requiresPressure: true, priority: 30,
      desc: "Food, plus a little oxygen. Needs two workers. Shed first in a brownout.",
    },
    cistern: {
      id: "cistern", name: "Water Cistern", glyph: "CIS",
      foot: [1, 1], h: 16, color: "#2a3a40",
      cost: { power: 0 },
      staffing: 0, consumes: {}, produces: {},
      requiresPressure: false, priority: 0, caps: { water: 160 },
      desc: "Holds water. Buffers the gap between extraction and demand.",
    },
    o2tank: {
      id: "o2tank", name: "Oxygen Tank", glyph: "TNK",
      foot: [1, 1], h: 18, color: "#28363f",
      cost: { power: 0 },
      staffing: 0, consumes: {}, produces: {},
      requiresPressure: false, priority: 0, caps: { oxygen: 130 },
      desc: "Reserve oxygen. Counts down the suffocation timer for you.",
    },
  };

  const ORDER = ["hub", "corridor", "hab", "solar", "battery", "extractor",
    "electrolysis", "greenhouse", "cistern", "o2tank"];

  // ---- Per-colonist life-support demand, per second --------------------------
  const PERSON = { oxygen: 0.22, water: 0.16, food: 0.12 };

  const BASE_CAP = { power: 80, water: 60, oxygen: 40, food: 60 };

  // ---- State -----------------------------------------------------------------
  let state = null;
  let listeners = [];
  let uid = 1;

  function fresh() {
    return {
      N: 11,
      grid: {},                 // "gx,gy" -> building uid (every occupied cell)
      buildings: [],            // {uid, def, gx, gy, online, connected, staffed, fed, util}
      pools: {
        power: { amount: 60, cap: BASE_CAP.power },
        water: { amount: 40, cap: BASE_CAP.water },
        oxygen: { amount: 35, cap: BASE_CAP.oxygen },
        food: { amount: 45, cap: BASE_CAP.food },
      },
      flow: { power: 0, water: 0, oxygen: 0, food: 0 },
      population: 0, housing: 0, labor: 0, laborUsed: 0,
      sol: 1, tod: 0.32,        // start mid-morning
      solLength: 150,           // seconds per sol (compressed)
      weather: "clear",         // clear | dust
      stormT: 0, stormDur: 0, nextStorm: 95,
      solarMul: 0,
      timers: { oxygen: null, water: null, food: null },  // seconds remaining
      grace: 55,                // seconds a pool can sit empty before lethal
      dead: 0,
      events: [],
      arrivalsLeft: 3, nextArrival: 30,
      paused: false, speed: 1,
      t: 0,                     // elapsed sim seconds
      started: false,
    };
  }

  function key(x, y) { return x + "," + y; }

  // ---- Placement -------------------------------------------------------------
  function cellsFor(def, gx, gy) {
    const out = [];
    for (let dx = 0; dx < def.foot[0]; dx++)
      for (let dy = 0; dy < def.foot[1]; dy++) out.push([gx + dx, gy + dy]);
    return out;
  }

  function canPlace(defId, gx, gy) {
    const def = DEFS[defId];
    if (!def) return false;
    for (const [x, y] of cellsFor(def, gx, gy)) {
      if (x < 0 || y < 0 || x >= state.N || y >= state.N) return false;
      if (state.grid[key(x, y)] != null) return false;
    }
    return true;
  }

  function place(defId, gx, gy) {
    if (!canPlace(defId, gx, gy)) return false;
    const def = DEFS[defId];
    const b = {
      uid: uid++, def, gx, gy,
      online: false, connected: false, staffed: false, fed: false, util: 0,
    };
    state.buildings.push(b);
    for (const [x, y] of cellsFor(def, gx, gy)) state.grid[key(x, y)] = b.uid;
    recomputeCaps();
    emit({ type: "build", defId, name: def.name });
    if (def.isHub) emit({ type: "hub_online" });
    notify();
    return true;
  }

  function removeAt(gx, gy) {
    const id = state.grid[key(gx, gy)];
    if (id == null) return false;
    const b = state.buildings.find((x) => x.uid === id);
    if (!b) return false;
    for (const [x, y] of cellsFor(b.def, b.gx, b.gy)) delete state.grid[key(x, y)];
    state.buildings = state.buildings.filter((x) => x.uid !== id);
    recomputeCaps();
    notify();
    return true;
  }

  function buildingAt(gx, gy) {
    const id = state.grid[key(gx, gy)];
    if (id == null) return null;
    return state.buildings.find((x) => x.uid === id) || null;
  }

  function recomputeCaps() {
    const caps = { ...BASE_CAP };
    let housing = 0;
    for (const b of state.buildings) {
      if (b.def.caps) for (const k in b.def.caps) caps[k] += b.def.caps[k];
      if (b.def.popCap) housing += b.def.popCap;
    }
    for (const k in caps) {
      state.pools[k].cap = caps[k];
      if (state.pools[k].amount > caps[k]) state.pools[k].amount = caps[k];
    }
    state.housing = housing;
  }

  // ---- Connectivity: flood-fill from the hub through conduits/sealed cells ----
  function recomputeConnectivity() {
    for (const b of state.buildings) b.connected = false;
    const hub = state.buildings.find((b) => b.def.isHub);
    if (!hub) return;
    // Adjacency over the union of hub + conduit cells; pressurized buildings
    // count as connected if any of their cells touches the reached set.
    const reached = new Set();
    const q = [];
    const seed = (b) => { for (const [x, y] of cellsFor(b.def, b.gx, b.gy)) { if (!reached.has(key(x, y))) { reached.add(key(x, y)); q.push([x, y]); } } };
    seed(hub); hub.connected = true;
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    while (q.length) {
      const [x, y] = q.pop();
      for (const [ox, oy] of nb) {
        const nx = x + ox, ny = y + oy, kk = key(nx, ny);
        const id = state.grid[kk];
        if (id == null || reached.has(kk)) continue;
        const nbld = state.buildings.find((b) => b.uid === id);
        if (!nbld) continue;
        // conduits (corridors) and the hub extend the seal; habs/units attach
        if (nbld.def.isHub || nbld.def.conduit) { reached.add(kk); q.push([nx, ny]); nbld.connected = true; }
      }
    }
    // attach pressurized buildings adjacent to the reached seal
    for (const b of state.buildings) {
      if (b.connected) continue;
      for (const [x, y] of cellsFor(b.def, b.gx, b.gy)) {
        for (const [ox, oy] of nb) {
          if (reached.has(key(x + ox, y + oy))) { b.connected = true; break; }
        }
        if (b.connected) break;
      }
    }
  }

  // ---- Environment -----------------------------------------------------------
  function solarOutput() {
    // daytime curve: sun above horizon between tod 0.22..0.80, peak at noon
    const t = state.tod;
    let day = 0;
    if (t > 0.22 && t < 0.80) {
      const phase = (t - 0.22) / (0.58);
      day = Math.sin(phase * Math.PI);
    }
    const stormMul = state.weather === "dust" ? 0.12 : 1;
    return Math.max(0, day) * stormMul;
  }

  // ---- The tick: ordered passes ---------------------------------------------
  function tick(dt) {
    const s = state;
    s.t += dt;

    // 1. Environment / sol clock
    const prevTod = s.tod;
    s.tod += dt / s.solLength;
    while (s.tod >= 1) { s.tod -= 1; s.sol += 1; emit({ type: "new_sol", sol: s.sol }); }
    if (prevTod < 0.80 && s.tod >= 0.80) emit({ type: "dusk" });
    if (prevTod < 0.22 && s.tod >= 0.22) emit({ type: "dawn" });

    // weather scheduling
    if (s.weather === "clear") {
      s.nextStorm -= dt;
      if (s.nextStorm <= 0) {
        s.weather = "dust"; s.stormDur = 26 + Math.random() * 14; s.stormT = s.stormDur;
        emit({ type: "storm_in", secs: Math.round(s.stormDur) });
      }
    } else {
      s.stormT -= dt;
      if (s.stormT <= 0) { s.weather = "clear"; s.nextStorm = 80 + Math.random() * 70; emit({ type: "storm_clear" }); }
    }
    const solarMul = solarOutput();
    s.solarMul = solarMul;

    recomputeConnectivity();

    // labor pool = housed population
    s.labor = s.population; s.laborUsed = 0;

    // net flow accumulators (per second) for the HUD
    const net = { power: 0, water: 0, oxygen: 0, food: 0 };

    // 2. Generation into the power buffer
    let gen = 0;
    for (const b of s.buildings) if (b.def.solar) gen += b.def.solar * solarMul;
    addPool("power", gen * dt); net.power += gen;

    // 3. Power demand by priority — brownout sheds the bottom first
    const consumers = s.buildings
      .filter((b) => Object.keys(b.def.consumes).length && (b.def.consumes.power || 0) > 0)
      .sort((a, b) => b.def.priority - a.def.priority);
    let powerAvail = s.pools.power.amount; // what's in the battery this tick
    for (const b of s.buildings) b.online = false;
    for (const b of consumers) {
      const need = (b.def.consumes.power || 0) * dt;
      if (powerAvail >= need) { b.online = true; powerAvail -= need; }
      else { b.online = false; }
    }
    // buildings with no power draw are "online" if other gates pass
    for (const b of s.buildings) if (!(b.def.consumes.power > 0)) b.online = true;

    // 4. Production — online AND connected AND staffed AND fed
    for (const b of s.buildings) {
      b.util = 0; b.staffed = true; b.fed = true;
      const d = b.def;
      if (!b.online) continue;
      if (d.requiresPressure && !b.connected) { b.online = false; continue; }
      // staffing
      if (d.staffing > 0) {
        if (s.laborUsed + d.staffing <= s.labor) s.laborUsed += d.staffing;
        else { b.staffed = false; b.online = false; continue; }
      }
      // inputs (non-power) available?
      let ok = true;
      for (const k in d.consumes) {
        if (k === "power") continue;
        if (s.pools[k].amount < (d.consumes[k] * dt)) { ok = false; break; }
      }
      if (!ok) { b.fed = false; b.online = false;
        // still claimed power above; that's fine — it idles. release labor:
        if (d.staffing > 0) s.laborUsed -= d.staffing;
        continue; }
      // run recipe
      for (const k in d.consumes) { takePool(k, d.consumes[k] * dt); if (k !== "power") net[k] -= d.consumes[k]; else net.power -= d.consumes[k]; }
      for (const k in d.produces) { addPool(k, d.produces[k] * dt); net[k] += d.produces[k]; }
      b.util = 1;
    }
    // account power consumed by zero-input online consumers (hub/corridor/hab/battery passive)
    // (already handled via takePool inside loop for those with consumes)

    // 5. Colonist consumption
    if (s.population > 0) {
      for (const k in PERSON) {
        const d = PERSON[k] * s.population;
        takePool(k, d * dt); net[k] -= d;
      }
    }

    // 6. Shortfalls become timers, not instant death
    for (const k of ["oxygen", "water", "food"]) {
      const empty = s.pools[k].amount <= 0.001 && net[k] < 0 && s.population > 0;
      if (empty) {
        if (s.timers[k] == null) { s.timers[k] = s.grace; emit({ type: "crit_start", res: k }); }
        else s.timers[k] -= dt;
        if (s.timers[k] <= 0) {
          // lethal: lose a colonist, reset a little grace
          const lost = Math.min(s.population, 1);
          s.population -= lost; s.dead += lost; s.timers[k] = s.grace * 0.5;
          emit({ type: "casualty", res: k, n: lost });
        }
      } else if (s.timers[k] != null) {
        s.timers[k] = null; emit({ type: "crit_clear", res: k });
      }
    }

    // brownout detection (any pressurized consumer offline purely for power)
    detectBrownout(net);

    // arrivals — only when there's a real surplus and housing
    s.nextArrival -= dt;
    if (s.arrivalsLeft > 0 && s.nextArrival <= 0) {
      const surplus = net.oxygen > 0 && net.food > 0 && net.water > 0;
      const room = s.population + 4 <= s.housing;
      if (surplus && room && s.population > 0) {
        s.population += 4; s.arrivalsLeft -= 1; s.nextArrival = 55 + Math.random() * 40;
        emit({ type: "arrival", n: 4, pop: s.population });
      } else { s.nextArrival = 12; }
    }

    s.flow = net;
  }

  let _brownLatch = false;
  function detectBrownout(net) {
    const s = state;
    const short = net.power < -0.2 && s.pools.power.amount < 2;
    if (short && !_brownLatch) { _brownLatch = true; emit({ type: "brownout" }); }
    if (!short && _brownLatch && s.pools.power.amount > s.pools.power.cap * 0.15) {
      _brownLatch = false; emit({ type: "power_back" });
    }
  }

  function addPool(k, amt) { const p = state.pools[k]; if (!p) return; p.amount = Math.min(p.cap, p.amount + amt); }
  function takePool(k, amt) { const p = state.pools[k]; if (!p) return; p.amount = Math.max(0, p.amount - amt); }

  // ---- Events ----------------------------------------------------------------
  function emit(e) { e.t = state.t; e.sol = state.sol; e.tod = state.tod; state.events.push(e); for (const fn of evtListeners) fn(e); }
  let evtListeners = [];
  function onEvent(fn) { evtListeners.push(fn); }

  // ---- Loop driving ----------------------------------------------------------
  function notify() { for (const fn of listeners) fn(); }
  function subscribe(fn) { listeners.push(fn); return () => { listeners = listeners.filter((f) => f !== fn); }; }

  // seed a starter colony so the sim is alive on load
  function seed() {
    place("hub", 4, 4);
    place("battery", 3, 3);
    place("corridor", 4, 6);
    place("corridor", 5, 6);
    place("hab", 3, 6);
    place("hab", 6, 6);
    place("electrolysis", 5, 7);
    place("solar", 7, 3);
    place("solar", 7, 6);
    place("extractor", 8, 8);
    state.population = 4;
    recomputeCaps();
  }

  // ---- Public API ------------------------------------------------------------
  window.Engine = {
    DEFS, ORDER,
    init() { state = fresh(); seed(); state.started = true; notify(); },
    reset() { uid = 1; _brownLatch = false; state = fresh(); seed(); state.started = true; notify(); },
    tick(dt) { if (!state || state.paused) return; tick(dt * (state.speed || 1)); },
    get state() { return state; },
    place, removeAt, canPlace, buildingAt, cellsFor,
    subscribe, onEvent,
    setPaused(v) { state.paused = v; notify(); },
    setSpeed(v) { state.speed = v; notify(); },
    forceStorm() { if (state.weather === "clear") { state.nextStorm = 0; } },
  };
})();
