/* ============================================================================
   NetBridge — a guest's (astronaut's) bridge. Extends the SAME BridgeCore the
   worker bridge uses, but the transport is a Trystero data channel to the host
   instead of a Web Worker: commands go to the host, the host's snapshots/events
   come back. The renderer and store can't tell it from a SimBridge — that's the
   whole point of the bridge-as-network-seam (doc §0).

   No worker runs on a guest: the authoritative sim lives on the host. A guest only
   ever drives its own astronaut (the host attributes its input), so `localActor`
   (set from the host's claim) re-derives the snapshot's scalar `possessed` to "me".
   ============================================================================ */
import { BridgeCore } from "@/worker/bridge";
import type { Command } from "@/worker/protocol";
import type { NetRoom } from "./room";

export class NetBridge extends BridgeCore {
  private hostId: string | null = null;

  constructor(private room: NetRoom, private playerName: string) {
    super();
    // a guest is never the architect, so its view is always "my actor or nobody":
    // start as a spectator (null) until the host claims a colonist for us.
    this.localActor = null;

    room.onSnap((snap) => this.receive({ type: "snapshot", snapshot: snap }));
    room.onEvt((evt) => this.receive({ type: "events", events: [evt] }));
    room.onHello((hello, peerId) => {
      if (hello.role === "host") { this.hostId = peerId; this.ready = true; }
    });
    room.onClaim((claim) => { this.localActor = claim.actorId; });
    // greet the host when we see a peer (the host greets us back + assigns a colonist)
    room.onPeerJoin((peerId) => { this.room.sendHello({ role: "guest", name: this.playerName }, peerId); });
  }

  protected send(cmd: Command): void {
    // star topology: a guest only ever talks to the host
    if (this.hostId) this.room.sendCmd(cmd, this.hostId);
    else this.room.sendCmd(cmd); // pre-handshake — broadcast; the host will pick it up
  }

  dispose(): void {
    this.room.leave();
    this.clearCore();
  }
}
