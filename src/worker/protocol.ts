/* ============================================================================
   Worker protocol — the typed message contract across the hard wall (doc §0).
   Main thread sends Commands; the worker (which owns the engine) sends Outbound
   messages: atomic state/event frames and correlated operation responses.
   ============================================================================ */
import { RESOURCES, type ColonyEvent, type Difficulty, type HazardKind, type LegacyManifest, type ShipmentManifest, type Snapshot, type World } from "@shared/types";
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
  // possess/release an actor. `on` is the multiplayer claim flag (true adds to the
  // piloted set, false removes just that actor); omit it for solo replace-to-one,
  // `id:null` releases everyone. `id` on moveIntent/interact names which piloted
  // actor the input is for (the host stamps it per player); omit for the sole pilot.
  | { type: "possess"; id: number | null; on?: boolean }
  | { type: "moveIntent"; dx: number; dy: number; id?: number }
  | { type: "interact"; id?: number }
  | { type: "respondTrade"; accept: boolean }
  | { type: "setPaused"; value: boolean }
  | { type: "setSpeed"; value: number }
  | { type: "forceStorm" }
  // reset/start carry the PTP founding inputs: a new seed + world found the next
  // run; omitting any of the three keeps the current colony's value (the engine
  // applies them deterministically — the main thread chooses them, never the tick).
  | { type: "reset"; difficulty?: Difficulty; seed?: number; world?: World; legacy?: LegacyManifest }
  | { type: "load"; reqId: number; data: SaveData }
  | { type: "save"; reqId: number }
  | { type: "start"; difficulty?: Difficulty; seed?: number; world?: World; legacy?: LegacyManifest }
  // launch the PTP: a deliberate player act ending the run as "expansion" (the
  // run-ending that founds the next world). No-op without a functional pod built.
  | { type: "launchPtp" }
  // switch the live colony to another settled world (parallel-colonies): credit any
  // matured inter-planet shipments into the loaded save (seed-state), fast-forward it
  // `steps` catch-up sub-steps (deterministic off-screen advance — count computed
  // main-side), then resume it live. `director` is the player's setting to restore after
  // the catch-up (which always runs the engine scheduler).
  | { type: "switchColony"; reqId: number; save: SaveData; steps: number; director: boolean; credits: ShipmentManifest[] }
  // DEBIT an inter-planet shipment from the live colony (the store queues it for the
  // destination). Deterministic, mirrors respondTrade's pool debit.
  | { type: "dispatchShipment"; reqId: number; manifest: ShipmentManifest };

/** where a surfaced failure came from: a thrown command, the step loop, a save
 *  that wouldn't load, the Worker itself dying, or (guest-side) the co-op
 *  session losing its host / never finding one. */
export type SimErrorContext = "command" | "step" | "load" | "worker" | "net-lost" | "net-timeout";

// ---- worker → main thread ----------------------------------------------------
export type Outbound =
  | { type: "ready" }
  // A tick's post-state and the events it produced travel as one message. BridgeCore
  // installs the snapshot before fanning out any event, so every observer sees the
  // state that actually caused that event (including across the co-op transport).
  | { type: "frame"; snapshot: Snapshot; events: ColonyEvent[] }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "events"; events: ColonyEvent[] }
  | { type: "saved"; reqId: number; data: SaveData }
  | { type: "loaded"; reqId: number; ok: true; snapshot: Snapshot }
  | { type: "loaded"; reqId: number; ok: false; snapshot: Snapshot; detail: string }
  | { type: "switched"; reqId: number; ok: true; snapshot: Snapshot; before: Snapshot; events: ColonyEvent[] }
  | { type: "switched"; reqId: number; ok: false; snapshot: Snapshot; detail: string }
  | { type: "shipmentDispatched"; reqId: number; ok: true; snapshot: Snapshot; manifest: ShipmentManifest }
  | { type: "shipmentDispatched"; reqId: number; ok: false; snapshot: Snapshot; detail: string }
  // a failure the player must SEE instead of a silent freeze: the shell/host
  // catch, post this, and keep serving (doc: the boundary never wedges quietly)
  | { type: "error"; context: SimErrorContext; detail: string }
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

/** Runtime validation at the worker wall. UI types do not make peer messages,
 *  stale persisted rows, or dev-console calls trustworthy. Crew is discrete;
 *  every quantity must be finite and non-negative. */
export function validShipmentManifest(value: unknown): value is ShipmentManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const m = value as ShipmentManifest;
  if (m.materials !== undefined && (!Number.isFinite(m.materials) || m.materials < 0)) return false;
  if (m.crew !== undefined && (!Number.isSafeInteger(m.crew) || m.crew < 0)) return false;
  if (m.resources !== undefined) {
    if (!m.resources || typeof m.resources !== "object" || Array.isArray(m.resources)) return false;
    for (const [resource, amount] of Object.entries(m.resources)) {
      if (!RESOURCES.includes(resource as (typeof RESOURCES)[number])) return false;
      if (!Number.isFinite(amount) || (amount as number) < 0) return false;
    }
  }
  return true;
}

/** Empty/zero manifests are harmless but should never become ledger rows. */
export function shipmentHasCargo(m: ShipmentManifest): boolean {
  return (m.materials ?? 0) > 0
    || (m.crew ?? 0) > 0
    || Object.values(m.resources ?? {}).some((amount) => (amount ?? 0) > 0);
}
