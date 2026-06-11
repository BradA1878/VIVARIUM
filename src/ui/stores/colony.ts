/* ============================================================================
   The colony store — the single reactive contract every HUD component reads.
   It wraps SimBridge (the worker) and the renderer's tool controls. The HUD only
   ever observes the snapshot/event stream and issues commands (doc §0); it never
   touches the tick.
   ============================================================================ */
import { ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import type { ColonyEvent, Snapshot } from "@shared/types";
import type { SimBridge } from "@/worker/bridge";
import type { ThreeRenderer } from "@/render/renderer";
import type { HoverInfo, SelectInfo } from "@/render/three/placement";
import { Council, type Register } from "@/agent/council";
import { narrateLive, LIVE_ENABLED } from "@/agent/client";
import { Sentinel } from "@/agent/sentinel";
import { Director } from "@/agent/director/director";
import { GRID_N } from "@/engine/tuning";
import {
  loadModel, saveModel, recordOutcome, openingBias,
  type PlayerModel, type Axis,
} from "@/agent/director/memory";
import { loadBest, persist, clearLocal } from "@/persistence";
import type { HazardKind } from "@shared/types";
import { clockOf } from "../format";
import { useSettings } from "./settings";
import { audio, initAudio } from "../audio";
import {
  emptyHistory, loadHistory, recordEvent, recordSnapshot, resetHistory, saveHistory,
  type RunHistory,
} from "./history";
import { Hints, type Hint } from "../hints";

// player preferences (persisted) — gate the director, the live narrator, render
// quality, the audio gains, and the next run's difficulty. The deep watch below
// applies them to the live subsystems the moment they change.
const { settings } = useSettings();

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
/** the contextual teaching toast currently on screen (HintToast.vue renders it) */
const hintToast: Ref<Hint | null> = ref(null);

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
// idle banter's quiet clock — the sim-t of the last REAL routed event
let lastRealEventT = 0;
// Director attribution — the strike the Director just chose, so the matching
// hazard_warn can be annotated on OUR copy of the event (the engine never sees it)
let lastDirectedStrike: { kind: HazardKind; t: number } | null = null;
/** deterministic 1-in-3 attribution pacing (a counter, NOT randomness) */
let attributionCounter = 0;
// this run's telemetry — curves + event tallies for the end-of-run report
let history: RunHistory = emptyHistory();
// the one-shot teaching toasts (seen-set persists across runs)
let hints: Hints | null = null;
let hintTimer: ReturnType<typeof setTimeout> | null = null;
let hintGapTimer: ReturnType<typeof setTimeout> | null = null;
let autosaveTimer: ReturnType<typeof setInterval> | null = null;
let stopSettingsWatch: (() => void) | null = null;
let msgId = 1;

const HINT_TOAST_MS = 14_000;
/** quiet beat between toasts — the next hint must not appear the frame the last one left */
const HINT_GAP_MS = 1_500;

/** put a hint on screen (with the soft interface blip) and arm its auto-dismiss */
function showHint(h: Hint | null): void {
  if (!h) return;
  hintToast.value = h;
  audio.uiTick();
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(dismissHint, HINT_TOAST_MS);
}

/** close the toast (✕, auto-dismiss, or reset) and let the next hint through —
 *  after a short quiet gap. The queue stays occupied until the gap timer fires,
 *  so the gap inherits the active-block's semantics exactly: candidates offered
 *  meanwhile are not burned, and seen is still marked only at show time. The
 *  timer holds ITS queue instance — reset's fresh queue is never released early. */
function dismissHint(): void {
  if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
  hintToast.value = null;
  const q = hints;
  if (hintGapTimer) clearTimeout(hintGapTimer);
  hintGapTimer = setTimeout(() => {
    hintGapTimer = null;
    q?.dismiss();
  }, HINT_GAP_MS);
}

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
  lastRealEventT = e.t; // every real event resets the banter's quiet clock
  // Director attribution: a telegraph matching the strike the Director just
  // chose gets annotated — on a CLONE, only after the player has run twice,
  // and only every third time, so the reveal stays a rare chill.
  if (
    e.type === "hazard_warn" && lastDirectedStrike &&
    e.kind === lastDirectedStrike.kind && e.t - lastDirectedStrike.t <= 3
  ) {
    lastDirectedStrike = null;
    if (playerModel.runs >= 2 && attributionCounter++ % 3 === 0) e = { ...e, directed: true };
  }
  if (!(LIVE_ENABLED && settings.value.narratorLive)) {
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
  hints = new Hints();
  // the planet remembers how this player dies and opens accordingly
  playerModel = loadModel();
  directorBias = openingBias(playerModel);
  // hand hazard control to the Director — the planet becomes a learning
  // antagonist — unless the player switched it off in settings
  b.setDirector(settings.value.directorEnabled);
  // apply the persisted render quality (no-op if it matches the default)
  r.setQuality(settings.value.graphics.quality);

  // procedural audio — one more observer on the bridge (never a participant).
  // initAudio only arms the gesture-unlock listeners; until the player clicks
  // or presses a key every audio call is a cheap no-op.
  initAudio();
  audio.applySettings(settings.value.audio);
  b.onEvent((e) => audio.onEvent(e));
  b.onSnapshot((s) => audio.onSnapshot(s));

  // settings → live subsystems: quality, the director toggle, and the audio
  // gains apply the moment they change.
  let appliedQuality = settings.value.graphics.quality;
  let appliedDirector = settings.value.directorEnabled;
  stopSettingsWatch = watch(settings, (sv) => {
    if (sv.graphics.quality !== appliedQuality) {
      appliedQuality = sv.graphics.quality;
      r.setQuality(appliedQuality);
    }
    if (sv.directorEnabled !== appliedDirector) {
      appliedDirector = sv.directorEnabled;
      b.setDirector(appliedDirector);
    }
    audio.applySettings(sv.audio); // setTargetAtTime — cheap and idempotent
  }, { deep: true });

  r.onSelect((info) => { selected.value = info; });

  b.onSnapshot((s) => {
    snapshot.value = s;
    recordSnapshot(history, s); // the run report's curves sample from here
    sentinel?.push(s, s.t); // the Watcher's eyes sample telemetry (throttled)
    // the Director observes and may throw a hazard, aimed by colony shape, the
    // memory of past deaths, and how settled the Sentinel thinks the player is
    if (settings.value.directorEnabled) {
      const strike = director?.decide(s, Math.random, { bias: directorBias, comfort: sentinel?.comfort() });
      if (strike) {
        b.triggerHazard(strike.kind, strike.intensity);
        lastDirectedStrike = { kind: strike.kind, t: s.t }; // for hazard_warn attribution
        history.directorStrikes++;
      }
    }
    // idle banter — scripted by construction: observeIdle returns a finished
    // line and shares nothing with shouldSpeak/narrateLive, so this path is
    // structurally incapable of reaching the live model.
    const idle = council?.observeIdle(s, s.t, lastRealEventT);
    if (idle) pushLine(idle.line, s.sol, s.tod, idle.speaker, idle.register);
    // snapshot-derived teaching toasts (stranded pressure building, first possession)
    if (!s.outcome && hints) showHint(hints.onSnapshot(s));
  });

  // track the failure signature + record it across runs (the learning)
  b.onEvent((e) => {
    recordEvent(history, e); // the run report's tallies count from here
    if (!snapshot.value?.outcome && hints) showHint(hints.onEvent(e)); // event-driven teaching toasts
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
      saveHistory(history); // the report survives a closed tab
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
  // into an already-finished run, or a save from a DIFFERENT grid size (e.g. an
  // old 11×11 colony after the map grew to 15×15) — that would strand the colony
  // and its people in a sub-region of the new world. A fresh seed beats both.
  void loadBest().then((save) => {
    const usable = save && !save.state.outcome && save.state.N === GRID_N;
    if (usable) {
      b.load(save);
      lastRealEventT = save.state.t; // resume counts its quiet from the save point
      history = loadHistory(); // a resumed run keeps its curves
    } else if (save) { clearLocal(); history = resetHistory(); void b.save().then(persist); } // incompatible/finished — start fresh, overwrite everywhere
  });

  // autosave on an interval — Mongo when reachable, localStorage always
  autosaveTimer = setInterval(() => {
    void b.save().then(persist);
    saveHistory(history); // the run telemetry rides the same tick
  }, AUTOSAVE_MS);

  // first words — pitched to the run's difficulty (a resumed save keeps its own)
  setTimeout(() => {
    if (council) {
      const u = council.bootLine(snapshot.value?.difficulty);
      pushLine(u.line, undefined, undefined, u.speaker, u.register);
    }
  }, 900);
}

/** tear down the store's timers + watchers (called from App on unmount) */
export function disposeColony(): void {
  if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null; }
  if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
  if (hintGapTimer) { clearTimeout(hintGapTimer); hintGapTimer = null; }
  if (stopSettingsWatch) { stopSettingsWatch(); stopSettingsWatch = null; }
  sentinel?.dispose();
  audio.dispose();
}

// ---- tool selection (mirrors prototype app.jsx) ------------------------------
function pick(defId: string): void {
  audio.uiTick();
  if (tool.value === defId && !demolish.value) { clearTool(); return; }
  tool.value = defId;
  demolish.value = false;
  // the Corridor tile is a 2-click auto-route "link" mode, not single placement
  if (defId === "corridor") renderer?.setRoute();
  else renderer?.setTool(defId);
}

/** R — rotate the ghost while placing, else the selected/hovered building */
function rotate(): void { audio.uiTick(); renderer?.rotate(); }

/** Del — remove the currently-selected building */
function removeSelected(): void { renderer?.removeSelected(); }
function toggleDemolish(): void {
  audio.uiTick();
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
  /** F — possess the colonist nearest the colony, or release if already piloting */
  possessToggle(): void {
    const s = snapshot.value;
    if (!bridge || !s) return;
    if (s.possessed != null) { bridge.possess(null); return; }
    bridge.setPaused(false); // piloting runs the clock
    bridge.possessNearest((s.N - 1) / 2, (s.N - 1) / 2);
  },
  /** the player's standing WASD direction for the possessed colonist */
  moveIntent(dx: number, dy: number): void { bridge?.moveIntent(dx, dy); },
  /** P — pick up from a deposit / drop at the depot */
  interact(): void { bridge?.interact(); },
  /** accept/decline a landed alien trade offer */
  respondTrade(accept: boolean): void { bridge?.respondTrade(accept); },
  reset(): void {
    bridge?.reset(settings.value.nextDifficulty); // the chosen difficulty starts here
    council?.reset();
    sentinel?.reset();
    director?.reset();
    bridge?.setDirector(settings.value.directorEnabled); // reset() reseeds with the scheduler on
    // the planet keeps its cross-run memory; re-aim the opening for the new run
    directorBias = openingBias(playerModel);
    lastCritRes = null;
    lastHazard = null;
    lastRealEventT = 0;
    lastDirectedStrike = null;
    attributionCounter = 0;
    clearLocal(); // discard the saved colony; autosave will persist the fresh one
    history = resetHistory(); // a new run starts its telemetry from zero
    dismissHint();
    hints = new Hints(); // fresh scratch; the persisted seen-set still holds
    messages.value = [];
    clearTool();
    // re-greet after the colony reseeds — in the new run's difficulty register
    setTimeout(() => {
      if (council) {
        const u = council.bootLine(settings.value.nextDifficulty);
        pushLine(u.line, undefined, undefined, u.speaker, u.register);
      }
    }, 600);
  },
  save(): Promise<unknown> | undefined { return bridge?.save(); },
};

/** the bridge's event stream, for the narrator to subscribe to (Phase 7) */
export function onColonyEvent(fn: (e: ColonyEvent) => void): () => void {
  return bridge ? bridge.onEvent(fn) : () => {};
}

/** DEV observability — the Director's brain for window.__viv (App.vue wires it):
 *  the live opening bias, the Sentinel's comfort read, and the cross-run model */
export const directorDev = {
  bias: (): Record<HazardKind, number> => directorBias,
  comfort: (): number | undefined => sentinel?.comfort(),
  model: (): PlayerModel => playerModel,
};

// ---- the run report (EndScreen) ------------------------------------------------

/** this run's recorded telemetry — curves, tallies, director strikes */
function runHistory(): RunHistory {
  return history;
}

/** how each hazard reads when it shades a death sentence */
const HAZARD_CLAUSE: Record<HazardKind, string> = {
  dust: "under a sky full of dust",
  meteor: "in the shadow of a meteor strike",
  flare: "with the flare still in the wires",
  coldsnap: "in the deep cold",
  quake: "on ground that would not stay still",
};

/** one line naming the proximate cause of the end — the record's last word */
function runEpitaph(): string {
  const s = snapshot.value;
  if (!s || !s.outcome) return "";
  const clause = lastHazard ? HAZARD_CLAUSE[lastHazard] : null;
  if (s.outcome === "victory") {
    return clause
      ? `The colony learned to breathe on its own — even ${clause}.`
      : "The colony learned to breathe on its own.";
  }
  if (s.outcomeReason === "window") {
    return clause
      ? `Time ran out ${clause}, with the colony still short of standing alone.`
      : "Time ran out with the colony still short of standing alone.";
  }
  const failed = lastCritRes ? `The ${lastCritRes} failed last` : "Everything failed at once";
  return clause ? `${failed}, ${clause}.` : `${failed}.`;
}

/** the planet's cross-run learning, shaped for the end screen's dossier panel */
export interface DirectorDossier {
  runs: number;
  wins: number;
  deaths: number;
  byAxis: Record<Axis, number>;
  byHazard: Record<HazardKind, number>;
  /** per-hazard opening multipliers (1 = neutral) the Director starts with */
  bias: Record<HazardKind, number>;
  avgSols: number;
}

function directorDossier(): DirectorDossier {
  return {
    runs: playerModel.runs,
    wins: playerModel.wins,
    deaths: playerModel.deaths,
    byAxis: { ...playerModel.byAxis },
    byHazard: { ...playerModel.byHazard },
    bias: openingBias(playerModel),
    avgSols: playerModel.runs > 0 ? playerModel.solsSum / playerModel.runs : 0,
  };
}

export function useColony() {
  return {
    snapshot, messages, tool, demolish, hover, selected, hintToast,
    pick, toggleDemolish, clearTool, rotate, removeSelected, dismissHint,
    runHistory, runEpitaph, directorDossier, controls,
  };
}
