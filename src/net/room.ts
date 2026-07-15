/* ============================================================================
   NetRoom — a thin, typed wrapper over a Trystero P2P room (co-op multiplayer).

   Trystero handles WebRTC signalling serverlessly (the default strategy is Nostr),
   so a "select group of friends" connect by sharing a room code — no game server.
   This module is the ONLY place that touches Trystero; the host relay and the guest
   bridge speak in these typed channels. Logical topology is a STAR: guests send
   `cmd` only to the host; the host broadcasts `snap`/`evt` to everyone.

   Like the rest of src/net/, this is MAIN-THREAD ONLY — it never reaches into the
   engine; it just ferries the same typed Commands/Snapshots the worker wall already
   speaks (doc §0). The hard wall is unchanged; the network is just another peer.
   ============================================================================ */
import { joinRoom, selfId } from "trystero";
import type { TurnServerConfig } from "trystero";
import type { Command } from "@/worker/protocol";
import type { ColonyEvent, Snapshot } from "@shared/types";

/** namespaces the app reserves for VIVARIUM co-op (Trystero scopes peers by this) */
const APP_ID = "vivarium-coop-v1";

export type Role = "host" | "guest";

/** who's who — exchanged on connect so a guest learns the host's peer id + name */
export interface HelloMsg { role: Role; name: string }
/** host → guest: the colonist this player drives (null = spectating, none free yet) */
export interface ClaimMsg { actorId: number | null }
/** host → everyone: the live player list, for the lobby/roster HUD */
export interface RosterMsg {
  hostId: string;
  players: { peerId: string; name: string; actorId: number | null }[];
}

/** this peer's stable per-session id (Trystero) */
export const SELF_ID: string = selfId;

/** the typed channels over one Trystero room. `target` omitted = broadcast to all
 *  peers; a peer id = a directed send (the star topology relies on directed sends). */
export interface NetRoom {
  readonly selfId: string;
  sendCmd(cmd: Command, target?: string): void;
  onCmd(fn: (cmd: Command, peerId: string) => void): void;
  sendSnap(snap: Snapshot, target?: string): void;
  onSnap(fn: (snap: Snapshot, peerId: string) => void): void;
  sendEvt(evt: ColonyEvent, target?: string): void;
  onEvt(fn: (evt: ColonyEvent, peerId: string) => void): void;
  sendHello(hello: HelloMsg, target?: string): void;
  onHello(fn: (hello: HelloMsg, peerId: string) => void): void;
  sendClaim(claim: ClaimMsg, target: string): void;
  onClaim(fn: (claim: ClaimMsg, peerId: string) => void): void;
  sendRoster(roster: RosterMsg, target?: string): void;
  onRoster(fn: (roster: RosterMsg, peerId: string) => void): void;
  onPeerJoin(fn: (peerId: string) => void): void;
  onPeerLeave(fn: (peerId: string) => void): void;
  leave(): void;
}

/** join (or create) a Trystero room by code and return its typed channels. Both the
 *  host and each guest call this; the room itself is symmetric — role is decided by
 *  the app (who clicked Host) and announced over the `hello` channel. */
export function joinNetRoom(roomCode: string, turn?: TurnServerConfig[]): NetRoom {
  // Trystero's default (Nostr) signalling + public STUN connects most peers; pass
  // `turn` (a relay) only for the symmetric-NAT pairs that STUN can't punch through
  // — the one spot where "no server" can leak (a cheap TURN service covers it).
  const room = joinRoom({ appId: APP_ID, turnConfig: turn }, roomCode);

  // Trystero's makeAction is typed against its own DataPayload (JsonValue | Blob |
  // ArrayBuffer …). Our Commands/Snapshots are JSON-shaped but their precise TS types
  // aren't structurally assignable to JsonValue's index signature, so we cast at this
  // single boundary and keep the public surface fully typed.
  //
  // DELIBERATE TRUST MODEL: inbound peer data is cast, not runtime-validated —
  // co-op is a friends-only room joined by a shared code, and the host relay
  // only ever acts on a guest's moveIntent/interact anyway (hostRelay.ts drops
  // the rest). If rooms ever become public/hostile, this is the boundary that
  // needs schema validation, not the engine (which only sees typed Commands).
  const cmd = room.makeAction("cmd");
  const snap = room.makeAction("snap");
  const evt = room.makeAction("evt");
  const hello = room.makeAction("hello");
  const claim = room.makeAction("claim");
  const roster = room.makeAction("roster");

  type Send = (data: unknown, opts?: { target?: string }) => Promise<void>;
  const fire = (send: unknown, data: unknown, target?: string): void => {
    void (send as Send)(data, target ? { target } : undefined);
  };

  return {
    selfId: SELF_ID,
    sendCmd: (c, target) => fire(cmd.send, c, target),
    onCmd: (fn) => { cmd.onMessage = (d, ctx) => fn(d as unknown as Command, ctx.peerId); },
    sendSnap: (s, target) => fire(snap.send, s, target),
    onSnap: (fn) => { snap.onMessage = (d, ctx) => fn(d as unknown as Snapshot, ctx.peerId); },
    sendEvt: (e, target) => fire(evt.send, e, target),
    onEvt: (fn) => { evt.onMessage = (d, ctx) => fn(d as unknown as ColonyEvent, ctx.peerId); },
    sendHello: (h, target) => fire(hello.send, h, target),
    onHello: (fn) => { hello.onMessage = (d, ctx) => fn(d as unknown as HelloMsg, ctx.peerId); },
    sendClaim: (c, target) => fire(claim.send, c, target),
    onClaim: (fn) => { claim.onMessage = (d, ctx) => fn(d as unknown as ClaimMsg, ctx.peerId); },
    sendRoster: (r, target) => fire(roster.send, r, target),
    onRoster: (fn) => { roster.onMessage = (d, ctx) => fn(d as unknown as RosterMsg, ctx.peerId); },
    onPeerJoin: (fn) => { room.onPeerJoin = fn; },
    onPeerLeave: (fn) => { room.onPeerLeave = fn; },
    leave: () => { void room.leave(); },
  };
}
