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

describe("BridgeCore.previewSeal — the placement ghost's corridor plan", () => {
  // a 2×2 hub covering (2..3, 2..3); a habitat aimed at (8,2) is four cells east
  // of it, so the shortest corridor is (7,2) → (4,2)
  const hub = { uid: 1, defId: "hub", gx: 2, gy: 2 };
  const withBuildings = (buildings: object[], materials = 100, vents: object[] = []) =>
    snap({
      N: 16, buildings, materials: { amount: materials, capacity: 400 },
      vents, aquifers: [], depot: { gx: 15, gy: 15 },
    } as never);

  it("is null before any snapshot and for a surface building", () => {
    const b = new TestBridge();
    expect(b.previewSeal("hab", 8, 2)).toBeNull();
    b.feed({ type: "snapshot", snapshot: withBuildings([hub]) });
    expect(b.previewSeal("solar", 8, 2)).toBeNull();
  });

  it("plans the corridor the worker would lay and prices the whole placement", () => {
    const b = new TestBridge();
    b.feed({ type: "snapshot", snapshot: withBuildings([hub]) });
    expect(b.previewSeal("hab", 8, 2)).toEqual({
      kind: "corridor",
      path: [[7, 2], [6, 2], [5, 2], [4, 2]],
      cells: 4,
      cost: 8,
      total: 32, // the habitat's 24 + four corridor cells at 2
      affordable: true,
    });
  });

  it("marks the placement unaffordable when building + corridor exceed the materials", () => {
    const b = new TestBridge();
    b.feed({ type: "snapshot", snapshot: withBuildings([hub], 31) });
    expect(b.previewSeal("hab", 8, 2)).toMatchObject({ kind: "corridor", total: 32, affordable: false });
  });

  it("keeps the corridor off a vent, as the worker does", () => {
    const b = new TestBridge();
    b.feed({ type: "snapshot", snapshot: withBuildings([hub], 100, [{ id: 1, gx: 5, gy: 2 }]) });
    const p = b.previewSeal("hab", 8, 2);
    expect(p?.kind).toBe("corridor");
    if (p?.kind !== "corridor") return;
    expect(p.path.some(([x, y]) => x === 5 && y === 2)).toBe(false);
    expect(p.cells).toBe(5); // down a row past the vent to the hub's lower half: one cell longer
  });

  it("answers from the latest snapshot: a new network replaces the cached plan", () => {
    const b = new TestBridge();
    b.feed({ type: "snapshot", snapshot: withBuildings([hub]) });
    const first = b.previewSeal("hab", 8, 2);
    expect(b.previewSeal("hab", 8, 2)).toBe(first); // same aim, same snapshot: cached
    const corridors = [4, 5, 6, 7].map((gx, i) => ({ uid: 10 + i, defId: "corridor", gx, gy: 2 }));
    b.feed({ type: "snapshot", snapshot: withBuildings([hub, ...corridors]) });
    expect(b.previewSeal("hab", 8, 2)).toEqual({ kind: "touching" });
  });
});
