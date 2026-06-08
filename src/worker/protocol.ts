/* ============================================================================
   Worker protocol — the typed message contract across the hard wall (doc §0).
   Main thread sends Commands; the worker (which owns the engine) sends Outbound
   messages: throttled snapshots, the event stream, and save responses.
   ============================================================================ */
import type { ColonyEvent, HazardKind, Snapshot } from "@shared/types";
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
  | { type: "setPaused"; value: boolean }
  | { type: "setSpeed"; value: number }
  | { type: "forceStorm" }
  | { type: "reset" }
  | { type: "load"; data: SaveData }
  | { type: "save"; reqId: number }
  | { type: "start" };

// ---- worker → main thread ----------------------------------------------------
export type Outbound =
  | { type: "ready" }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "events"; events: ColonyEvent[] }
  | { type: "saved"; reqId: number; data: SaveData };

/** how often the worker pushes a fresh snapshot to the HUD (~12 fps) */
export const SNAPSHOT_INTERVAL = 0.08;
/** worker loop cadence (ms) — fixed interval so the sim advances when the tab
 *  is backgrounded (rAF throttles to zero when hidden) — prototype app.jsx */
export const LOOP_MS = 1000 / 30;
/** clamp a single dt against tab-switch / throttle jumps */
export const MAX_DT = 0.1;
