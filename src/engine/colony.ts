/* ============================================================================
   Colony — the engine's public object. Deterministic, synchronous, standalone.
   No DOM, no three, no network, no async (doc §0). Hosts the state, applies
   commands, advances the tick, and buffers events for an observer to drain.
   ============================================================================ */
import type {
  BuildingDef, BuildingState, ColonyEvent, Resource, Snapshot,
} from "@shared/types";
import { RESOURCES } from "@shared/types";
import { DEFS } from "./defs";
import {
  BASE_CAP, START_AMOUNT, GRID_N, SOL_LENGTH, START_TOD, GRACE,
  STORM_FIRST, ARRIVALS_TOTAL, ARRIVAL_FIRST, DEFAULT_SEED,
} from "./tuning";
import { RNG } from "./rng";
import { canPlace, cellsFor, idx } from "./grid";
import { tick as runTick } from "./tick";
import type { ColonyState, SaveData } from "./state";
import { emptyBuilding } from "./state";

export class Colony {
  private s: ColonyState;
  private rng: RNG;
  private seed: number;
  private events: ColonyEvent[] = [];

  constructor(seed: number = DEFAULT_SEED) {
    this.seed = seed >>> 0;
    this.rng = new RNG(this.seed);
    this.s = freshState();
    this.seedColony();
    this.s.started = true;
  }

  // ---- lifecycle ------------------------------------------------------------
  private emit = (e: Omit<ColonyEvent, "t" | "sol" | "tod">): void => {
    this.events.push({ ...e, t: this.s.t, sol: this.s.sol, tod: this.s.tod } as ColonyEvent);
  };

  /** advance the sim by dt seconds (caller handles pause/speed) */
  tick(dt: number): void {
    runTick(this.s, dt, this.rng, this.emit);
  }

  /** pull and clear the events emitted since the last drain */
  drainEvents(): ColonyEvent[] {
    if (this.events.length === 0) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  reset(): void {
    this.rng = new RNG(this.seed);
    this.s = freshState();
    this.events = [];
    this.seedColony();
    this.s.started = true;
  }

  // ---- placement ------------------------------------------------------------
  canPlace(defId: string, gx: number, gy: number): boolean {
    const def = DEFS[defId];
    return !!def && canPlace(this.s, def, gx, gy);
  }

  place(defId: string, gx: number, gy: number): boolean {
    const def = DEFS[defId];
    if (!def || !canPlace(this.s, def, gx, gy)) return false;
    const b = emptyBuilding(this.s.uidCounter++, defId, gx, gy);
    this.s.buildings.push(b);
    for (const [x, y] of cellsFor(def, gx, gy)) this.s.grid[idx(this.s.N, x, y)] = b.uid;
    this.recomputeCaps();
    this.emit({ type: "build", defId, name: def.name });
    if (def.isHub) this.emit({ type: "hub_online" });
    return true;
  }

  removeAt(gx: number, gy: number): boolean {
    const id = this.s.grid[idx(this.s.N, gx, gy)];
    if (id === 0) return false;
    const b = this.s.buildings.find((x) => x.uid === id);
    if (!b) return false;
    const def = DEFS[b.defId];
    for (const [x, y] of cellsFor(def, b.gx, b.gy)) this.s.grid[idx(this.s.N, x, y)] = 0;
    this.s.buildings = this.s.buildings.filter((x) => x.uid !== id);
    this.recomputeCaps();
    return true;
  }

  buildingAt(gx: number, gy: number): BuildingState | null {
    if (gx < 0 || gy < 0 || gx >= this.s.N || gy >= this.s.N) return null;
    const id = this.s.grid[idx(this.s.N, gx, gy)];
    if (id === 0) return null;
    return this.s.buildings.find((x) => x.uid === id) ?? null;
  }

  cellsForDef(defId: string, gx: number, gy: number): [number, number][] {
    const def = DEFS[defId];
    return def ? cellsFor(def, gx, gy) : [];
  }

  // ---- controls (the worker loop reads paused/speed) ------------------------
  setPaused(v: boolean): void { this.s.paused = v; }
  setSpeed(v: number): void { this.s.speed = v; }
  forceStorm(): void { if (this.s.weather === "clear") this.s.nextStorm = 0; }
  get paused(): boolean { return this.s.paused; }
  get speed(): number { return this.s.speed; }

  // ---- capacities -----------------------------------------------------------
  private recomputeCaps(): void {
    const caps: Record<Resource, number> = { ...BASE_CAP };
    let housing = 0;
    for (const b of this.s.buildings) {
      const def = DEFS[b.defId];
      if (def.caps) for (const k in def.caps) caps[k as Resource] += def.caps[k as Resource]!;
      if (def.popCap) housing += def.popCap;
    }
    for (const k of RESOURCES) {
      this.s.pools[k].capacity = caps[k];
      if (this.s.pools[k].amount > caps[k]) this.s.pools[k].amount = caps[k];
    }
    this.s.housing = housing;
  }

  // ---- starter colony so the sim is alive on load (doc seed) ----------------
  private seedColony(): void {
    this.place("hub", 4, 4);
    this.place("battery", 3, 3);
    this.place("corridor", 4, 6);
    this.place("corridor", 5, 6);
    this.place("hab", 3, 6);
    this.place("hab", 6, 6);
    this.place("electrolysis", 5, 7);
    this.place("solar", 7, 3);
    this.place("solar", 7, 6);
    this.place("extractor", 8, 8);
    this.s.population = 4;
    this.recomputeCaps();
    // seeding emits build events; the colony isn't "speaking" yet, so clear them
    this.events = [];
  }

  // ---- snapshot (serializable read-only view, doc §0) -----------------------
  snapshot(): Snapshot {
    const s = this.s;
    return {
      N: s.N,
      buildings: s.buildings.map((b) => ({ ...b })),
      pools: {
        power: { ...s.pools.power },
        water: { ...s.pools.water },
        oxygen: { ...s.pools.oxygen },
        food: { ...s.pools.food },
      },
      flow: { ...s.flow },
      population: s.population,
      housing: s.housing,
      labor: s.labor,
      laborUsed: s.laborUsed,
      sol: s.sol,
      tod: s.tod,
      solLength: s.solLength,
      weather: s.weather,
      stormT: s.stormT,
      solarMul: s.solarMul,
      timers: { ...s.timers },
      grace: s.grace,
      dead: s.dead,
      paused: s.paused,
      speed: s.speed,
      t: s.t,
      started: s.started,
    };
  }

  // ---- save / load (doc §5) -------------------------------------------------
  serialize(): SaveData {
    return {
      version: 1,
      seed: this.seed,
      rngState: this.rng.getState(),
      // structuredClone-friendly deep copy; grid is a typed array
      state: {
        ...this.s,
        grid: this.s.grid.slice(),
        buildings: this.s.buildings.map((b) => ({ ...b })),
        pools: {
          power: { ...this.s.pools.power },
          water: { ...this.s.pools.water },
          oxygen: { ...this.s.pools.oxygen },
          food: { ...this.s.pools.food },
        },
        flow: { ...this.s.flow },
        timers: { ...this.s.timers },
      },
    };
  }

  static load(data: SaveData): Colony {
    const c = new Colony(data.seed);
    c.rng.setState(data.rngState);
    const st = data.state;
    c.s = {
      ...st,
      grid: st.grid instanceof Int32Array ? st.grid.slice() : Int32Array.from(st.grid as ArrayLike<number>),
      buildings: st.buildings.map((b) => ({ ...b })),
      pools: {
        power: { ...st.pools.power },
        water: { ...st.pools.water },
        oxygen: { ...st.pools.oxygen },
        food: { ...st.pools.food },
      },
      flow: { ...st.flow },
      timers: { ...st.timers },
    };
    c.events = [];
    return c;
  }

  /** live def lookup for callers that need recipe data */
  static def(defId: string): BuildingDef | undefined {
    return DEFS[defId];
  }
}

function freshState(): ColonyState {
  const N = GRID_N;
  return {
    N,
    grid: new Int32Array(N * N),
    buildings: [],
    pools: {
      power: { amount: START_AMOUNT.power, capacity: BASE_CAP.power },
      water: { amount: START_AMOUNT.water, capacity: BASE_CAP.water },
      oxygen: { amount: START_AMOUNT.oxygen, capacity: BASE_CAP.oxygen },
      food: { amount: START_AMOUNT.food, capacity: BASE_CAP.food },
    },
    flow: { power: 0, water: 0, oxygen: 0, food: 0 },
    population: 0,
    housing: 0,
    labor: 0,
    laborUsed: 0,
    sol: 1,
    tod: START_TOD,
    solLength: SOL_LENGTH,
    weather: "clear",
    stormT: 0,
    stormDur: 0,
    nextStorm: STORM_FIRST,
    solarMul: 0,
    timers: { oxygen: null, water: null, food: null },
    grace: GRACE,
    dead: 0,
    arrivalsLeft: ARRIVALS_TOTAL,
    nextArrival: ARRIVAL_FIRST,
    nextResupply: Infinity, // wired in Phase 6
    resupplyT: 0,
    paused: false,
    speed: 1,
    t: 0,
    started: false,
    uidCounter: 1,
    brownLatch: false,
  };
}
