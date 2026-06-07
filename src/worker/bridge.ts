/* ============================================================================
   SimBridge — the main-thread client for the simulation worker. Framework-
   agnostic (no Vue, no three) so both the renderer and the Vue store can use it.
   Exposes the latest snapshot, a snapshot/event subscription, command methods,
   and synchronous placement prediction (doc §0: observe, don't reach in).
   ============================================================================ */
import type { BuildingState, ColonyEvent, Snapshot } from "@shared/types";
import { DEFS, type SaveData } from "@/engine";
import { buildingAtPredict, canPlacePredict, occupancy } from "@/engine/predict";
import { planRoute } from "@/engine/route";
import type { Command, Outbound } from "./protocol";

type SnapshotFn = (s: Snapshot) => void;
type EventFn = (e: ColonyEvent) => void;

export class SimBridge {
  private worker: Worker;
  private snapshotSubs = new Set<SnapshotFn>();
  private eventSubs = new Set<EventFn>();
  private saveResolvers = new Map<number, (d: SaveData) => void>();
  private reqId = 1;
  private occ: Set<string> | null = null;

  /** the most recent snapshot, or null until the first arrives */
  latest: Snapshot | null = null;
  ready = false;

  constructor() {
    // Vite resolves this to a bundled ES-module worker.
    this.worker = new Worker(new URL("./sim.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (e: MessageEvent<Outbound>) => this.receive(e.data);
  }

  private receive(msg: Outbound): void {
    switch (msg.type) {
      case "ready":
        this.ready = true;
        break;
      case "snapshot":
        this.latest = msg.snapshot;
        this.occ = null; // invalidate placement cache
        for (const fn of this.snapshotSubs) fn(msg.snapshot);
        break;
      case "events":
        for (const e of msg.events) for (const fn of this.eventSubs) fn(e);
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

  // ---- commands -------------------------------------------------------------
  private send(cmd: Command): void { this.worker.postMessage(cmd); }
  place(defId: string, gx: number, gy: number, rot = 0): void { this.send({ type: "place", defId, gx, gy, rot }); }
  remove(gx: number, gy: number): void { this.send({ type: "remove", gx, gy }); }
  rotate(gx: number, gy: number): void { this.send({ type: "rotate", gx, gy }); }
  route(fromUid: number, toUid: number): void { this.send({ type: "route", fromUid, toUid }); }
  setPaused(value: boolean): void { this.send({ type: "setPaused", value }); }
  setSpeed(value: number): void { this.send({ type: "setSpeed", value }); }
  forceStorm(): void { this.send({ type: "forceStorm" }); }
  reset(): void { this.send({ type: "reset" }); }
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

  dispose(): void {
    this.worker.terminate();
    this.snapshotSubs.clear();
    this.eventSubs.clear();
    this.saveResolvers.clear();
  }
}
