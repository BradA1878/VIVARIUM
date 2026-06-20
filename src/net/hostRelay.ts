/* ============================================================================
   HostRelay — runs on the host (the "architect"), between the guests and the
   authoritative SimBridge/worker. It is the authority boundary for co-op:

     • assigns each joining guest a free colonist (a "claim") and possesses it,
     • attributes each guest's input to THAT colonist (stamping the actor id) and
       forwards only the astronaut commands — build commands from guests are dropped
       (astronauts don't build; only the architect does),
     • broadcasts the worker's snapshots + events to every guest,
     • releases a colonist when its guest leaves or the colonist dies (→ spectate).

   Main-thread only, like the agent layer — it never reaches into the tick; it just
   relays the same typed Commands/Snapshots across the wall (doc §0). Determinism is
   untouched: N guest input streams merge here into the one authoritative command
   stream the engine already consumes.
   ============================================================================ */
import type { Command } from "@/worker/protocol";
import type { ColonyEvent, Snapshot } from "@shared/types";
import type { NetRoom } from "./room";

/** the slice of the bridge the relay needs (SimBridge/BridgeCore satisfies it) */
export interface RelayBridge {
  latest: Snapshot | null;
  onSnapshot(fn: (s: Snapshot) => void): () => void;
  onEvent(fn: (e: ColonyEvent) => void): () => void;
  possess(id: number | null, on?: boolean): void;
  moveIntent(dx: number, dy: number, id?: number): void;
  interact(id?: number): void;
}

interface PlayerSlot { name: string; actorId: number | null }

export class HostRelay {
  /** peerId → the player's name + the colonist they currently drive (null = spectating) */
  private players = new Map<string, PlayerSlot>();
  private offSnap: () => void;
  private offEvt: () => void;

  constructor(
    private room: NetRoom,
    private bridge: RelayBridge,
    private hostName: string,
  ) {
    room.onPeerJoin((peerId) => this.admit(peerId));
    room.onPeerLeave((peerId) => this.release(peerId));
    room.onCmd((cmd, peerId) => this.handleCmd(cmd, peerId));
    room.onHello((hello, peerId) => {
      const slot = this.players.get(peerId);
      if (slot) slot.name = hello.name;
      this.broadcastRoster();
    });
    this.offSnap = bridge.onSnapshot((s) => this.onSnapshot(s));
    this.offEvt = bridge.onEvent((e) => room.sendEvt(e));
  }

  /** a peer connected: greet, assign a free colonist, possess it, tell them */
  private admit(peerId: string): void {
    this.room.sendHello({ role: "host", name: this.hostName }, peerId);
    const actorId = this.freeColonist();
    if (actorId != null) this.bridge.possess(actorId, true);
    this.players.set(peerId, { name: peerId.slice(0, 6), actorId });
    this.room.sendClaim({ actorId }, peerId);
    this.broadcastRoster();
  }

  /** a peer left: release its colonist back to the AI */
  private release(peerId: string): void {
    const slot = this.players.get(peerId);
    if (slot?.actorId != null) this.bridge.possess(slot.actorId, false);
    this.players.delete(peerId);
    this.broadcastRoster();
  }

  /** a guest's input — only its OWN astronaut, and never construction */
  private handleCmd(cmd: Command, peerId: string): void {
    const actorId = this.players.get(peerId)?.actorId;
    if (actorId == null) return; // a spectator (or unknown peer) drives nothing
    switch (cmd.type) {
      case "moveIntent": this.bridge.moveIntent(cmd.dx, cmd.dy, actorId); break;
      case "interact": this.bridge.interact(actorId); break;
      // build/sim/lifecycle commands from a guest are deliberately ignored — the
      // architect (host) is the only builder, and only the host drives the clock.
      default: break;
    }
  }

  /** broadcast every snapshot, and hand a colonist back to spectate if it died */
  private onSnapshot(s: Snapshot): void {
    this.room.sendSnap(s);
    const alive = new Set<number>([...s.colonists.map((c) => c.id), ...s.rovers.map((r) => r.id)]);
    let changed = false;
    for (const [peerId, slot] of this.players) {
      if (slot.actorId != null && !alive.has(slot.actorId)) {
        slot.actorId = null; // their colonist is gone → spectate until one arrives
        this.room.sendClaim({ actorId: null }, peerId);
        changed = true;
      }
    }
    if (changed) this.broadcastRoster();
  }

  /** the lowest-id colonist not already claimed by another player */
  private freeColonist(): number | null {
    const snap = this.bridge.latest;
    if (!snap) return null;
    const taken = new Set<number>();
    for (const slot of this.players.values()) if (slot.actorId != null) taken.add(slot.actorId);
    const free = snap.colonists.map((c) => c.id).filter((id) => !taken.has(id)).sort((a, b) => a - b);
    return free.length ? free[0] : null;
  }

  private broadcastRoster(): void {
    const players = [...this.players.entries()].map(([peerId, slot]) => ({ peerId, name: slot.name, actorId: slot.actorId }));
    this.room.sendRoster({ hostId: this.room.selfId, players });
  }

  dispose(): void {
    this.offSnap();
    this.offEvt();
    for (const slot of this.players.values()) if (slot.actorId != null) this.bridge.possess(slot.actorId, false);
    this.players.clear();
  }
}
