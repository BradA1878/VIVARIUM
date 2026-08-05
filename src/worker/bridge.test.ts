/* ============================================================================
   BridgeCore tests — the shared bridge guts, exercised without a Worker or a
   network (a TestBridge captures sends and feeds synthetic Outbounds). The
   heart of it: the per-client `possessed` re-derivation every co-op role
   depends on (solo passthrough / architect null / guest's own actor), plus the
   subscription fanout and the error channel the resilience layer rides.
   ============================================================================ */
import { afterEach, describe, it, expect, vi } from "vitest";
import type { ColonyEvent, Snapshot } from "@shared/types";
import type { SaveData } from "@/engine";
import { BRIDGE_REQUEST_TIMEOUT_MS, BridgeCore } from "./bridge";
import type { Command, Outbound } from "./protocol";

class TestBridge extends BridgeCore {
  sent: Command[] = [];
  protected send(cmd: Command): void { this.sent.push(cmd); }
  feed(msg: Outbound): void { this.receive(msg); }
  dispose(): void { this.clearCore(); }
}

afterEach(() => { vi.useRealTimers(); });

/** a minimal snapshot: the fields receive() touches */
function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    possessed: null,
    colonists: [],
    rovers: [],
    buildings: [],
    ...over,
  } as unknown as Snapshot;
}

describe("BridgeCore.receive — possessed re-derivation per client", () => {
  it("solo (localActor undefined): the engine's scalar passes through untouched", () => {
    const b = new TestBridge();
    b.feed({ type: "snapshot", snapshot: snap({ possessed: 7, colonists: [{ id: 7 }] as never }) });
    expect(b.latest!.possessed).toBe(7);
    b.feed({ type: "snapshot", snapshot: snap({ possessed: null }) });
    expect(b.latest!.possessed).toBeNull();
  });

  it("architect (localActor null): forced null even while guests pilot", () => {
    const b = new TestBridge();
    b.localActor = null;
    b.feed({ type: "snapshot", snapshot: snap({ possessed: 7, colonists: [{ id: 7 }] as never }) });
    expect(b.latest!.possessed).toBeNull(); // not embodied → can build / overview
  });

  it("guest (localActor id): sees its OWN colonist regardless of the engine scalar", () => {
    const b = new TestBridge();
    b.localActor = 9;
    b.feed({ type: "snapshot", snapshot: snap({ possessed: 7, colonists: [{ id: 7 }, { id: 9 }] as never }) });
    expect(b.latest!.possessed).toBe(9);
  });

  it("guest whose actor is a rover still counts as embodied", () => {
    const b = new TestBridge();
    b.localActor = 12;
    b.feed({ type: "snapshot", snapshot: snap({ possessed: null, rovers: [{ id: 12 }] as never }) });
    expect(b.latest!.possessed).toBe(12);
  });

  it("guest whose actor died drops to spectate (null) until re-claimed", () => {
    const b = new TestBridge();
    b.localActor = 9;
    b.feed({ type: "snapshot", snapshot: snap({ possessed: 7, colonists: [{ id: 7 }] as never }) });
    expect(b.latest!.possessed).toBeNull(); // 9 is gone from the roster
  });
});

describe("BridgeCore — subscriptions and replies", () => {
  it("installs an atomic frame's post-tick snapshot before any event consumer runs", () => {
    const b = new TestBridge();
    const observed: { phase: string; sol: number | undefined }[] = [];
    b.onSnapshot((s) => observed.push({ phase: "snapshot", sol: s.sol }));
    b.onEvent(() => observed.push({ phase: "event", sol: b.latest?.sol }));

    const event = { type: "new_sol", t: 150, sol: 2, tod: 0 } as ColonyEvent;
    b.feed({ type: "frame", snapshot: snap({ t: 150, sol: 2 }), events: [event] });

    expect(observed).toEqual([
      { phase: "snapshot", sol: 2 },
      { phase: "event", sol: 2 },
    ]);
  });

  it("fans events out to every subscriber; catchupReport does NOT ride the event stream", () => {
    const b = new TestBridge();
    const events: ColonyEvent[] = [];
    const reports: { events: ColonyEvent[] }[] = [];
    b.onEvent((e) => events.push(e));
    b.onCatchupReport((_before, evs) => reports.push({ events: evs }));

    const e1 = { type: "dawn", t: 1, sol: 1, tod: 0.2 } as ColonyEvent;
    b.feed({ type: "events", events: [e1, e1] });
    b.feed({ type: "catchupReport", before: snap(), events: [e1] });

    expect(events.length).toBe(2); // the report's event did NOT leak into the stream
    expect(reports.length).toBe(1);
    expect(reports[0].events.length).toBe(1);
  });

  it("onSnapshot replays the cached latest to a late subscriber", () => {
    const b = new TestBridge();
    b.feed({ type: "snapshot", snapshot: snap({ possessed: 3, colonists: [{ id: 3 }] as never }) });
    let seen: Snapshot | null = null;
    b.onSnapshot((s) => { seen = s; });
    expect(seen).not.toBeNull();
  });

  it("save() resolves with the matching reqId's payload", async () => {
    const b = new TestBridge();
    const p = b.save();
    const req = b.sent.find((c) => c.type === "save") as Extract<Command, { type: "save" }>;
    expect(req).toBeTruthy();
    const data = { version: 1, seed: 5 } as unknown as SaveData;
    b.feed({ type: "saved", reqId: req.reqId, data });
    await expect(p).resolves.toBe(data);
  });

  it("load() resolves only after its acknowledged snapshot is installed", async () => {
    const b = new TestBridge();
    const data = { version: 1, seed: 5 } as unknown as SaveData;
    const p = b.load(data);
    const req = b.sent.find((c) => c.type === "load") as Extract<Command, { type: "load" }>;
    const loaded = snap({ t: 42, sol: 3 });
    b.feed({ type: "loaded", reqId: req.reqId, ok: true, snapshot: loaded });
    await expect(p).resolves.toBe(loaded);
    expect(b.latest).toBe(loaded);
  });

  it("switchColony rejects a failed load while preserving the host's returned live snapshot", async () => {
    const b = new TestBridge();
    const data = { version: 1, seed: 5 } as unknown as SaveData;
    const p = b.switchColony(data, 10, true, []);
    const rejected = expect(p).rejects.toThrow("bad target");
    const req = b.sent.find((c) => c.type === "switchColony") as Extract<Command, { type: "switchColony" }>;
    const live = snap({ world: "mars", t: 12 });
    b.feed({ type: "switched", reqId: req.reqId, ok: false, snapshot: live, detail: "bad target" });
    await rejected;
    expect(b.latest).toBe(live);
  });

  it("save/load requests time out instead of hanging forever", async () => {
    vi.useFakeTimers();
    const b = new TestBridge();
    const save = expect(b.save()).rejects.toThrow("colony save timed out");
    const load = expect(b.load({ version: 1 } as unknown as SaveData)).rejects.toThrow("colony load timed out");
    await vi.advanceTimersByTimeAsync(BRIDGE_REQUEST_TIMEOUT_MS + 1);
    await save;
    await load;
  });

  it("dispose rejects every pending request and rejects future requests immediately", async () => {
    const b = new TestBridge();
    const pending = expect(b.save()).rejects.toThrow("simulation bridge disposed");
    b.dispose();
    await pending;
    await expect(b.load({ version: 1 } as unknown as SaveData)).rejects.toThrow("bridge disposed");
  });

  it("ready flips on the worker's ready message", () => {
    const b = new TestBridge();
    expect(b.ready).toBe(false);
    b.feed({ type: "ready" });
    expect(b.ready).toBe(true);
  });
});

describe("BridgeCore — the error channel", () => {
  it("fans a worker/transport error out to onError subscribers", () => {
    const b = new TestBridge();
    const errs: { context: string; detail: string }[] = [];
    b.onError((context, detail) => errs.push({ context, detail }));
    b.feed({ type: "error", context: "step", detail: "boom" });
    expect(errs).toEqual([{ context: "step", detail: "boom" }]);
  });

  it("unsubscribing stops the fanout", () => {
    const b = new TestBridge();
    let n = 0;
    const off = b.onError(() => n++);
    b.feed({ type: "error", context: "load", detail: "bad save" });
    off();
    b.feed({ type: "error", context: "load", detail: "bad save" });
    expect(n).toBe(1);
  });
});
