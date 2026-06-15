/* ============================================================================
   The colony store — the single reactive contract every HUD component reads.
   It wraps SimBridge (the worker) and the renderer's tool controls. The HUD only
   ever observes the snapshot/event stream and issues commands (doc §0); it never
   touches the tick.
   ============================================================================ */
import { ref, shallowRef, watch, type Ref, type ShallowRef } from "vue";
import { RESOURCES } from "@shared/types";
import type { ColonyEvent, Difficulty, LegacyManifest, Resource, ShipmentManifest, Snapshot, World } from "@shared/types";
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
import {
  upsertColony, loadLedger, type ColonyRecord,
  addShipment, maturedShipments, removeShipments, shipmentsInTransit, type Shipment,
} from "@/persistence/colonies";
import { nextSeedFrom, slotId, WORLD_META, catchupSteps } from "../founding";
import type { SaveData } from "@/engine";
import type { HazardKind } from "@shared/types";
import { clockOf, fmt } from "../format";
import { useSettings } from "./settings";
import { audio, initAudio } from "../audio";
import {
  emptyHistory, loadHistory, recordEvent, recordSnapshot, resetHistory, saveHistory,
  type RunHistory,
} from "./history";
import { Hints, type Hint, type HintId } from "../hints";
import { leaderId, boardableRover } from "../lead";

// player preferences (persisted) — gate the director, the live narrator, render
// quality, the audio gains, and the next run's difficulty. The deep watch below
// applies them to the live subsystems the moment they change.
const { settings, updateSettings } = useSettings();

export interface TerminalLine {
  id: number;
  text: string;
  sol: number;
  clock: string;
  speaker: string;
  register: Register;
  /** the spoken candidate's severity (0 = idle/boot) — drives the ticker's crit flash */
  sev: number;
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
/** whether the pull-up council log (LogOverlay.vue) is open */
export const logOpen = ref(false);
function toggleLog(): void {
  logOpen.value = !logOpen.value;
}

/** whether the fresh-game difficulty start screen is showing. A fresh boot raises
 *  it (the worker's start gate holds the tick until Begin); a resumed save leaves
 *  it down and ticks immediately. Set in initColony's load-vs-fresh resolution;
 *  lowered by the start() action when the player commits a difficulty. */
export const startScreen = ref(false);

/** the switch curtain (parallel-colonies): raised while goTo loads + catches up + rebuilds
 *  a colony, lowered once it's live — masks the rebuild hitch as a calm "descent". */
export const curtain = ref(false);
let curtainTimer: ReturnType<typeof setTimeout> | null = null;

/** the "while you were away" digest (parallel-colonies): what a switched-to colony's
 *  off-screen catch-up actually did — the before/after delta + a tally of the notable
 *  events — surfaced as a small panel on arrival, dismissed by the player. Null when
 *  there's nothing to report (no real absence, or the colony died off-screen so the
 *  EndScreen covers it instead). */
export interface AwayDigest {
  /** the world's display label (e.g. "Ceres") */
  label: string;
  /** sols that elapsed during the catch-up (after.sol − before.sol) */
  sols: number;
  /** net population change (after − before); negative = net lost, positive = net gained */
  popDelta: number;
  /** net building-count change (after − before) */
  buildingDelta: number;
  /** hazards that started off-screen (hazard_start count) */
  hazards: number;
  /** colonists lost to casualties off-screen (casualty count) */
  casualties: number;
  /** colonists born off-screen (birth count) */
  births: number;
  /** buildings destroyed off-screen (building_destroyed count) */
  destroyed: number;
  /** per-resource pool swing (after − before), only the pools that moved a unit+ */
  resourceSwing: Partial<Record<Resource, number>>;
  /** the build-currency swing (after − before) */
  materialsDelta: number;
}
export const awayDigest = ref<AwayDigest | null>(null);
/** dismiss the away digest (the panel's close button) */
export function dismissAwayDigest(): void { awayDigest.value = null; }
// the in-flight catch-up report, awaiting the post-catch-up snapshot to diff against.
// The host posts {catchupReport} then {snapshot} as two messages; the report lands
// first (before `snapshot.value` updates), so the digest is built on the NEXT snapshot.
let pendingCatchup: { before: Snapshot; events: ColonyEvent[] } | null = null;

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
// the boot greeting's pending pieces, so dispose can cancel an un-spoken line
let bootTimer: ReturnType<typeof setTimeout> | null = null;
let offBootSnap: (() => void) | null = null;
let autosaveTimer: ReturnType<typeof setInterval> | null = null;
let stopSettingsWatch: (() => void) | null = null;
let msgId = 1;
// the persistence slot the live run reads/writes. Default reuses today's single
// key (Mars behavior unchanged); founding/revisit point this at a world's slot.
const ACTIVE_SLOT_KEY = "vivarium:activeslot:v1";
function readActiveSlot(): string {
  try { return localStorage.getItem(ACTIVE_SLOT_KEY) || "default"; } catch { return "default"; }
}
// the persistence slot the live run reads/writes — PERSISTED so a reload resumes
// the world you were last on (default reuses today's single key). Founding/revisit
// repoint it; load-on-boot reads it.
let activeSlot = readActiveSlot();
/** reactive mirror of activeSlot for the Colonies map (highlight the live colony) */
const activeSlotRef = ref(activeSlot);
/** point persistence at a world's slot (founding / revisit / switch), and remember it. */
export function setActiveSlot(slot: string): void {
  activeSlot = slot;
  activeSlotRef.value = slot;
  try { localStorage.setItem(ACTIVE_SLOT_KEY, slot); } catch { /* private mode */ }
}
// the leaving run's identity, captured at launch() so foundNext() can derive the
// next world's seed and carry the difficulty across the Expansion EndScreen.
let pendingLaunch: { seed: number; difficulty: Difficulty; world: World; legacy: LegacyManifest } | null = null;
// true from launch() until the next run begins — a SYNCHRONOUS gate on autosave so
// no save can interleave between launchPtp and the expansion snapshot landing and
// clobber the cleared archive (the snapshot.outcome check alone has a 1-tick window).
let launching = false;

const HINT_TOAST_MS = 14_000;
/** quiet beat between toasts — the next hint must not appear the frame the last one left */
const HINT_GAP_MS = 1_500;
/** the boot greeting's beat — how long after init the first words land */
const BOOT_LINE_MS = 900;

/** put a hint on screen (with the soft interface blip) and arm its auto-dismiss */
function showHint(h: Hint | null): void {
  if (!h) return;
  hintToast.value = h;
  audio.uiTick();
  if (hintTimer) clearTimeout(hintTimer);
  hintTimer = setTimeout(dismissHint, HINT_TOAST_MS);
}

/** surface a closed resupply window's banked totals as a toast — reusing the
 *  HintToast surface (the id is the Vue :key only, never the one-shot seen-set,
 *  so this recurring event card stays independent of the teaching hints). The
 *  event carries post-clamp amounts; any pool sitting at capacity when it lands
 *  is where the basket vented, which we note softly. */
function showResupplyToast(e: ColonyEvent): void {
  const amounts = e.amounts;
  if (!amounts) return;
  // never stomp a one-shot teaching hint the player is mid-read (those don't replay).
  // This recurring resupply card yields if any non-resupply hint holds the slot — the
  // window already announced itself via the inbound banner.
  if (hintToast.value && (hintToast.value.id as string) !== "resupply_done") return;
  const order: Resource[] = ["water", "food", "oxygen", "power"]; // water-first, the tier's subject
  const parts = order
    .filter((k) => (amounts[k] ?? 0) >= 0.5) // sub-unit dribbles aren't worth a line
    .map((k) => `+${fmt(amounts[k])} ${k}`);
  // vented overflow: a pool already at capacity when the drop landed couldn't fit
  const pools = snapshot.value?.pools;
  const full = pools
    ? (["water", "food", "oxygen", "power"] as Resource[]).filter(
        (k) => pools[k].capacity > 0 && pools[k].amount >= pools[k].capacity - 0.5,
      )
    : [];
  const body = parts.length
    ? `Resupply landed: ${parts.join(", ")}.${full.length ? ` ${full.map((k) => `${k} tank full`).join(", ")} — overflow vented.` : ""}`
    : `Resupply window closed.${full.length ? ` Every pool was full — the drop vented.` : " Nothing banked."}`;
  showHint({ id: "resupply_done" as HintId, title: "RESUPPLY LANDED", body });
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
  sev = 0,
): void {
  const s = snapshot.value;
  const atSol = sol ?? (s ? s.sol : 1);
  const atTod = tod ?? (s ? s.tod : 0);
  messages.value = [
    ...messages.value,
    { id: msgId++, text, sol: atSol, clock: clockOf(atTod), speaker, register, sev },
  ].slice(-120);
}

/** wipe a finished/abandoned run's agent-layer + telemetry state back to a clean
 *  start, short of touching the worker (the caller reseeds the colony). Shared by
 *  the in-game reset() and the start() action so "play again" lands as fresh as a
 *  cold boot. The planet keeps its cross-run MEMORY (playerModel); only this run's
 *  scratch is cleared, and the opening bias is re-aimed for the next run. */
function tearDownRun(): void {
  council?.reset();
  sentinel?.reset();
  director?.reset();
  directorBias = openingBias(playerModel);
  lastCritRes = null;
  lastHazard = null;
  lastRealEventT = 0;
  lastDirectedStrike = null;
  attributionCounter = 0;
  launching = false; // the new run is beginning — let autosave resume
  awayDigest.value = null; pendingCatchup = null; // a fresh run has no "while you were away" to show
  clearLocal(activeSlot); // discard the saved colony; autosave will persist the fresh one
  history = resetHistory(); // a new run starts its telemetry from zero
  dismissHint();
  hints = new Hints(); // fresh scratch; the persisted seen-set still holds
  messages.value = [];
  clearTool();
}

/** fire the council's greeting after a beat, in the given difficulty's register.
 *  Holds the shared bootTimer so dispose() can cancel an un-spoken line. */
function greetAfter(ms: number, difficulty: Difficulty): void {
  if (bootTimer) clearTimeout(bootTimer);
  bootTimer = setTimeout(() => {
    bootTimer = null;
    if (!council) return;
    const u = council.bootLine(difficulty);
    pushLine(u.line, undefined, undefined, u.speaker, u.register, u.severity);
  }, ms);
}

/** keep the active colony's ledger row live — sols/population/savedAt refreshed from a
 *  save, preserving foundedAt/legacy — so the Colonies map shows current numbers and the
 *  catch-up has an accurate "last saved" stamp (parallel-colonies). */
function refreshLedgerRow(save: SaveData): void {
  const st = save.state;
  const existing = loadLedger().colonies.find((c) => c.slotKey === activeSlot);
  upsertColony({
    ...existing,
    worldId: st.world, slotKey: activeSlot, seed: save.seed, difficulty: st.difficulty,
    label: WORLD_META[st.world].label, outcome: st.outcome, sols: st.sol, population: st.population,
    foundedAt: existing?.foundedAt ?? Date.now(), savedAt: Date.now(),
  });
}

/** enter a colony as the live one: reset agent scratch (NOT the slot it loads), then
 *  load + deterministically CATCH UP (by the elapsed-since-savedAt step count) + resume,
 *  via the switchColony command. Shared by revisit (StartScreen) and switchTo (in-game). */
function goTo(slotKey: string, target: SaveData): void {
  if (!bridge) return;
  curtain.value = true; // drop the curtain to mask the catch-up + world rebuild
  if (curtainTimer) clearTimeout(curtainTimer);
  curtainTimer = setTimeout(() => { curtain.value = false; }, 850); // lift once the new colony has rendered
  setActiveSlot(slotKey);
  council?.reset(); sentinel?.reset(); director?.reset();
  lastCritRes = null; lastHazard = null; lastDirectedStrike = null; attributionCounter = 0;
  awayDigest.value = null; pendingCatchup = null; // supersede any unread digest from a prior switch
  dismissHint();
  messages.value = [];
  const rec = loadLedger().colonies.find((c) => c.slotKey === slotKey);
  const savedAt = rec?.savedAt ?? rec?.foundedAt ?? Date.now();
  const steps = catchupSteps(Date.now() - savedAt);
  // credit any inter-planet shipments that have ARRIVED at this world, then drop them
  // from the queue — synchronously, before the async switch (exactly-once, ordered by id).
  const matured = maturedShipments(slotKey, Date.now());
  if (matured.length) removeShipments(matured.map((s) => s.id));
  bridge.switchColony(target, steps, settings.value.directorEnabled, matured.map((s) => s.manifest)); // credit + catch-up + resume
  lastRealEventT = target.state.t;
  history = resetHistory();
  startScreen.value = false;
  greetAfter(BOOT_LINE_MS, target.state.difficulty);
}

/** build the "while you were away" digest from the catch-up's before/after snapshots
 *  + the off-screen events (parallel-colonies). Pure — diffs the two snapshots for the
 *  state deltas and tallies the event stream for the notable counts. Returns null when
 *  there was no real absence (no sol elapsed and no casualty/loss) OR the colony died
 *  off-screen (the EndScreen already surfaces a dead world — don't double up). */
function buildAwayDigest(before: Snapshot, after: Snapshot, events: ColonyEvent[]): AwayDigest | null {
  // a colony that died off-screen is handled by the EndScreen, not the digest
  if (after.outcome != null) return null;
  const sols = after.sol - before.sol;
  let hazards = 0, casualties = 0, births = 0, destroyed = 0;
  for (const e of events) {
    if (e.type === "hazard_start") hazards++;
    else if (e.type === "casualty") casualties++;
    else if (e.type === "birth") births++;
    else if (e.type === "building_destroyed") destroyed++;
  }
  // only surface a digest for a REAL absence: at least a sol passed, or something was lost
  const realAbsence = sols >= 1 || casualties > 0 || destroyed > 0 ||
    after.population < before.population || after.buildings.length < before.buildings.length;
  if (!realAbsence) return null;
  const resourceSwing: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) {
    const d = after.pools[r].amount - before.pools[r].amount;
    if (Math.abs(d) >= 1) resourceSwing[r] = d;
  }
  return {
    label: WORLD_META[after.world]?.label ?? after.world,
    sols,
    popDelta: after.population - before.population,
    buildingDelta: after.buildings.length - before.buildings.length,
    hazards, casualties, births, destroyed,
    resourceSwing,
    materialsDelta: after.materials.amount - before.materials.amount,
  };
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
    if (u) pushLine(u.line, e.sol, e.tod, u.speaker, u.register, u.severity);
    return;
  }
  const cand = council.shouldSpeak(e, snapshot.value, e.t);
  if (!cand) return;
  void narrateLive(e, snapshot.value, cand.persona).then((live) => {
    council!.commit(cand, e, e.t);
    pushLine(live ?? cand.line, e.sol, e.tod, cand.speaker, cand.register, cand.severity);
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

  // the "while you were away" digest (parallel-colonies): a switchColony's catch-up
  // posts {catchupReport} then {snapshot}. Stash the report here; the post-catch-up
  // snapshot lands next, and the onSnapshot handler below builds the digest off it.
  // The events ride this stream ONLY — they never reach the council/narrator path.
  b.onCatchupReport((before, events) => { pendingCatchup = { before, events }; });

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
    // the post-catch-up snapshot of a switch: diff it against the stashed pre-catch-up
    // snapshot into the "while you were away" digest (parallel-colonies). Built here so
    // `s` is genuinely the after-catch-up state (the report arrived one message earlier).
    if (pendingCatchup) {
      awayDigest.value = buildAwayDigest(pendingCatchup.before, s, pendingCatchup.events);
      pendingCatchup = null;
    }
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
    if (idle) pushLine(idle.line, s.sol, s.tod, idle.speaker, idle.register, idle.severity);
    // snapshot-derived teaching toasts (stranded pressure building, first possession)
    if (!s.outcome && hints) showHint(hints.onSnapshot(s));
  });

  // track the failure signature + record it across runs (the learning)
  b.onEvent((e) => {
    recordEvent(history, e); // the run report's tallies count from here
    if (!snapshot.value?.outcome && hints) showHint(hints.onEvent(e)); // event-driven teaching toasts
    // a resupply window closing surfaces what actually banked (the toast reads
    // the event's amounts; the inbound RESUPPLY alert in Alerts.vue is unchanged)
    if (e.type === "resupply_done" && !snapshot.value?.outcome) showResupplyToast(e);
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
    } else if (e.type === "expansion") {
      // a launch isn't a win or a loss for the Director's death model — it's a
      // continuation. Just persist the run report so the Expansion screen shows it.
      saveHistory(history);
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
  // already came up on a fresh seed; a save just replaces it. Don't resume into
  // an already-finished run, nor a save from a LARGER grid than today's (we can't
  // safely shrink — buildings could fall outside the new bounds). A save from a
  // SMALLER grid is fine: Colony.load re-centers it into the current grid.
  const bootT0 = Date.now();
  void loadBest(activeSlot).then((save) => {
    const usable = save && !save.state.outcome && save.state.N <= GRID_N;
    if (usable) {
      b.load(save);
      // the save carries its own directorControlled flag — re-assert this
      // browser's setting over it (the settings watch only fires on *changes*)
      b.setDirector(settings.value.directorEnabled);
      lastRealEventT = save.state.t; // resume counts its quiet from the save point
      history = loadHistory(); // a resumed run keeps its curves
      return save.state.difficulty; // greet in the SAVE's register, not the fresh seed's
    }
    if (save) { clearLocal(activeSlot); history = resetHistory(); void b.save().then((s) => persist(activeSlot, s)); } // incompatible/finished — start fresh, overwrite everywhere
    return undefined; // fresh seed — the snapshot carries the run's difficulty
  }).then((resumedDiff) => {
    // A fresh game waits on the start screen: the worker's tick is gated until the
    // player picks a difficulty and presses Begin, and the greeting moves into the
    // start() action so it's pitched to the CHOSEN register. A resumed save skips
    // the screen, is already ticking, and greets here in its own saved register.
    if (resumedDiff === undefined) { startScreen.value = true; return; }
    // first words for a resume — pitched to the save's difficulty. The greeting
    // fires only once BOTH the load path above has settled AND a snapshot exists:
    // a networked (Mongo) loadBest can resolve after any fixed timer, and greeting
    // early put the resume in the fresh seed's register. The load settles in
    // milliseconds, so the remaining wait is the full ~900ms beat.
    const greet = (): void => {
      if (bootTimer) clearTimeout(bootTimer);
      bootTimer = setTimeout(() => {
        bootTimer = null;
        if (!council) return;
        const u = council.bootLine(resumedDiff ?? snapshot.value?.difficulty);
        pushLine(u.line, undefined, undefined, u.speaker, u.register, u.severity);
      }, Math.max(0, BOOT_LINE_MS - (Date.now() - bootT0)));
    };
    if (snapshot.value) greet();
    else {
      let fired = false; // onSnapshot replays the latest synchronously — one-shot guard
      offBootSnap = b.onSnapshot(() => {
        if (fired) return;
        fired = true;
        offBootSnap?.();
        offBootSnap = null;
        greet();
      });
    }
  });

  // autosave on an interval — Mongo when reachable, localStorage always. Held
  // while the start screen is up: the colony is gated at t0 on the default
  // profile, and persisting it would let a reload-during-selection silently
  // resume there (skipping the picker). The first save lands once start() begins.
  autosaveTimer = setInterval(() => {
    // Held while the start screen is up, and while an EXPANSION is pending: launch()
    // has already archived the leaving world LIVE (outcome cleared) to its slot, and
    // an autosave of the paused expansion-outcome state would clobber that archive.
    // (victory/defeat still autosave so their boot-discard keeps working.)
    if (startScreen.value || launching || snapshot.value?.outcome === "expansion") return;
    void b.save().then((s) => { persist(activeSlot, s); refreshLedgerRow(s); }); // keep the Colonies map + savedAt current
    saveHistory(history); // the run telemetry rides the same tick
  }, AUTOSAVE_MS);
}

/** tear down the store's timers + watchers (called from App on unmount) */
export function disposeColony(): void {
  if (autosaveTimer) { clearInterval(autosaveTimer); autosaveTimer = null; }
  if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
  if (hintGapTimer) { clearTimeout(hintGapTimer); hintGapTimer = null; }
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null; }
  if (offBootSnap) { offBootSnap(); offBootSnap = null; }
  if (stopSettingsWatch) { stopSettingsWatch(); stopSettingsWatch = null; }
  sentinel?.dispose();
  audio.dispose();
}

// ---- tool selection (mirrors prototype app.jsx) ------------------------------
function pick(defId: string): void {
  if (snapshot.value?.possessed != null) return; // piloting locks construction
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
  if (snapshot.value?.possessed != null) return; // piloting locks construction
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
  /** F — the commander chain: unpossessed → possess the LEADER (lowest living
   *  colonist id, ui/lead.ts); piloting the leader beside a functional rover →
   *  board it; otherwise (driving, or no rover in reach) → release. */
  possessToggle(): void {
    const s = snapshot.value;
    if (!bridge || !s) return;
    if (s.possessed == null) {
      const lead = leaderId(s);
      if (lead == null) return; // no one left to command
      bridge.setPaused(false); // piloting runs the clock
      bridge.possess(lead);
      return;
    }
    if (s.possessed === leaderId(s)) {
      const rover = boardableRover(s);
      if (rover) { bridge.possess(rover.id); return; } // step from the suit into the rover
    }
    bridge.possess(null);
  },
  /** the player's standing WASD direction for the possessed colonist */
  moveIntent(dx: number, dy: number): void { bridge?.moveIntent(dx, dy); },
  /** P — pick up from a deposit / drop at the depot */
  interact(): void { bridge?.interact(); },
  /** accept/decline a landed alien trade offer */
  respondTrade(accept: boolean): void { bridge?.respondTrade(accept); },
  /** the fresh-game start screen committed a difficulty: lift the worker's start
   *  gate on the chosen profile, drop the screen, and greet in that register
   *  (a resumed save greets on load instead — see initColony). Also clears any
   *  prior-run agent state so "play again" (EndScreen → replay) lands clean. */
  start(difficulty: Difficulty): void {
    if (!bridge) return;
    setActiveSlot("default"); // a fresh game lives in the origin slot, not the last world's
    bridge.start(difficulty); // host applies reset(difficulty) and begins ticking
    updateSettings({ nextDifficulty: difficulty }); // the picked difficulty becomes the standing default
    tearDownRun(); // wipe council/sentinel/director/history (no-op on a clean fresh boot)
    bridge.setDirector(settings.value.directorEnabled); // start()'s reset reseeds with the scheduler on
    startScreen.value = false;
    // first words — pitched to the CHOSEN register. The screen has been up, so the
    // colony is already painted; greet on the same gentle beat as a fresh boot.
    greetAfter(BOOT_LINE_MS, difficulty);
  },
  reset(): void {
    setActiveSlot("default"); // an in-game restart returns to the origin slot
    bridge?.reset(settings.value.nextDifficulty); // the chosen difficulty starts here
    tearDownRun();
    bridge?.setDirector(settings.value.directorEnabled); // reset() reseeds with the scheduler on
    // re-greet after the colony reseeds — in the new run's difficulty register
    greetAfter(600, settings.value.nextDifficulty);
  },
  /** EndScreen "play again" — return to the difficulty start screen to re-pick,
   *  rather than restarting immediately. The worker keeps its (finished, frozen)
   *  colony until Begin calls start(), which reseeds it on the chosen profile. */
  replay(): void {
    messages.value = []; // clear the finished run's log so the screen is quiet behind the curtain
    startScreen.value = true;
  },
  /** PTP launch — archive the leaving world LIVE (revisitable) to its slot, log it
   *  in the Colonies ledger, then end the run as "expansion" (the Expansion
   *  EndScreen offers the next world). Captures the leaving identity for foundNext. */
  async launch(): Promise<void> {
    if (!bridge) return;
    const s = snapshot.value;
    if (!s || s.outcome) return;
    launching = true; // gate autosave across the whole launch → handoff window
    const save = await bridge.save();
    const archive = { ...save, state: { ...save.state, outcome: null, outcomeReason: "" } };
    // log the ledger row FIRST (synchronous), so a tab-close during the remote save
    // round-trip can't orphan the world (local archive + ledger land in one tick).
    upsertColony({
      worldId: save.state.world, slotKey: activeSlot, seed: save.seed,
      difficulty: save.state.difficulty, label: WORLD_META[save.state.world].label,
      outcome: "expansion", sols: s.sol, population: s.population,
      foundedAt: Date.now(), savedAt: Date.now(),
    });
    void persist(activeSlot, archive); // archive the LIVE copy (outcome cleared) so revisit resumes it
    // the legacy that travels: the two lowest-id living colonists (commander +
    // next-senior) by literal id, and one alien tech if any was acquired.
    const livingIds = (save.state.colonists ?? []).map((c) => c.id).sort((a, b) => a - b);
    const legacy: LegacyManifest = { veterans: livingIds.slice(0, 2), tech: (save.state.acquiredTech ?? [])[0] };
    pendingLaunch = { seed: save.seed, difficulty: save.state.difficulty, world: save.state.world, legacy };
    bridge.launchPtp(); // engine: outcome=expansion, pause, emit → Expansion EndScreen
  },
  /** the Expansion EndScreen picked the next world: derive its seed from this run's,
   *  point persistence at its new slot, and found the run there (carrying difficulty).
   *  Mirrors start() but for a planet-hop. */
  foundNext(world: World): void {
    if (!bridge || !pendingLaunch) return;
    const difficulty = pendingLaunch.difficulty;
    const legacy = pendingLaunch.legacy;
    // derive the next world's seed; if a settled colony already occupies that slot
    // (you revisited and relaunched the same route — the parent seed is stable), keep
    // advancing so we never silently overwrite an existing world.
    const taken = new Set(loadLedger().colonies.map((c) => c.slotKey));
    let seed = nextSeedFrom(pendingLaunch.seed);
    while (taken.has(slotId(world, seed))) seed = nextSeedFrom(seed);
    const slot = slotId(world, seed);
    setActiveSlot(slot);
    bridge.start(difficulty, seed, world, legacy); // found the new run on its own slot, carrying the legacy
    tearDownRun(); // wipe agent/run scratch (clears the fresh slot — empty)
    bridge.setDirector(settings.value.directorEnabled);
    // log + persist the freshly founded world so it's revisitable from t0
    upsertColony({
      worldId: world, slotKey: slot, seed, difficulty,
      label: WORLD_META[world].label, outcome: null, sols: 1, population: 0,
      foundedAt: Date.now(), savedAt: Date.now(),
      legacy,
    });
    void bridge.save().then((sv) => persist(slot, sv));
    pendingLaunch = null;
    startScreen.value = false;
    greetAfter(BOOT_LINE_MS, difficulty);
  },
  /** revisit a settled world from the StartScreen's Colonies list: load its slot
   *  and resume the colony live (Colony.load does the work). Mirrors load-on-boot,
   *  NOT a fresh start — it must never clear the slot it just loaded. */
  /** revisit a settled world from the StartScreen — load + catch up + resume live. */
  async revisit(slotKey: string): Promise<void> {
    if (!bridge) return;
    const save = await loadBest(slotKey);
    if (!save) return; // the slot was abandoned/cleared — ignore the click
    goTo(slotKey, save);
  },
  /** switch the live colony to another settled world (the in-game Colonies map): save the
   *  LEAVING colony first (no loss) + refresh its ledger row, then load + catch up + resume
   *  the target. */
  async switchTo(slotKey: string): Promise<void> {
    if (!bridge || slotKey === activeSlot) return; // already here
    const leaving = await bridge.save();
    await persist(activeSlot, leaving);
    refreshLedgerRow(leaving);
    const save = await loadBest(slotKey);
    if (!save) return; // target slot gone
    goTo(slotKey, save);
  },
  /** send an inter-planet shipment from the LIVE colony to another settled world: debit
   *  the sender in its tick, then queue it on the ledger for the destination to credit
   *  on arrival (after transitSols of transit). */
  dispatchShipment(toSlot: string, manifest: ShipmentManifest, transitSols = 1): void {
    if (!bridge || toSlot === activeSlot) return;
    bridge.dispatchShipment(manifest); // debit the live colony (deterministic, in-tick)
    addShipment({ fromSlot: activeSlot, toSlot, manifest, dispatchedAt: Date.now(), transitSols });
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
  if (s.outcome === "expansion") {
    return clause
      ? `The pod cleared the gravity well ${clause}. This colony stands; the work goes on elsewhere.`
      : "The pod cleared the gravity well. This colony stands on its own; the work goes on elsewhere.";
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

/** the cross-run Colonies ledger, newest first — for the Expansion EndScreen and
 *  the StartScreen's revisit list (PTP). Read fresh each call; it's tiny JSON. */
function colonies(): ColonyRecord[] {
  return [...loadLedger().colonies].sort((a, b) => b.foundedAt - a.foundedAt);
}

/** in-flight inter-planet shipments — for the Colonies map's transit display */
function shipments(): Shipment[] {
  return shipmentsInTransit();
}

export function useColony() {
  return {
    snapshot, messages, tool, demolish, hover, selected, hintToast, logOpen, startScreen,
    pick, toggleDemolish, clearTool, rotate, removeSelected, dismissHint, toggleLog,
    runHistory, runEpitaph, directorDossier, colonies, shipments, activeSlot: activeSlotRef, controls,
  };
}
