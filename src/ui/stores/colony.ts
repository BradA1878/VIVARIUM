/* ============================================================================
   The colony store — the single reactive contract every HUD component reads.
   It wraps SimBridge (the worker) and the renderer's tool controls. The HUD only
   ever observes the snapshot/event stream and issues commands (doc §0); it never
   touches the tick.
   ============================================================================ */
import { ref, shallowRef, type Ref, type ShallowRef } from "vue";
import type { ColonyEvent, Snapshot } from "@shared/types";
import type { SimBridge } from "@/worker/bridge";
import type { ThreeRenderer } from "@/render/renderer";
import type { HoverInfo, SelectInfo } from "@/render/three/placement";
import { Council, type Register } from "@/agent/council";
import { narrateLive, LIVE_ENABLED } from "@/agent/client";
import { Sentinel } from "@/agent/sentinel";
import { Director } from "@/agent/director/director";
import {
  loadModel, saveModel, recordOutcome, openingBias,
  type PlayerModel, type Axis,
} from "@/agent/director/memory";
import { loadBest, persist, clearLocal } from "@/persistence";
import type { HazardKind } from "@shared/types";
import { clockOf } from "../format";

export interface TerminalLine {
  id: number;
  text: string;
  sol: number;
  clock: string;
  speaker: string;
  register: Register;
}

// ---- module-singleton reactive state ----------------------------------------
const snapshot: ShallowRef<Snapshot | null> = shallowRef(null);
const messages: Ref<TerminalLine[]> = ref([]);
const tool: Ref<string | null> = ref(null);
const demolish = ref(false);
const hover: Ref<HoverInfo | null> = ref(null);
const selected: Ref<SelectInfo | null> = ref(null);

let bridge: SimBridge | null = null;
let renderer: ThreeRenderer | null = null;
let council: Council | null = null;
let sentinel: Sentinel | null = null;
let director: Director | null = null;
// cross-run memory — the planet's learning across runs
let playerModel: PlayerModel = { runs: 0, wins: 0, deaths: 0, solsSum: 0, byAxis: { power: 0, oxygen: 0, water: 0, food: 0 }, byHazard: { dust: 0, meteor: 0, flare: 0, coldsnap: 0, quake: 0 } };
let directorBias: Record<HazardKind, number> = { dust: 1, meteor: 1, flare: 1, coldsnap: 1, quake: 1 };
let lastCritRes: Axis | null = null;
let lastHazard: HazardKind | null = null;
let autosaveTimer: ReturnType<typeof setInterval> | null = null;
let msgId = 1;

const AUTOSAVE_MS = 12_000;

/** push a line into the council terminal. Pass the triggering event's sol/tod so
 *  the timestamp reflects when the event happened, not when an async (live) line
 *  resolved, plus who is speaking and in which register. */
export function pushLine(
  text: string,
  sol?: number,
  tod?: number,
  speaker = "VIVARIUM",
  register: Register = "vivarium",
): void {
  const s = snapshot.value;
  const atSol = sol ?? (s ? s.sol : 1);
  const atTod = tod ?? (s ? s.tod : 0);
  messages.value = [
    ...messages.value,
    { id: msgId++, text, sol: atSol, clock: clockOf(atTod), speaker, register },
  ].slice(-40);
}

/** route one event (engine OR agent-originated) through the council. The gate
 *  short-circuits BEFORE any model call (doc §3.1); a live line falls back to the
 *  scripted line on any failure — the game never depends on it. */
function routeEvent(e: ColonyEvent): void {
  if (!council) return;
  if (!LIVE_ENABLED) {
    const u = council.observe(e, snapshot.value, e.t);
    if (u) pushLine(u.line, e.sol, e.tod, u.speaker, u.register);
    return;
  }
  const cand = council.shouldSpeak(e, snapshot.value, e.t);
  if (!cand) return;
  void narrateLive(e, snapshot.value, cand.persona).then((live) => {
    council!.commit(cand, e, e.t);
    pushLine(live ?? cand.line, e.sol, e.tod, cand.speaker, cand.register);
  });
}

/** wire the store to the live bridge + renderer (called once from App) */
export function initColony(b: SimBridge, r: ThreeRenderer): void {
  bridge = b;
  renderer = r;
  council = new Council();
  sentinel = new Sentinel();
  director = new Director();
  // the planet remembers how this player dies and opens accordingly
  playerModel = loadModel();
  directorBias = openingBias(playerModel);
  // hand hazard control to the Director — the planet becomes a learning antagonist
  b.setDirector(true);

  r.onSelect((info) => { selected.value = info; });

  b.onSnapshot((s) => {
    snapshot.value = s;
    sentinel?.push(s, s.t); // the Watcher's eyes sample telemetry (throttled)
    // the Director observes and may throw a hazard, aimed by colony shape, the
    // memory of past deaths, and how settled the Sentinel thinks the player is
    const strike = director?.decide(s, Math.random, { bias: directorBias, comfort: sentinel?.comfort() });
    if (strike) b.triggerHazard(strike.kind, strike.intensity);
  });

  // track the failure signature + record it across runs (the learning)
  b.onEvent((e) => {
    if (e.type === "crit_start" && e.res) lastCritRes = e.res as Axis;
    else if (e.type === "hazard_start" && e.kind) lastHazard = e.kind;
    else if (e.type === "victory" || e.type === "defeat") {
      recordOutcome(playerModel, {
        won: e.type === "victory",
        lethalAxis: e.type === "defeat" ? lastCritRes ?? undefined : undefined,
        recentHazard: lastHazard ?? undefined,
        sols: snapshot.value?.sol ?? 1,
      });
      saveModel(playerModel);
      directorBias = openingBias(playerModel);
    }
  });
  r.onHover((info) => { hover.value = info; });

  // the agent layer observes the event stream — the council speaks (doc §0, §3.3).
  // Engine events AND the Sentinel's anomaly events route through the same path.
  b.onEvent(routeEvent);

  if (import.meta.env.DEV) (window as unknown as { __sentinel: Sentinel }).__sentinel = sentinel;

  // a learned-model anomaly becomes a synthetic agent-layer event for the Watcher
  sentinel.onAnomaly((a) => {
    routeEvent({
      type: "anomaly",
      t: a.snapshot.t, sol: a.snapshot.sol, tod: a.snapshot.tod,
      detail: a.feature, sigma: Math.round(a.sigma * 10) / 10,
    });
  });

  // load-on-boot: resume the saved colony if one exists (doc §5). The worker
  // already came up on a fresh seed; a save just replaces it. But don't resume
  // into an already-finished run — a fresh seed is better than a corpse.
  void loadBest().then((save) => {
    if (save && !save.state.outcome) b.load(save);
    else if (save) { clearLocal(); void b.save().then(persist); } // overwrite the finished save everywhere
  });

  // autosave on an interval — Mongo when reachable, localStorage always
  autosaveTimer = setInterval(() => {
    void b.save().then(persist);
  }, AUTOSAVE_MS);

  // first words
  setTimeout(() => {
    if (council) { const u = council.bootLine(); pushLine(u.line, undefined, undefined, u.speaker, u.register); }
  }, 900);
}

/** tear down the store's timers (called from App on unmount) */
export function disposeColony(): void {
  if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null; }
  sentinel?.dispose();
}

// ---- tool selection (mirrors prototype app.jsx) ------------------------------
function pick(defId: string): void {
  if (tool.value === defId && !demolish.value) { clearTool(); return; }
  tool.value = defId;
  demolish.value = false;
  // the Corridor tile is a 2-click auto-route "link" mode, not single placement
  if (defId === "corridor") renderer?.setRoute();
  else renderer?.setTool(defId);
}

/** R — rotate the ghost while placing, else the selected/hovered building */
function rotate(): void { renderer?.rotate(); }

/** Del — remove the currently-selected building */
function removeSelected(): void { renderer?.removeSelected(); }
function toggleDemolish(): void {
  const v = !demolish.value;
  demolish.value = v;
  tool.value = null;
  if (v) renderer?.setDemolish();
  else renderer?.clearTool();
}
function clearTool(): void {
  tool.value = null;
  demolish.value = false;
  renderer?.clearTool();
}

// ---- controls ----------------------------------------------------------------
const controls = {
  togglePause(): void { if (bridge && snapshot.value) bridge.setPaused(!snapshot.value.paused); },
  setSpeed(n: number): void { bridge?.setPaused(false); bridge?.setSpeed(n); },
  storm(): void { bridge?.forceStorm(); },
  reset(): void {
    bridge?.reset();
    council?.reset();
    sentinel?.reset();
    director?.reset();
    bridge?.setDirector(true); // reset() reseeds the colony with the scheduler on
    // the planet keeps its cross-run memory; re-aim the opening for the new run
    directorBias = openingBias(playerModel);
    lastCritRes = null;
    lastHazard = null;
    clearLocal(); // discard the saved colony; autosave will persist the fresh one
    messages.value = [];
    clearTool();
    // re-greet after the colony reseeds
    setTimeout(() => {
      if (council) { const u = council.bootLine(); pushLine(u.line, undefined, undefined, u.speaker, u.register); }
    }, 600);
  },
  save(): Promise<unknown> | undefined { return bridge?.save(); },
};

/** the bridge's event stream, for the narrator to subscribe to (Phase 7) */
export function onColonyEvent(fn: (e: ColonyEvent) => void): () => void {
  return bridge ? bridge.onEvent(fn) : () => {};
}

export function useColony() {
  return { snapshot, messages, tool, demolish, hover, selected, pick, toggleDemolish, clearTool, rotate, removeSelected, controls };
}
