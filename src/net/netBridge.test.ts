/* ============================================================================
   NetBridge tests — the guest's bridge over a fake room (no Trystero). Covers
   the handshake (hello → ready, claim → localActor), and the failure paths the
   first co-op cut lacked: the HOST disconnecting (the guest must hear about it,
   not freeze forever on the last snapshot) and a join that never finds a host
   (timeout → feedback instead of an infinite "Waiting…").
   ============================================================================ */
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Command } from "@/worker/protocol";
import { NetBridge, JOIN_TIMEOUT_MS } from "./netBridge";
import type { NetRoom } from "./room";

function fakeRoom() {
  const h: Record<string, ((...a: never[]) => void)> = {};
  const sent: { ch: string; data: unknown; target?: string }[] = [];
  const on = (k: string) => (fn: unknown) => { h[k] = fn as (...a: never[]) => void; };
  const send = (ch: string) => (data: unknown, target?: string) => { sent.push({ ch, data, target }); };
  const room: NetRoom = {
    selfId: "GUEST",
    sendCmd: send("cmd"), onCmd: on("cmd"),
    sendSnap: send("snap"), onSnap: on("snap"),
    sendEvt: send("evt"), onEvt: on("evt"),
    sendHello: send("hello"), onHello: on("hello"),
    sendClaim: send("claim") as NetRoom["sendClaim"], onClaim: on("claim"),
    sendRoster: send("roster"), onRoster: on("roster"),
    onPeerJoin: on("join"), onPeerLeave: on("leave"),
    leave: () => { sent.push({ ch: "leave", data: null }); },
  };
  return { room, fire: h, sent };
}

afterEach(() => { vi.useRealTimers(); });

describe("NetBridge — handshake", () => {
  it("greets a joining peer, learns the host from hello, and claims its actor", () => {
    const { room, fire, sent } = fakeRoom();
    const b = new NetBridge(room, "Ada");
    expect(b.ready).toBe(false);
    expect(b.localActor).toBeNull(); // spectator until claimed

    fire.join("H" as never);
    expect(sent.some((s) => s.ch === "hello" && s.target === "H")).toBe(true);

    fire.hello({ role: "host", name: "Brad" } as never, "H" as never);
    expect(b.ready).toBe(true);

    fire.claim({ actorId: 42 } as never, "H" as never);
    expect(b.localActor).toBe(42);

    // commands now go straight to the host
    b.moveIntent(1, 0);
    const cmd = sent.filter((s) => s.ch === "cmd").at(-1)!;
    expect(cmd.target).toBe("H");
    expect((cmd.data as Command).type).toBe("moveIntent");
    b.dispose();
  });
});

describe("NetBridge — the host disconnecting", () => {
  it("emits a net-lost error and drops ready; another guest leaving is ignored", () => {
    const { room, fire } = fakeRoom();
    const b = new NetBridge(room, "Ada");
    fire.hello({ role: "host", name: "Brad" } as never, "H" as never);
    expect(b.ready).toBe(true);

    const errs: string[] = [];
    b.onError((context) => errs.push(context));

    fire.leave("OTHER_GUEST" as never);
    expect(errs).toEqual([]); // a sibling leaving is not a session failure
    expect(b.ready).toBe(true);

    fire.leave("H" as never);
    expect(errs).toEqual(["net-lost"]);
    expect(b.ready).toBe(false);
    b.dispose();
  });
});

describe("NetBridge — join timeout", () => {
  it("emits net-timeout when no host answers in time; a late hello still recovers", () => {
    vi.useFakeTimers();
    const { room, fire } = fakeRoom();
    const b = new NetBridge(room, "Ada");
    const errs: string[] = [];
    b.onError((context) => errs.push(context));

    vi.advanceTimersByTime(JOIN_TIMEOUT_MS + 1);
    expect(errs).toEqual(["net-timeout"]);

    // Nostr was just slow — the host's hello still lands and the session works
    fire.hello({ role: "host", name: "Brad" } as never, "H" as never);
    expect(b.ready).toBe(true);
    b.dispose();
  });

  it("a hello inside the window disarms the timer", () => {
    vi.useFakeTimers();
    const { room, fire } = fakeRoom();
    const b = new NetBridge(room, "Ada");
    const errs: string[] = [];
    b.onError((context) => errs.push(context));

    fire.hello({ role: "host", name: "Brad" } as never, "H" as never);
    vi.advanceTimersByTime(JOIN_TIMEOUT_MS * 2);
    expect(errs).toEqual([]);
    b.dispose();
  });
});
