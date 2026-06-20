/* ============================================================================
   SimBridge — the main-thread client for the simulation worker. Framework-
   agnostic (no Vue, no three) so both the renderer and the Vue store can use it.
   Exposes the latest snapshot, a snapshot/event subscription, command methods,
   and synchronous placement prediction (doc §0: observe, don't reach in).

   The transport-agnostic guts live in `BridgeCore`; `SimBridge` supplies the Web
   Worker transport. A guest's `NetBridge` (src/net/netBridge.ts) extends the SAME
   core over a Trystero data channel — the renderer/store can't tell them apart, so
   the worker wall doubles as the network seam (multiplayer co-op).
   ============================================================================ */
import type { BuildingState, ColonyEvent, Difficulty, HazardKind, LegacyManifest, ShipmentManifest, Snapshot, World } from "@shared/types";
import { DEFS, FUNC_THRESHOLD, type SaveData } from "@/engine";
import { buildingAtPredict, canPlacePredict, canMovePredict, occupancy } from "@/engine/predict";
import { planRoute } from "@/engine/route";
import type { Command, Outbound } from "./protocol";

type SnapshotFn = (s: Snapshot) => void;
type EventFn = (e: ColonyEvent) => void;
/** the "while you were away" digest input: the pre-catch-up snapshot + the off-screen
 *  events a switchColony's catch-up produced (parallel-colonies) */
type CatchupReportFn = (before: Snapshot, events: ColonyEvent[]) => void;

/** the bridge surface the renderer + store depend on, minus the transport. A
 *  worker (`SimBridge`) and a Trystero peer (`NetBridge`) both implement it by
 *  supplying `send` and pumping `receive` — everything else (subscriptions, the
 *  latest-snapshot cache, the synchronous predictors) is shared and identical. */
export abstract class BridgeCore {
  protected snapshotSubs = new Set<SnapshotFn>();
  protected eventSubs = new Set<EventFn>();
  protected catchupSubs = new Set<CatchupReportFn>();
  protected saveResolvers = new Map<number, (d: SaveData) => void>();
  protected reqId = 1;
  protected occ: Set<string> | null = null;

  /** the most recent snapshot, or null until the first arrives */
  latest: Snapshot | null = null;
  ready = false;

  /** which actor THIS client controls, used to re-derive the snapshot's scalar
   *  `possessed` per-client so the follow-cam / build-lock / audio all see "my one
   *  actor" (the solo shape) even when the engine pilots several at once:
   *    • undefined → solo: leave the engine's value (pilots[0]) untouched,
   *    • null      → architect/spectator: force null (not embodied → can build / overview),
   *    • number    → that colonist (a guest's astronaut), if still alive.
   *  The per-actor `view.possessed` booleans are left intact, so rings still mark
   *  every piloted actor. */
  localActor: number | null | undefined = undefined;

  /** push a Command across the transport (postMessage for the worker, a data
   *  channel for a network peer) */
  protected abstract send(cmd: Command): void;

  /** feed an inbound worker/peer message into the subscriptions + caches */
  protected receive(msg: Outbound): void {
    switch (msg.type) {
      case "ready":
        this.ready = true;
        break;
      case "snapshot":
        if (this.localActor !== undefined) {
          const me = this.localActor;
          const alive = me != null
            && (msg.snapshot.colonists.some((c) => c.id === me) || msg.snapshot.rovers.some((r) => r.id === me));
          msg.snapshot.possessed = alive ? me : null;
        }
        this.latest = msg.snapshot;
        this.occ = null; // invalidate placement cache
        for (const fn of this.snapshotSubs) fn(msg.snapshot);
        break;
      case "events":
        for (const e of msg.events) for (const fn of this.eventSubs) fn(e);
        break;
      case "catchupReport":
        // the away digest only — deliberately NOT fanned out through eventSubs (that
        // would replay the off-screen run through the narrator).
        for (const fn of this.catchupSubs) fn(msg.before, msg.events);
        break;
      case "saved": {
        const r = this.saveResolvers.get(msg.reqId);
        if (r) { r(msg.data); this.saveResolvers.delete(msg.reqId); }
        break;
      }
    }
  }

  // ---- subscriptions --------------------------------------------------------
  onSnapshot(fn: SnapshotFn): () => void {
    this.snapshotSubs.add(fn);
    if (this.latest) fn(this.latest);
    return () => this.snapshotSubs.delete(fn);
  }
  onEvent(fn: EventFn): () => void {
    this.eventSubs.add(fn);
    return () => this.eventSubs.delete(fn);
  }
  /** subscribe to a switchColony's catch-up report (the "while you were away" digest
   *  input) — the pre-catch-up snapshot + the off-screen events (parallel-colonies) */
  onCatchupReport(fn: CatchupReportFn): () => void {
    this.catchupSubs.add(fn);
    return () => this.catchupSubs.delete(fn);
  }

  // ---- commands -------------------------------------------------------------
  place(defId: string, gx: number, gy: number, rot = 0): void { this.send({ type: "place", defId, gx, gy, rot }); }
  remove(gx: number, gy: number): void { this.send({ type: "remove", gx, gy }); }
  rotate(gx: number, gy: number): void { this.send({ type: "rotate", gx, gy }); }
  rotateUid(uid: number): void { const b = this.buildingByUid(uid); if (b) this.send({ type: "rotate", gx: b.gx, gy: b.gy }); }
  move(uid: number, gx: number, gy: number): void { this.send({ type: "move", uid, gx, gy }); }
  route(fromUid: number, toUid: number): void { this.send({ type: "route", fromUid, toUid }); }
  triggerHazard(kind: HazardKind, intensity?: number): void { this.send({ type: "triggerHazard", kind, intensity }); }
  setDirector(value: boolean): void { this.send({ type: "setDirector", value }); }
  /** possess a colonist by id. `id:null` releases all; `on` is the multiplayer
   *  claim flag (true adds to the piloted set, false releases just this actor);
   *  omit it for the solo replace-to-one semantics. */
  possess(id: number | null, on?: boolean): void { this.send({ type: "possess", id, on }); }
  /** a piloted actor's standing WASD direction; `id` names which pilot (omit for the sole one) */
  moveIntent(dx: number, dy: number, id?: number): void { this.send({ type: "moveIntent", dx, dy, id }); }
  /** the player pressed P — pick up from a deposit / drop at the depot (for pilot `id`) */
  interact(id?: number): void { this.send({ type: "interact", id }); }
  /** accept/decline the landed alien trade offer */
  respondTrade(accept: boolean): void { this.send({ type: "respondTrade", accept }); }
  /** DEV-only affordance (the window.__viv / Playwright surface) — production
   *  possession goes through the commander chain (store possessToggle →
   *  ui/lead.ts leaderId), not this. Possess the actor nearest a grid point:
   *  scans colonists AND rovers (skipping rovers too dented to drive);
   *  strictly the nearest wins, ties to the lower id. Returns the possessed
   *  id. */
  possessNearest(gx: number, gy: number): number | null {
    if (!this.latest) return null;
    const cands: { id: number; x: number; y: number }[] = [
      ...this.latest.colonists,
      ...this.latest.rovers.filter((r) => r.integrity >= FUNC_THRESHOLD),
    ];
    let best: { id: number; x: number; y: number } | null = null;
    let bestD = Infinity;
    for (const c of cands) {
      const d = (c.x - gx) ** 2 + (c.y - gy) ** 2;
      if (d < bestD || (d === bestD && best !== null && c.id < best.id)) { bestD = d; best = c; }
    }
    if (!best) return null;
    this.possess(best.id);
    return best.id;
  }
  setPaused(value: boolean): void { this.send({ type: "setPaused", value }); }
  setSpeed(value: number): void { this.send({ type: "setSpeed", value }); }
  forceStorm(): void { this.send({ type: "forceStorm" }); }
  /** restart the run; a PTP founding can hand in a new seed + world (omitting any
   *  keeps the current colony's value) */
  reset(difficulty?: Difficulty, seed?: number, world?: World, legacy?: LegacyManifest): void { this.send({ type: "reset", difficulty, seed, world, legacy }); }
  /** begin a fresh game / found the next world (lifts the worker's start gate);
   *  carries the chosen difficulty + (for a PTP founding) seed + world + carried legacy */
  start(difficulty?: Difficulty, seed?: number, world?: World, legacy?: LegacyManifest): void { this.send({ type: "start", difficulty, seed, world, legacy }); }
  /** launch the PTP — end the run as "expansion" (the store founds the next world) */
  launchPtp(): void { this.send({ type: "launchPtp" }); }
  /** switch the live colony to another settled world: load it, fast-forward `steps`
   *  catch-up sub-steps, resume live (parallel-colonies) */
  switchColony(save: SaveData, steps: number, director: boolean, credits: ShipmentManifest[]): void { this.send({ type: "switchColony", save, steps, director, credits }); }
  /** debit an inter-planet shipment from the live colony (the store queues it for the destination) */
  dispatchShipment(manifest: ShipmentManifest): void { this.send({ type: "dispatchShipment", manifest }); }
  load(data: SaveData): void { this.send({ type: "load", data }); }

  save(): Promise<SaveData> {
    const reqId = this.reqId++;
    return new Promise<SaveData>((resolve) => {
      this.saveResolvers.set(reqId, resolve);
      this.send({ type: "save", reqId });
    });
  }

  // ---- synchronous prediction for the renderer (UI feedback only) -----------
  canPlace(defId: string, gx: number, gy: number): boolean {
    if (!this.latest) return false;
    if (!this.occ) this.occ = occupancy(this.latest);
    return canPlacePredict(this.latest, defId, gx, gy, this.occ);
  }
  canMove(uid: number, gx: number, gy: number): boolean {
    return this.latest ? canMovePredict(this.latest, uid, gx, gy) : false;
  }
  buildingAt(gx: number, gy: number): BuildingState | null {
    return this.latest ? buildingAtPredict(this.latest, gx, gy) : null;
  }

  buildingByUid(uid: number): BuildingState | null {
    return this.latest?.buildings.find((b) => b.uid === uid) ?? null;
  }

  /** predict the corridor path the worker would lay, for the ghost preview */
  previewRoute(fromUid: number, toUid: number): [number, number][] | null {
    if (!this.latest) return null;
    const blocked = (x: number, y: number): boolean => {
      const b = buildingAtPredict(this.latest!, x, y);
      return !!b && !DEFS[b.defId]?.conduit; // empty/corridor passable; else blocked
    };
    return planRoute(this.latest.buildings, this.latest.N, blocked, fromUid, toUid);
  }

  /** drop all subscriptions + pending saves (subclasses tear down their transport) */
  protected clearCore(): void {
    this.snapshotSubs.clear();
    this.eventSubs.clear();
    this.catchupSubs.clear();
    this.saveResolvers.clear();
  }

  abstract dispose(): void;
}

/** the default (solo / host) bridge — the authoritative engine runs in a Web Worker
 *  on this thread, reached over postMessage. */
export class SimBridge extends BridgeCore {
  private worker: Worker;

  constructor() {
    super();
    // Vite resolves this to a bundled ES-module worker.
    this.worker = new Worker(new URL("./sim.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (e: MessageEvent<Outbound>) => this.receive(e.data);
  }

  protected send(cmd: Command): void { this.worker.postMessage(cmd); }

  dispose(): void {
    this.worker.terminate();
    this.clearCore();
  }
}
