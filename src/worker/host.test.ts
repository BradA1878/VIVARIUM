/* ============================================================================
   SimHost tests — the worker-side logic, exercised without a real Web Worker.
   Commands round-trip, snapshots advance, pause/speed honored, save replies.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { SimHost } from "./host";
import type { Outbound } from "./protocol";

function snapsIn(msgs: Outbound[]): Outbound[] {
  return msgs.filter((m) => m.type === "snapshot");
}

describe("SimHost", () => {
  it("emits a snapshot on a command and time advances on step", () => {
    const host = new SimHost(123);
    const onCmd = host.applyCommand({ type: "start" });
    expect(snapsIn(onCmd).length).toBe(1);

    // step past the snapshot interval; sim time must advance
    const before = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.t;
    let out: Outbound[] = [];
    for (let i = 0; i < 10; i++) out = out.concat(host.step(0.05));
    const after = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.t;
    expect(after).toBeGreaterThan(before);
    expect(snapsIn(out).length).toBeGreaterThan(0);
  });

  it("pause freezes sim time; resume restarts it", () => {
    const host = new SimHost(1);
    host.applyCommand({ type: "start" }); // lift the start gate so the clock can run
    host.applyCommand({ type: "setPaused", value: true });
    const t0 = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.t;
    for (let i = 0; i < 20; i++) host.step(0.05);
    const t1 = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.t;
    expect(t1).toBe(t0); // no advance while paused

    host.applyCommand({ type: "setPaused", value: false });
    for (let i = 0; i < 20; i++) host.step(0.05);
    const t2 = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.t;
    expect(t2).toBeGreaterThan(t1);
  });

  it("speed multiplies advance (3× covers more sim time than 1×)", () => {
    const a = new SimHost(5);
    const b = new SimHost(5);
    a.applyCommand({ type: "start" });
    b.applyCommand({ type: "start" });
    b.applyCommand({ type: "setSpeed", value: 3 });
    for (let i = 0; i < 30; i++) { a.step(0.05); b.step(0.05); }
    const ta = (a.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.t;
    const tb = (b.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.t;
    expect(tb).toBeGreaterThan(ta * 2.5);
  });

  it("place/remove round-trip through commands changes the building count", () => {
    const host = new SimHost(1);
    const base = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.buildings.length;
    host.applyCommand({ type: "place", defId: "o2tank", gx: 0, gy: 0 });
    const added = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.buildings.length;
    expect(added).toBe(base + 1);
    host.applyCommand({ type: "remove", gx: 0, gy: 0 });
    const removed = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.buildings.length;
    expect(removed).toBe(base);
  });

  it("reset with a difficulty switches it; plain reset keeps it", () => {
    const host = new SimHost(3);
    const snapOf = (msgs: Outbound[]) =>
      (msgs[0] as Extract<Outbound, { type: "snapshot" }>).snapshot;
    expect(snapOf([host.snapshotMessage()]).difficulty).toBe("normal");

    expect(snapOf(host.applyCommand({ type: "reset", difficulty: "hard" })).difficulty).toBe("hard");
    expect(snapOf(host.applyCommand({ type: "reset" })).difficulty).toBe("hard"); // omitted → unchanged
  });

  it("save returns a SaveData reply that load restores", () => {
    const host = new SimHost(99);
    host.applyCommand({ type: "start" }); // begin, so there's advanced state worth saving
    for (let i = 0; i < 40; i++) host.step(0.05);
    const reply = host.applyCommand({ type: "save", reqId: 7 });
    const saved = reply.find((m) => m.type === "saved") as Extract<Outbound, { type: "saved" }>;
    expect(saved).toBeTruthy();
    expect(saved.reqId).toBe(7);

    const fresh = new SimHost(1);
    fresh.applyCommand({ type: "load", data: saved.data });
    const loaded = (fresh.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot;
    const original = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot;
    expect(loaded.t).toBe(original.t);
    expect(loaded.pools).toEqual(original.pools);
  });

  // ---- the start gate (difficulty start screen) ----
  // A fresh host holds the tick until `start` arrives, so the difficulty start
  // screen can sit over a static colony; snapshots still flow so the UI paints it.

  it("a fresh host does NOT advance until start; snapshots still flow", () => {
    const host = new SimHost(7);
    const t0 = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.t;
    let out: Outbound[] = [];
    for (let i = 0; i < 30; i++) out = out.concat(host.step(0.05));
    const t1 = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.t;
    expect(t1).toBe(t0); // gated — the tick never ran
    expect(snapsIn(out).length).toBeGreaterThan(0); // but snapshots still painted the static colony
  });

  it("start{difficulty} begins ticking and carries that profile", () => {
    const host = new SimHost(7);
    expect((host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.difficulty).toBe("normal");
    host.applyCommand({ type: "start", difficulty: "hard" });
    const begun = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot;
    expect(begun.difficulty).toBe("hard"); // the chosen profile is applied via reset
    const before = begun.t;
    for (let i = 0; i < 20; i++) host.step(0.05);
    const after = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.t;
    expect(after).toBeGreaterThan(before); // and the clock now runs
  });

  it("load resumes ticking with no start (a save is already in progress)", () => {
    const seed = new SimHost(42);
    seed.applyCommand({ type: "start" });
    for (let i = 0; i < 20; i++) seed.step(0.05);
    const data = (seed.applyCommand({ type: "save", reqId: 1 })
      .find((m) => m.type === "saved") as Extract<Outbound, { type: "saved" }>).data;

    const fresh = new SimHost(1);
    fresh.applyCommand({ type: "load", data }); // no `start` — load lifts the gate itself
    const before = (fresh.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.t;
    for (let i = 0; i < 20; i++) fresh.step(0.05);
    const after = (fresh.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot.t;
    expect(after).toBeGreaterThan(before); // a resumed save ticks immediately
  });

  // ---- the world + seed founding channel (PTP) ----

  it("start founds on the given seed + world", () => {
    const host = new SimHost();
    host.applyCommand({ type: "start", difficulty: "hard", seed: 4242, world: "ceres" });
    const begun = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot;
    expect(begun.world).toBe("ceres");
    expect(begun.difficulty).toBe("hard");
    const saved = (host.applyCommand({ type: "save", reqId: 1 })
      .find((m) => m.type === "saved") as Extract<Outbound, { type: "saved" }>).data;
    expect(saved.seed).toBe(4242); // the seed threaded into the founded run
  });

  it("reset threads a new seed + world too", () => {
    const host = new SimHost();
    host.applyCommand({ type: "start" }); // mars/default
    host.applyCommand({ type: "reset", difficulty: "easy", seed: 7, world: "titan" });
    const snap = (host.snapshotMessage() as Extract<Outbound, { type: "snapshot" }>).snapshot;
    expect(snap.world).toBe("titan");
    const saved = (host.applyCommand({ type: "save", reqId: 2 })
      .find((m) => m.type === "saved") as Extract<Outbound, { type: "saved" }>).data;
    expect(saved.seed).toBe(7);
  });
});
