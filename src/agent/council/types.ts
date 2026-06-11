/* ============================================================================
   The Council (doc §3.3, §7) — the agent layer as a chorus, not one voice. Each
   member observes the engine's event stream + the causal world model and may
   speak in its own register. The Council arbitrates so only one voice speaks per
   beat. Voices are STATELESS w.r.t. timing: each consider() is a pure function of
   (event, snapshot, world); the Council owns all cooldowns. This keeps each voice
   independently authorable and testable.
   ============================================================================ */
import type { ColonyEvent, Snapshot } from "@shared/types";
import type { WorldStore } from "../worldmodel";

/** which member is speaking — drives the terminal's styling + the live persona */
export type Register = "vivarium" | "watcher" | "strategist" | "chronicler";

export interface VoiceContext {
  event: ColonyEvent;
  snapshot: Snapshot | null;
  world: WorldStore;
  /** sim-time of the event (the gate clock) */
  now: number;
}

/** a candidate line from a voice, before the Council decides who actually speaks */
export interface Candidate {
  register: Register;
  /** display name shown in the terminal, e.g. "WATCHER" */
  speaker: string;
  line: string;
  /** higher wins arbitration and speaks through cooldowns (≥4 = override) */
  severity: number;
  /** live-build persona key (server selects the matching system prompt) */
  persona: Register;
}

export interface Voice {
  id: Register;
  /** decide whether to speak. Pure — no time/cooldown state here. */
  consider(ctx: VoiceContext): Candidate | null;
  /** offer a severity-0 line for a quiet colony (ctx.event.type === "idle").
   *  Same purity rule as consider(); the Council owns the banter scheduler. */
  considerIdle?(ctx: VoiceContext): Candidate | null;
  /** reset any per-voice rotation state (on colony reset) */
  reset?(): void;
}
