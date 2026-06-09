/* ============================================================================
   SimHost — the engine's worker-side host, factored out of the Worker shell so
   it can be unit-tested without a real Web Worker. Owns the Colony, applies
   commands, advances time (respecting pause/speed), and collects the outbound
   messages (throttled snapshot + drained events) for the shell to post.
   ============================================================================ */
import { Colony } from "@/engine";
import {
  type Command, type Outbound, SNAPSHOT_INTERVAL, MAX_DT,
} from "./protocol";

export class SimHost {
  private colony: Colony;
  private sinceSnapshot = 0;

  constructor(seed?: number) {
    this.colony = seed === undefined ? new Colony() : new Colony(seed);
  }

  /** apply a command from the main thread. Returns any immediate replies
   *  (currently only `save`); snapshots/events flow through step(). */
  applyCommand(cmd: Command): Outbound[] {
    switch (cmd.type) {
      case "place": this.colony.place(cmd.defId, cmd.gx, cmd.gy, (cmd.rot ?? 0) as 0 | 1 | 2 | 3); break;
      case "remove": this.colony.removeAt(cmd.gx, cmd.gy); break;
      case "rotate": this.colony.rotateAt(cmd.gx, cmd.gy); break;
      case "move": this.colony.move(cmd.uid, cmd.gx, cmd.gy); break;
      case "route": this.colony.route(cmd.fromUid, cmd.toUid); break;
      case "triggerHazard": this.colony.triggerHazard(cmd.kind, cmd.intensity); break;
      case "setDirector": this.colony.setDirector(cmd.value); break;
      case "possess": this.colony.possess(cmd.id); break;
      case "moveIntent": this.colony.setMoveIntent(cmd.dx, cmd.dy); break;
      case "interact": this.colony.interact(); break;
      case "respondTrade": this.colony.respondTrade(cmd.accept); break;
      case "setPaused": this.colony.setPaused(cmd.value); break;
      case "setSpeed": this.colony.setSpeed(cmd.value); break;
      case "forceStorm": this.colony.forceStorm(); break;
      case "reset": this.colony.reset(); break;
      case "load": this.colony = Colony.load(cmd.data); break;
      case "start": break;
      case "save":
        return [{ type: "saved", reqId: cmd.reqId, data: this.colony.serialize() }];
    }
    // Commands change state the player should see at once — push a snapshot now.
    return [{ type: "snapshot", snapshot: this.colony.snapshot() }, ...this.drainEvents()];
  }

  /** advance by a real-time dt (seconds). Honors pause and speed. Returns the
   *  outbound messages produced this step (events always; snapshot when due). */
  step(realDt: number): Outbound[] {
    const out: Outbound[] = [];
    if (!this.colony.paused) {
      let dt = realDt;
      if (dt > MAX_DT) dt = MAX_DT;
      this.colony.tick(dt * (this.colony.speed || 1));
      out.push(...this.drainEvents());
    }
    this.sinceSnapshot += realDt;
    if (this.sinceSnapshot >= SNAPSHOT_INTERVAL) {
      this.sinceSnapshot = 0;
      out.push({ type: "snapshot", snapshot: this.colony.snapshot() });
    }
    return out;
  }

  private drainEvents(): Outbound[] {
    const events = this.colony.drainEvents();
    return events.length ? [{ type: "events", events }] : [];
  }

  /** for tests / initial paint */
  snapshotMessage(): Outbound {
    return { type: "snapshot", snapshot: this.colony.snapshot() };
  }
}
