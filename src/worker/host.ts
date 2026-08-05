/* ============================================================================
   SimHost — the engine's worker-side host, factored out of the Worker shell so
   it can be unit-tested without a real Web Worker. Owns the Colony, applies
   commands, advances time (respecting pause/speed), and collects the outbound
   messages (throttled snapshot + drained events) for the shell to post.
   ============================================================================ */
import { Colony } from "@/engine";
import {
  type Command, type Outbound, SNAPSHOT_INTERVAL, MAX_DT, validShipmentManifest,
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

  /** apply a command from the main thread. State-changing commands paint at once;
   *  request/response operations return correlated acknowledgments. */
  applyCommand(cmd: Command): Outbound[] {
    switch (cmd.type) {
      case "place": this.colony.place(cmd.defId, cmd.gx, cmd.gy, (cmd.rot ?? 0) as 0 | 1 | 2 | 3); break;
      case "remove": this.colony.removeAt(cmd.gx, cmd.gy); break;
      case "rotate": this.colony.rotateAt(cmd.gx, cmd.gy); break;
      case "move": this.colony.move(cmd.uid, cmd.gx, cmd.gy); break;
      case "route": this.colony.route(cmd.fromUid, cmd.toUid); break;
      case "triggerHazard": this.colony.triggerHazard(cmd.kind, cmd.intensity); break;
      case "setDirector": this.colony.setDirector(cmd.value); break;
      case "possess": this.colony.possess(cmd.id, cmd.on); break;
      case "moveIntent": this.colony.setMoveIntent(cmd.dx, cmd.dy, cmd.id); break;
      case "interact": this.colony.interact(cmd.id); break;
      case "respondTrade": this.colony.respondTrade(cmd.accept); break;
      case "setPaused": this.colony.setPaused(cmd.value); break;
      case "setSpeed": this.colony.setSpeed(cmd.value); break;
      case "forceStorm": this.colony.forceStorm(); break;
      case "reset": this.colony.reset(cmd.difficulty, cmd.seed, cmd.world, cmd.legacy); break; // in-game restart / PTP founding — stays running
      case "load": // a resumed save ticks at once; a corrupt one reports + leaves the
        // fresh boot colony gated (the start screen is the recovery path) instead of wedging
        try {
          this.colony = Colony.load(cmd.data);
          this.started = true;
        } catch (err) {
          return [{
            type: "loaded", reqId: cmd.reqId, ok: false,
            detail: err instanceof Error ? err.message : String(err),
            snapshot: this.colony.snapshot(),
          }];
        }
        return [{ type: "loaded", reqId: cmd.reqId, ok: true, snapshot: this.colony.snapshot() }];
      case "start": this.colony.reset(cmd.difficulty, cmd.seed, cmd.world, cmd.legacy); this.started = true; break; // fresh game / founding on seed+world+difficulty+legacy
      case "launchPtp": this.colony.launchPtp(); break; // end the run as expansion (the store founds the next world)
      case "dispatchShipment": { // debit the sender; acknowledge the amount that ACTUALLY left
        if (!validShipmentManifest(cmd.manifest)) {
          return [{
            type: "shipmentDispatched", reqId: cmd.reqId, ok: false,
            detail: "shipment quantities must be finite and non-negative (crew must be a whole number)",
            snapshot: this.colony.snapshot(),
          }];
        }
        const manifest = this.colony.dispatchShipment(cmd.manifest);
        return [{ type: "shipmentDispatched", reqId: cmd.reqId, ok: true, manifest, snapshot: this.colony.snapshot() }];
      }
      case "switchColony": { // parallel-colonies: load a settled world, catch it up, resume live
        if (!cmd.credits.every(validShipmentManifest)) {
          return [{
            type: "switched", reqId: cmd.reqId, ok: false,
            detail: "switchColony: invalid shipment credit",
            snapshot: this.colony.snapshot(),
          }];
        }
        let next: Colony;
        let before: ReturnType<Colony["snapshot"]>;
        let events: ReturnType<Colony["drainEvents"]>;
        let snapshot: ReturnType<Colony["snapshot"]>;
        try {
          next = Colony.load(cmd.save); // a corrupt away-slot must NOT cost the live colony
          before = next.snapshot(); // the colony AS SAVED, before any credit/catch-up — the digest diffs it
          for (const credit of cmd.credits) next.creditShipment(credit); // matured shipments arrive as seed-state, before the catch-up
          next.setDirector(false);        // catch-up runs the engine scheduler (the main-thread Director isn't in the fast-forward)
          events = next.fastForward(cmd.steps, true); // collect the off-screen events for the "while you were away" digest
          next.setDirector(cmd.director); // restore the player's director setting for live play
          next.setPaused(false);          // a switched-to colony always resumes RUNNING (even if it was saved paused)
          snapshot = next.snapshot();
        } catch (err) {
          return [{
            type: "switched", reqId: cmd.reqId, ok: false,
            detail: `switchColony: ${err instanceof Error ? err.message : String(err)}`,
            snapshot: this.colony.snapshot(),
          }];
        }
        // COMMIT only after load, credits, catch-up, and snapshot construction all
        // succeeded. Any failure above leaves the live colony untouched.
        this.colony = next;
        this.started = true;                   // the switched colony ticks at once
        // Return one correlated acknowledgment containing both the catch-up report
        // and post-state. Its events never ride the live event stream (which would
        // replay the whole off-screen run through the narrator).
        return [{ type: "switched", reqId: cmd.reqId, ok: true, before, events, snapshot }];
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
    let events = [] as ReturnType<Colony["drainEvents"]>;
    if (this.started && !this.colony.paused) {
      let dt = realDt;
      if (dt > MAX_DT) dt = MAX_DT;
      this.colony.tick(dt * (this.colony.speed || 1));
      events = this.colony.drainEvents();
    }
    this.sinceSnapshot += realDt;
    // An event forces a frame even between normal HUD samples. The snapshot and
    // events are indivisible, preventing a Sol-2 event from being consumed against
    // a cached Sol-1 state.
    if (events.length || this.sinceSnapshot >= SNAPSHOT_INTERVAL) {
      this.sinceSnapshot = 0;
      return [{ type: "frame", snapshot: this.colony.snapshot(), events }];
    }
    return [];
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
