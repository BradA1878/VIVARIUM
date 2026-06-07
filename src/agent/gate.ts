/* ============================================================================
   The gate — the pre-LLM condition primitive (doc §3.1). It short-circuits on
   event type / severity / cooldown BEFORE a line is chosen (and, in the live
   build, before a model call is ever spent). Most events never reach the voice.
   This is what keeps a public Easter egg from being a cost faucet (doc §3.2).
   ============================================================================ */
import type { ColonyEvent } from "@shared/types";
import { SEV } from "./lines";

export const GLOBAL_COOLDOWN = 6.5; // seconds between any two lines
export const TYPE_COOLDOWN = 22;    // seconds before the same event speaks again
export const CHATTER_CHANCE = 0.18; // a sev-0 event (build) speaks this often

export class Gate {
  private lastGlobal = -999;
  private lastByType: Record<string, number> = {};

  /** should this event be allowed to speak at sim-time `now`? */
  allow(e: ColonyEvent, now: number, roll: number = Math.random()): boolean {
    const sev = SEV[e.type] ?? 0;
    if (sev <= 0 && roll > CHATTER_CHANCE) return false;
    // high severity (casualty / crit_start) speaks through cooldowns
    if (now - this.lastGlobal < GLOBAL_COOLDOWN && sev < 4) return false;
    const lt = this.lastByType[e.type] ?? -999;
    if (now - lt < TYPE_COOLDOWN && sev < 4) return false;
    return true;
  }

  /** record that a line was spoken for this event at `now` */
  mark(e: ColonyEvent, now: number): void {
    this.lastGlobal = now;
    this.lastByType[e.type] = now;
  }

  reset(): void {
    this.lastGlobal = -999;
    this.lastByType = {};
  }
}
