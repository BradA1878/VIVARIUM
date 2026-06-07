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
import type { HoverInfo } from "@/render/three/placement";
import { Council, type Register } from "@/agent/council";
import { narrateLive, LIVE_ENABLED } from "@/agent/client";
import { Sentinel } from "@/agent/sentinel";
import { loadBest, persist, clearLocal } from "@/persistence";
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

let bridge: SimBridge | null = null;
let renderer: ThreeRenderer | null = null;
let council: Council | null = null;
let sentinel: Sentinel | null = null;
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

  b.onSnapshot((s) => {
    snapshot.value = s;
    sentinel?.push(s, s.t); // the Watcher's eyes sample telemetry (throttled)
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
  // already came up on a fresh seed; a save just replaces it.
  void loadBest().then((save) => {
    if (save) b.load(save);
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
  renderer?.setTool(defId);
}
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
  return { snapshot, messages, tool, demolish, hover, pick, toggleDemolish, clearTool, controls };
}
