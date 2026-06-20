/* ============================================================================
   HostRelay tests — the co-op authority logic, exercised with a fake room + fake
   bridge (no Trystero, no network). Covers: colonist assignment on join, input
   attribution to the right actor, rejecting build commands from astronauts, and
   handing a colonist back to spectate when it dies.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { Snapshot } from "@shared/types";
import type { Command } from "@/worker/protocol";
import { HostRelay, type RelayBridge } from "./hostRelay";
import type { NetRoom } from "./room";

function fakeRoom() {
  const h: Record<string, ((...a: never[]) => void)> = {};
  const sent: { ch: string; data: unknown; target?: string }[] = [];
  const on = (k: string) => (fn: unknown) => { h[k] = fn as (...a: never[]) => void; };
  const send = (ch: string) => (data: unknown, target?: string) => { sent.push({ ch, data, target }); };
  const room: NetRoom = {
    selfId: "HOST",
    sendCmd: send("cmd"), onCmd: on("cmd"),
    sendSnap: send("snap"), onSnap: on("snap"),
    sendEvt: send("evt"), onEvt: on("evt"),
    sendHello: send("hello"), onHello: on("hello"),
    sendClaim: send("claim") as NetRoom["sendClaim"], onClaim: on("claim"),
    sendRoster: send("roster"), onRoster: on("roster"),
    onPeerJoin: on("join"), onPeerLeave: on("leave"),
    leave: () => {},
  };
  return { room, fire: h, sent };
}

function fakeBridge(colonistIds: number[]) {
  let snapSub: (s: Snapshot) => void = () => {};
  const calls: { m: string; args: unknown[] }[] = [];
  const snapOf = (ids: number[]): Snapshot =>
    ({ colonists: ids.map((id) => ({ id })), rovers: [] } as unknown as Snapshot);
  const bridge: RelayBridge = {
    latest: snapOf(colonistIds),
    onSnapshot: (fn) => { snapSub = fn; return () => {}; },
    onEvent: () => () => {},
    possess: (id, on) => calls.push({ m: "possess", args: [id, on] }),
    moveIntent: (dx, dy, id) => calls.push({ m: "moveIntent", args: [dx, dy, id] }),
    interact: (id) => calls.push({ m: "interact", args: [id] }),
  };
  // mirror BridgeCore: latest updates BEFORE subscribers fire
  return { bridge, calls, pushSnap: (ids: number[]) => { const s = snapOf(ids); bridge.latest = s; snapSub(s); } };
}

const cmd = (c: Command): Command => c;

describe("HostRelay — co-op authority", () => {
  it("assigns the lowest free colonist on join, possesses it, and claims it for the peer", () => {
    const { room, fire, sent } = fakeRoom();
    const { bridge, calls } = fakeBridge([3, 1, 2]);
    new HostRelay(room, bridge, "Brad");

    fire.join("A" as never);

    expect(calls).toContainEqual({ m: "possess", args: [1, true] });
    expect(sent).toContainEqual({ ch: "claim", data: { actorId: 1 }, target: "A" });
  });

  it("attributes a guest's moveIntent + interact to its OWN claimed colonist", () => {
    const { room, fire } = fakeRoom();
    const { bridge, calls } = fakeBridge([1, 2]);
    new HostRelay(room, bridge, "Brad");
    fire.join("A" as never);

    fire.cmd(cmd({ type: "moveIntent", dx: 1, dy: 0 }) as never, "A" as never);
    fire.cmd(cmd({ type: "interact" }) as never, "A" as never);

    expect(calls).toContainEqual({ m: "moveIntent", args: [1, 0, 1] });
    expect(calls).toContainEqual({ m: "interact", args: [1] });
  });

  it("drops build/sim commands from a guest (astronauts don't build)", () => {
    const { room, fire } = fakeRoom();
    const { bridge, calls } = fakeBridge([1]);
    new HostRelay(room, bridge, "Brad");
    fire.join("A" as never);
    const before = calls.length;

    fire.cmd(cmd({ type: "place", defId: "hab", gx: 1, gy: 1 }) as never, "A" as never);
    fire.cmd(cmd({ type: "setPaused", value: true }) as never, "A" as never);
    fire.cmd(cmd({ type: "remove", gx: 1, gy: 1 }) as never, "A" as never);

    expect(calls.length).toBe(before); // nothing forwarded
  });

  it("gives two guests different colonists", () => {
    const { room, fire } = fakeRoom();
    const { bridge, calls } = fakeBridge([1, 2, 3]);
    new HostRelay(room, bridge, "Brad");

    fire.join("A" as never);
    fire.join("B" as never);

    const possessed = calls.filter((c) => c.m === "possess").map((c) => c.args[0]);
    expect(possessed).toEqual([1, 2]);
  });

  it("releases a colonist back to the AI when its guest leaves", () => {
    const { room, fire } = fakeRoom();
    const { bridge, calls } = fakeBridge([1, 2]);
    new HostRelay(room, bridge, "Brad");
    fire.join("A" as never);

    fire.leave("A" as never);

    expect(calls).toContainEqual({ m: "possess", args: [1, false] });
  });

  it("re-claims a free colonist for a spectator when one arrives (spectate → re-embody)", () => {
    const { room, fire, sent } = fakeRoom();
    const { bridge, calls, pushSnap } = fakeBridge([1]); // only one colonist to start
    new HostRelay(room, bridge, "Brad");
    fire.join("A" as never); // A claims colonist 1
    fire.join("B" as never); // B spectates — none free

    pushSnap([1, 2]); // a new colonist (resupply/birth) arrives

    expect(calls).toContainEqual({ m: "possess", args: [2, true] });
    expect(sent).toContainEqual({ ch: "claim", data: { actorId: 2 }, target: "B" });
  });

  it("hands a colonist back to spectate (claim null) when it dies off the roster", () => {
    const { room, fire, sent } = fakeRoom();
    const { bridge, pushSnap } = fakeBridge([1, 2]);
    new HostRelay(room, bridge, "Brad");
    fire.join("A" as never); // A drives colonist 1

    pushSnap([2]); // colonist 1 died/abducted — gone from the snapshot

    expect(sent).toContainEqual({ ch: "claim", data: { actorId: null }, target: "A" });
  });
});
