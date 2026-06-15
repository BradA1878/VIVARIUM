/* ============================================================================
   Worker protocol — the typed message contract across the hard wall (doc §0).
   Main thread sends Commands; the worker (which owns the engine) sends Outbound
   messages: throttled snapshots, the event stream, and save responses.
   ============================================================================ */
import type { ColonyEvent, Difficulty, HazardKind, LegacyManifest, Snapshot, World } from "@shared/types";
import type { SaveData } from "@/engine";

// ---- main thread → worker ----------------------------------------------------
export type Command =
  | { type: "place"; defId: string; gx: number; gy: number; rot?: number }
  | { type: "remove"; gx: number; gy: number }
  | { type: "rotate"; gx: number; gy: number }
  | { type: "move"; uid: number; gx: number; gy: number }
  | { type: "route"; fromUid: number; toUid: number }
  | { type: "triggerHazard"; kind: HazardKind; intensity?: number }
  | { type: "setDirector"; value: boolean }
  | { type: "possess"; id: number | null }
  | { type: "moveIntent"; dx: number; dy: number }
  | { type: "interact" }
  | { type: "respondTrade"; accept: boolean }
  | { type: "setPaused"; value: boolean }
  | { type: "setSpeed"; value: number }
  | { type: "forceStorm" }
  // reset/start carry the PTP founding inputs: a new seed + world found the next
  // run; omitting any of the three keeps the current colony's value (the engine
  // applies them deterministically — the main thread chooses them, never the tick).
  | { type: "reset"; difficulty?: Difficulty; seed?: number; world?: World; legacy?: LegacyManifest }
  | { type: "load"; data: SaveData }
  | { type: "save"; reqId: number }
  | { type: "start"; difficulty?: Difficulty; seed?: number; world?: World; legacy?: LegacyManifest }
  // launch the PTP: a deliberate player act ending the run as "expansion" (the
  // run-ending that founds the next world). No-op without a functional pod built.
  | { type: "launchPtp" }
  // switch the live colony to another settled world (parallel-colonies): load its
  // SaveData, fast-forward it `steps` catch-up sub-steps (deterministic off-screen
  // advance — the count is computed main-side), then resume it live. `director` is the
  // player's setting to restore after the catch-up (which always runs the engine scheduler).
  | { type: "switchColony"; save: SaveData; steps: number; director: boolean };

// ---- worker → main thread ----------------------------------------------------
export type Outbound =
  | { type: "ready" }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "events"; events: ColonyEvent[] }
  | { type: "saved"; reqId: number; data: SaveData }
  // the "while you were away" digest (parallel-colonies): a switchColony's catch-up
  // ran real hazards/casualties off-screen — this carries the pre-catch-up snapshot
  // and the accumulated events so the store can diff them into a digest. It goes ONLY
  // here, never through the `events` stream, so the away events don't spam the narrator.
  | { type: "catchupReport"; before: Snapshot; events: ColonyEvent[] };

/** how often the worker pushes a fresh snapshot to the HUD (~12 fps) */
export const SNAPSHOT_INTERVAL = 0.08;
/** worker loop cadence (ms) — fixed interval so the sim advances when the tab
 *  is backgrounded (rAF throttles to zero when hidden) — prototype app.jsx */
export const LOOP_MS = 1000 / 30;
/** clamp a single dt against tab-switch / throttle jumps */
export const MAX_DT = 0.1;
