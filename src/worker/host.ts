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
  /** the start gate (doc: difficulty start screen). The engine ticks eagerly —
   *  hundreds of tests construct a Colony and tick at once — so the "wait for the
   *  player to pick a difficulty and press Begin" pause lives HERE, host-side, not
   *  in the engine. `start` (fresh game) and `load` (resumed save) flip it true.
   *  While false, step() still emits snapshots so the UI paints the static colony
   *  behind the start screen, but the tick is held. */
  private started = false;

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
      case "reset": this.colony.reset(cmd.difficulty, cmd.seed, cmd.world, cmd.legacy); break; // in-game restart / PTP founding — stays running
      case "load": this.colony = Colony.load(cmd.data); this.started = true; break; // a resumed save ticks at once
      case "start": this.colony.reset(cmd.difficulty, cmd.seed, cmd.world, cmd.legacy); this.started = true; break; // fresh game / founding on seed+world+difficulty+legacy
      case "launchPtp": this.colony.launchPtp(); break; // end the run as expansion (the store founds the next world)
      case "switchColony": { // parallel-colonies: load a settled world, catch it up, resume live
        this.colony = Colony.load(cmd.save);
        const before = this.colony.snapshot(); // the colony AS SAVED, before the off-screen catch-up — the digest diffs it
        this.colony.setDirector(false);        // catch-up runs the engine scheduler (the main-thread Director isn't in the fast-forward)
        const events = this.colony.fastForward(cmd.steps, true); // collect the off-screen events for the "while you were away" digest
        this.colony.setDirector(cmd.director); // restore the player's director setting for live play
        this.started = true;                   // the switched colony ticks at once
        // Return early (like `save`): the catch-up report + the post-catch-up snapshot.
        // The events ride the report ONLY — routing them through `events` would replay
        // the whole off-screen run through the narrator.
        return [
          { type: "catchupReport", before, events },
          { type: "snapshot", snapshot: this.colony.snapshot() },
        ];
      }
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
    if (this.started && !this.colony.paused) {
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
