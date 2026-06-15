/* ============================================================================
   Colony — the engine's public object. Deterministic, synchronous, standalone.
   No DOM, no three, no network, no async (doc §0). Hosts the state, applies
   commands, advances the tick, and buffers events for an observer to drain.
   ============================================================================ */
import type {
  BuildingDef, BuildingState, ColonyEvent, Difficulty, LegacyManifest, Resource, ShipmentManifest, Side, Snapshot, World,
} from "@shared/types";
import { DEFS } from "./defs";
import {
  BASE_CAP, GRID_N, SOL_LENGTH, START_TOD, CATCHUP_STEP,
  ARRIVALS_TOTAL, ARRIVAL_FIRST, RESUPPLY_FIRST,
  TARGET_POP, SELF_SUFFICIENCY_GOAL, DEFAULT_SEED,
} from "./tuning";
import { RNG } from "./rng";
import { canPlace, cellsFor, idx, inBounds, migrateGrid } from "./grid";
import { tick as runTick } from "./tick";
import { planRoute } from "./route";
import { recomputeCaps } from "./caps";
import { spawnHazard, hazardViews, SCHED_FIRST } from "./hazards";
import type { HazardKind } from "@shared/types";
import type { ColonyState, SaveData } from "./state";
import { buildingFunctional } from "./state";
import { emptyBuilding, emptyColonist } from "./state";
import { reconcileColonists, colonistViews, depositViews, clampMaterials, interactPossessed, baseCenter, freeCellNear } from "./colonists";
import { computeUnlocks } from "./unlocks";
import { seedDeposits, seedVents, seedAquifers } from "./deposits";
import { respondTrade as applyRespondTrade, tradeView } from "./trade";
import { ufoView } from "./ufo";
import { roverViews } from "./rover";
import { robotViews } from "./robots";
import {
  START_MATERIALS, MATERIALS_CAP, TRADE_FIRST, DEPOSIT_RESPAWN, UFO_FIRST, BIRTH_FIRST,
  MORALE_START, DIFFICULTY, VENT_BACKFILL_SALT, AQUIFER_BACKFILL_SALT, RESUPPLY_AMOUNT,
  ROVER_BUILD_TIME, ROBOT_BUILD_TIME, worldProfile,
} from "./tuning";

export class Colony {
  private s: ColonyState;
  private rng: RNG;
  /** a separate stream for the deposit field + trade windows, so the embodied
   *  layer never perturbs the main hazard/arrival rng (keeps determinism tests). */
  private envRng: RNG;
  private seed: number;
  private events: ColonyEvent[] = [];

  constructor(seed: number = DEFAULT_SEED, difficulty: Difficulty = "normal", world: World = "mars") {
    this.seed = seed >>> 0;
    this.rng = new RNG(this.seed);
    this.envRng = new RNG((this.seed ^ 0x9e3779b9) >>> 0);
    this.s = freshState(difficulty, world);
    this.seedColony();
    this.s.started = true;
  }

  // ---- lifecycle ------------------------------------------------------------
  private emit = (e: Omit<ColonyEvent, "t" | "sol" | "tod">): void => {
    this.events.push({ ...e, t: this.s.t, sol: this.s.sol, tod: this.s.tod } as ColonyEvent);
  };

  /** advance the sim by dt seconds (caller handles pause/speed) */
  tick(dt: number): void {
    runTick(this.s, dt, this.rng, this.envRng, this.emit);
  }

  /** pull and clear the events emitted since the last drain */
  drainEvents(): ColonyEvent[] {
    if (this.events.length === 0) return [];
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Deterministically advance the colony by `steps` catch-up sub-steps (each exactly
   *  CATCHUP_STEP seconds) — the fast-forward for an away colony on switch (parallel-
   *  colonies Round 4). Driving by an integer step COUNT (not a float budget) makes it
   *  CHUNKING-INVARIANT: fastForward(i) then fastForward(j) is byte-identical to
   *  fastForward(i+j) — because each step is the SAME size and integer addition is exact,
   *  there is no float residual whose rounding depends on where a call stopped. So the
   *  host can stream catch-up progress across frames without forking determinism.
   *  Reproducible (fixed step + seeded RNG); stops early once the run ends so a finished
   *  colony is never over-ticked. `collect` accumulates the emitted events for the "while
   *  you were away" digest. The step count is computed MAIN-SIDE (the engine never reads a
   *  clock — the wall): steps = round(elapsedSimSeconds / CATCHUP_STEP). */
  fastForward(steps: number, collect = false): ColonyEvent[] {
    const out: ColonyEvent[] = [];
    let n = Math.max(0, Math.floor(steps));
    while (n > 0 && this.s.outcome === null) {
      this.tick(CATCHUP_STEP);
      if (collect) out.push(...this.drainEvents());
      else this.events = [];
      n--;
    }
    return out;
  }

  /** DEBIT an inter-planet shipment from this (live) colony — the sender side of a
   *  transfer (parallel-colonies). Pools + materials clamp at zero; crew leaves the
   *  roster (the highest ids, so the commander — lowest id — stays). A deterministic
   *  player act, mirroring respondTrade's pool debit; ZERO rng. */
  dispatchShipment(m: ShipmentManifest): void {
    if (m.resources) for (const [r, amt] of Object.entries(m.resources) as [Resource, number][]) {
      const p = this.s.pools[r];
      p.amount = Math.max(0, p.amount - amt);
    }
    if (m.materials) this.s.materials.amount = Math.max(0, this.s.materials.amount - m.materials);
    if (m.crew && m.crew > 0) { this.s.population = Math.max(0, this.s.population - m.crew); reconcileColonists(this.s); }
  }

  /** CREDIT a shipment as plain seed-state — the receiver side, applied on load BEFORE
   *  the catch-up (like carried legacy). Resources + materials clamp to capacity (full
   *  tanks vent the overflow); crew arrives as FRESH colonists minted from the counter
   *  (new ids — no collision, no commander surprise). ZERO rng, so the colony stays
   *  reproducible. */
  creditShipment(m: ShipmentManifest): void {
    if (m.resources) for (const [r, amt] of Object.entries(m.resources) as [Resource, number][]) {
      const p = this.s.pools[r];
      p.amount = Math.min(p.capacity, p.amount + amt);
    }
    if (m.materials) this.s.materials.amount = Math.min(this.s.materials.capacity, this.s.materials.amount + m.materials);
    if (m.crew && m.crew > 0) { this.s.population += m.crew; reconcileColonists(this.s); }
  }

  /** restart the run. Founding (PTP) can hand in a new seed and world; omitting
   *  any of the three keeps the current colony's value. seed/world enter as
   *  deterministic inputs — the engine never originates them (the wall). */
  reset(difficulty?: Difficulty, seed?: number, world?: World, legacy?: LegacyManifest): void {
    if (seed !== undefined) this.seed = seed >>> 0;
    this.rng = new RNG(this.seed);
    this.envRng = new RNG((this.seed ^ 0x9e3779b9) >>> 0);
    this.s = freshState(difficulty ?? this.s.difficulty, world ?? this.s.world);
    this.events = [];
    this.seedColony(legacy);
    this.s.started = true;
  }

  /** PTP launch (the wall): a deliberate player act — NOT a tick threshold. If a
   *  functional Transport Pod is built and the run is still live, end it as an
   *  EXPANSION (the run-ending that founds the next world). The engine only
   *  records the outcome + emits the event; the main thread orchestrates the
   *  founding (archive the world, pick the next, carry the legacy). No-op if
   *  there's no working pod or the run already ended. */
  launchPtp(): void {
    if (this.s.outcome !== null) return; // the run already ended
    // ANY intact pod will do — match the functional one directly, so a damaged pod
    // built earlier can't mask a working one (find returns the lowest index). Gated
    // on integrity/fault only, NOT power: a transient brownout must never brick the
    // one-shot endgame and strand the run (the pod's 8-power draw is an ongoing cost).
    const pod = this.s.buildings.find((b) => b.defId === "ptp" && buildingFunctional(b));
    if (!pod) return; // need a working pod to leave
    this.s.outcome = "expansion";
    this.s.outcomeReason = "expansion";
    this.s.paused = true;
    this.emit({ type: "expansion" });
  }

  // ---- placement ------------------------------------------------------------
  canPlace(defId: string, gx: number, gy: number): boolean {
    const def = DEFS[defId];
    return !!def && canPlace(this.s, def, gx, gy);
  }

  place(defId: string, gx: number, gy: number, rot: Side = 0): boolean {
    const def = DEFS[defId];
    if (!def || !canPlace(this.s, def, gx, gy)) return false;
    const b = emptyBuilding(this.s.uidCounter++, defId, gx, gy, rot);
    this.s.buildings.push(b);
    for (const [x, y] of cellsFor(def, gx, gy)) this.s.grid[idx(this.s.N, x, y)] = b.uid;
    this.s.materials.amount = Math.max(0, this.s.materials.amount - (def.matCost ?? 0)); // pay for it
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

  /** auto-route corridors between two buildings' doors (doc §2.3 reskinned). */
  route(fromUid: number, toUid: number): boolean {
    const blocked = (x: number, y: number): boolean => {
      const id = this.s.grid[idx(this.s.N, x, y)];
      if (id === 0) return false;
      const b = this.s.buildings.find((bb) => bb.uid === id);
      return !!b && !DEFS[b.defId].conduit; // corridors are passable
    };
    const path = planRoute(this.s.buildings, this.s.N, blocked, fromUid, toUid);
    if (!path) return false;
    for (const [x, y] of path) {
      if (this.s.grid[idx(this.s.N, x, y)] === 0) this.place("corridor", x, y);
    }
    return true;
  }

  /** relocate a placed building to a new footprint, if it fits (keeps its uid,
   *  rotation, integrity, etc.). Connectivity recomputes next tick. */
  move(uid: number, gx: number, gy: number): boolean {
    const b = this.s.buildings.find((x) => x.uid === uid);
    if (!b) return false;
    const def = DEFS[b.defId];
    const oldCells = cellsFor(def, b.gx, b.gy);
    for (const [x, y] of oldCells) this.s.grid[idx(this.s.N, x, y)] = 0;
    let ok = true;
    for (const [x, y] of cellsFor(def, gx, gy)) {
      if (!inBounds(this.s.N, x, y) || this.s.grid[idx(this.s.N, x, y)] !== 0) { ok = false; break; }
    }
    if (!ok) { // restore in place
      for (const [x, y] of oldCells) this.s.grid[idx(this.s.N, x, y)] = b.uid;
      return false;
    }
    for (const [x, y] of cellsFor(def, gx, gy)) this.s.grid[idx(this.s.N, x, y)] = b.uid;
    b.gx = gx; b.gy = gy;
    return true;
  }

  /** rotate the building at a cell one quarter-turn (aims its door). Footprints
   *  are square, so this never changes occupancy. */
  rotateAt(gx: number, gy: number): boolean {
    const b = this.buildingAt(gx, gy);
    if (!b) return false;
    b.rot = ((b.rot + 1) % 4) as Side;
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
  /** the storm button → a full-intensity dust hazard */
  forceStorm(): void { this.triggerHazard("dust", 1); }
  get paused(): boolean { return this.s.paused; }
  get speed(): number { return this.s.speed; }

  // ---- hazards (the living environment) -------------------------------------
  /** spawn a hazard now (used by the storm button and the agent-layer Director) */
  triggerHazard(kind: HazardKind, intensity?: number): void {
    const inten = spawnHazard(this.s, kind, this.rng, intensity);
    this.emit({ type: "hazard_warn", kind, detail: kind, secs: 6 });
    void inten;
  }
  /** hand hazard control to an external Director (engine scheduler stands down) */
  setDirector(on: boolean): void { this.s.directorControlled = on; }

  // ---- embodied control (the player possesses one actor) --------------------
  /** possess an actor by id (null releases) — colonists resolve first, then
   *  rovers; the unified id space (rover ids draw from the colonist counter)
   *  keeps the protocol unchanged. Resets any standing move intent. */
  possess(id: number | null): void {
    if (id == null) { this.s.possessed = null; this.s.moveIntent = { dx: 0, dy: 0 }; return; }
    if (this.s.colonists.some((c) => c.id === id) || this.s.rovers.some((r) => r.id === id)) {
      this.s.possessed = id;
      this.s.moveIntent = { dx: 0, dy: 0 };
    }
  }
  /** the player's standing WASD direction for the possessed colonist */
  setMoveIntent(dx: number, dy: number): void { this.s.moveIntent = { dx, dy }; }
  /** the player pressed P — pick up from a deposit / drop at the depot */
  interact(): void { interactPossessed(this.s); }
  /** accept/decline a landed alien trade offer */
  respondTrade(accept: boolean): void { applyRespondTrade(this.s, accept, this.emit); }

  // ---- capacities -----------------------------------------------------------
  private recomputeCaps(): void { recomputeCaps(this.s); }

  // ---- starter colony so the sim is alive on load (doc seed) ----------------
  private seedColony(legacy?: LegacyManifest): void {
    // the starter buildings are a gift — placement charges materials, so float
    // the budget high while seeding, then set the real starting stock after.
    this.s.materials.amount = 9999;
    // doors face the corridor network so the seed reads as connected (rot aims
    // the door: hub south, hab(3,6) east, hab(6,6) west, electrolysis north)
    this.place("hub", 4, 4, 0);
    this.place("battery", 3, 3);
    this.place("corridor", 4, 6);
    this.place("corridor", 5, 6);
    this.place("hab", 3, 6, 3);
    this.place("hab", 6, 6, 1);
    this.place("electrolysis", 5, 7, 2);
    this.place("solar", 7, 3);
    this.place("solar", 7, 6);
    this.place("extractor", 8, 8);
    this.s.population = 4;
    this.s.materials.amount = DIFFICULTY[this.s.difficulty].startMaterials; // the real starting stock
    clampMaterials(this.s);
    // collection depot: a clear drop-off just off the hub's east side
    const hubB = this.s.buildings.find((b) => DEFS[b.defId]?.isHub);
    if (hubB) this.s.depot = { gx: hubB.gx + (DEFS[hubB.defId].foot[0] ?? 2), gy: hubB.gy + 1 };
    // carried legacy (PTP): seed veterans at their LITERAL ids before reconcile, so
    // name/role (pure id hashes) and commander rank (lowest living id) carry; bump
    // the counter past them so fresh recruits get higher ids and no later mint dups.
    // The carried alien tech rides acquiredTech, applied by recomputeCaps below.
    if (legacy?.veterans.length) {
      const center = baseCenter(this.s);
      for (const id of legacy.veterans) {
        const cell = freeCellNear(this.s, center);
        this.s.colonists.push(emptyColonist(id, cell.x, cell.y));
      }
      this.s.colonistCounter = Math.max(this.s.colonistCounter, ...legacy.veterans) + 1;
    }
    if (legacy?.tech && !this.s.acquiredTech.includes(legacy.tech)) {
      this.s.acquiredTech.push(legacy.tech);
    }
    reconcileColonists(this.s); // fills up to population with fresh recruits (ids past any veterans)
    seedVents(this.s, this.envRng); // geothermal terrain first — deposits avoid it
    seedAquifers(this.s, this.envRng); // aquifer sites next (off vents) — deposits avoid them too
    seedDeposits(this.s, this.envRng); // scatter the resource field
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
      materials: { ...s.materials },
      colonists: colonistViews(s),
      deposits: depositViews(s),
      vents: s.vents.map((v) => ({ ...v })),
      aquifers: s.aquifers.map((a) => ({ ...a })),
      rovers: roverViews(s),
      robots: robotViews(s),
      depot: { ...s.depot },
      possessed: s.possessed,
      trade: tradeView(s),
      ufo: ufoView(s),
      acquiredTech: [...s.acquiredTech],
      unlocks: computeUnlocks(s),
      population: s.population,
      housing: s.housing,
      labor: s.labor,
      laborUsed: s.laborUsed,
      sol: s.sol,
      tod: s.tod,
      solLength: s.solLength,
      weather: s.weather,
      stormT: s.hazards.find((h) => h.kind === "dust" && h.phase === "active")?.tLeft ?? 0,
      solarMul: s.solarMul,
      windLevel: s.windLevel,
      hazards: hazardViews(s),
      directorControlled: s.directorControlled,
      nextResupply: s.nextResupply,
      resupplyT: s.resupplyT,
      timers: { ...s.timers },
      grace: s.grace,
      dead: s.dead,
      morale: s.morale,
      difficulty: s.difficulty,
      world: s.world,
      deadlineSol: s.deadlineSol,
      targetPop: s.targetPop,
      selfSufficientFor: s.selfSufficientFor,
      selfSufficiencyGoal: s.selfSufficiencyGoal,
      outcome: s.outcome,
      outcomeReason: s.outcomeReason,
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
      envRngState: this.envRng.getState(),
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
        resupplyBasket: { ...this.s.resupplyBasket },
        resupplyBanked: { ...this.s.resupplyBanked },
        materials: { ...this.s.materials },
        colonists: this.s.colonists.map((c) => ({ ...c })),
        rovers: this.s.rovers.map((r) => ({ ...r, cargo: { ...r.cargo } })),
        robots: this.s.robots.map((r) => ({ ...r })),
        deposits: this.s.deposits.map((d) => ({ ...d })),
        vents: this.s.vents.map((v) => ({ ...v })),
        aquifers: this.s.aquifers.map((a) => ({ ...a })),
        depot: { ...this.s.depot },
        moveIntent: { ...this.s.moveIntent },
        trade: this.s.trade ? { ...this.s.trade, give: { ...this.s.trade.give }, take: { ...this.s.trade.take } } : null,
        ufo: this.s.ufo ? { ...this.s.ufo } : null,
        acquiredTech: [...this.s.acquiredTech],
        unlocked: [...this.s.unlocked],
        timers: { ...this.s.timers },
        hazards: this.s.hazards.map((h) => ({ ...h })),
      },
    };
  }

  static load(data: SaveData): Colony {
    const c = new Colony(data.seed);
    c.rng.setState(data.rngState);
    if (data.envRngState !== undefined) c.envRng.setState(data.envRngState);
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
      // legacy saves predate the adaptive basket. Between windows the resting state is
      // all-zeros; but a pre-feature save caught MID-window (resupplyT > 0) carries no
      // basket, and zeros would silently deliver nothing for the rest of that window —
      // fall back to the original flat basket so the remaining window still lands.
      resupplyBasket: st.resupplyBasket
        ? { ...st.resupplyBasket }
        : st.resupplyT > 0
          ? { ...RESUPPLY_AMOUNT }
          : { power: 0, water: 0, oxygen: 0, food: 0 },
      resupplyBanked: st.resupplyBanked
        ? { ...st.resupplyBanked }
        : { power: 0, water: 0, oxygen: 0, food: 0 },
      materials: st.materials ? { ...st.materials } : { amount: START_MATERIALS, capacity: MATERIALS_CAP },
      colonists: (st.colonists ?? []).map((c2) => ({
        ...c2,
        injury: c2.injury ?? 0,
        gatherDepositId: c2.gatherDepositId ?? null,
        gatherT: c2.gatherT ?? 0,
      })),
      deposits: (st.deposits ?? []).map((d) => ({ ...d })),
      vents: (st.vents ?? []).map((v) => ({ ...v })),
      aquifers: (st.aquifers ?? []).map((a) => ({ ...a })),
      // legacy saves carry no machines: an empty fleet and a fresh countdown
      rovers: (st.rovers ?? []).map((r) => ({ ...r, cargo: { ...r.cargo } })),
      roverFab: st.roverFab ?? ROVER_BUILD_TIME,
      robots: (st.robots ?? []).map((r) => ({ ...r })),
      robotFab: st.robotFab ?? ROBOT_BUILD_TIME,
      windLevel: st.windLevel ?? 0,
      depot: st.depot ? { ...st.depot } : { gx: 6, gy: 5 },
      moveIntent: st.moveIntent ? { ...st.moveIntent } : { dx: 0, dy: 0 },
      trade: st.trade ? { ...st.trade, give: { ...st.trade.give }, take: { ...st.trade.take } } : null,
      ufo: st.ufo ? { ...st.ufo } : null,
      nextUfo: st.nextUfo ?? UFO_FIRST,
      nextBirth: st.nextBirth ?? BIRTH_FIRST,
      ufoCounter: st.ufoCounter ?? 1,
      morale: st.morale ?? MORALE_START,
      moraleLatch: st.moraleLatch ?? false,
      difficulty: st.difficulty ?? "normal",
      world: st.world ?? "mars", // legacy saves predate worlds → the anchor
      acquiredTech: [...(st.acquiredTech ?? [])],
      // legacy saves carry no latch: re-derive the currently-true gates on the
      // first tick, re-announcing the new buildings once (engine/unlocks.ts)
      unlocked: [...(st.unlocked ?? [])],
      timers: { ...st.timers },
      hazards: (st.hazards ?? []).map((h) => ({ ...h })),
    };
    // legacy backfill: a pre-generation-economy save carries no vents. Seed them
    // from a DERIVED rng — never the live envRng, whose serialized state must
    // keep resuming byte-identically — so every load of the same save gets the
    // same terrain and the same future.
    if (!st.vents) seedVents(c.s, new RNG((data.seed ^ VENT_BACKFILL_SALT) >>> 0));
    // same legacy backfill for aquifer sites — a separate DERIVED rng salt so the
    // live envRng is untouched and the two terrain kinds re-seed independently.
    if (!st.aquifers) seedAquifers(c.s, new RNG((data.seed ^ AQUIFER_BACKFILL_SALT) >>> 0));
    // an older save on a smaller build grid: re-center the colony into today's
    // larger grid rather than stranding the base in a corner. Pure, grows only.
    if (c.s.N < GRID_N) migrateGrid(c.s, GRID_N);
    c.events = [];
    return c;
  }

  /** live def lookup for callers that need recipe data */
  static def(defId: string): BuildingDef | undefined {
    return DEFS[defId];
  }
}

function freshState(difficulty: Difficulty, world: World = "mars"): ColonyState {
  const N = GRID_N;
  const prof = DIFFICULTY[difficulty];
  const wp = worldProfile(world); // world start pools (mars == START_AMOUNT)
  return {
    N,
    grid: new Int32Array(N * N),
    buildings: [],
    pools: {
      power: { amount: wp.startPools.power, capacity: BASE_CAP.power },
      water: { amount: wp.startPools.water, capacity: BASE_CAP.water },
      oxygen: { amount: wp.startPools.oxygen, capacity: BASE_CAP.oxygen },
      food: { amount: wp.startPools.food, capacity: BASE_CAP.food },
    },
    flow: { power: 0, water: 0, oxygen: 0, food: 0 },
    materials: { amount: prof.startMaterials, capacity: MATERIALS_CAP },
    colonists: [],
    rovers: [],
    roverFab: ROVER_BUILD_TIME,
    robots: [],
    robotFab: ROBOT_BUILD_TIME,
    deposits: [],
    vents: [],
    aquifers: [],
    depot: { gx: 6, gy: 5 }, // a clear collection point beside the hub (set in seedColony)
    possessed: null,
    moveIntent: { dx: 0, dy: 0 },
    depositRespawn: DEPOSIT_RESPAWN,
    trade: null,
    nextTrade: TRADE_FIRST,
    ufo: null,
    nextUfo: UFO_FIRST * prof.ufoGapMult,
    nextBirth: BIRTH_FIRST,
    acquiredTech: [],
    unlocked: [],
    colonistCounter: 1,
    depositCounter: 1,
    tradeCounter: 1,
    ufoCounter: 1,
    population: 0,
    housing: 0,
    labor: 0,
    laborUsed: 0,
    sol: 1,
    tod: START_TOD,
    solLength: SOL_LENGTH,
    weather: "clear",
    solarMul: 0,
    windLevel: 0,
    hazards: [],
    nextHazard: SCHED_FIRST,
    directorControlled: false,
    timers: { oxygen: null, water: null, food: null },
    grace: prof.grace,
    dead: 0,
    deadlineSol: prof.deadlineSol,
    targetPop: TARGET_POP,
    selfSufficientFor: 0,
    selfSufficiencyGoal: SELF_SUFFICIENCY_GOAL,
    outcome: null,
    outcomeReason: "",
    arrivalsLeft: ARRIVALS_TOTAL,
    nextArrival: ARRIVAL_FIRST,
    nextResupply: RESUPPLY_FIRST,
    resupplyT: 0,
    resupplyBasket: { power: 0, water: 0, oxygen: 0, food: 0 },
    resupplyBanked: { power: 0, water: 0, oxygen: 0, food: 0 },
    paused: false,
    speed: 1,
    t: 0,
    started: false,
    uidCounter: 1,
    brownLatch: false,
    morale: MORALE_START,
    moraleLatch: false,
    difficulty,
    world,
  };
}
