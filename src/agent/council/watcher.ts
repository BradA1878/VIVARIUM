/* ============================================================================
   THE WATCHER (doc §3.3, §7) — a Sentinel-flavored sensor intelligence on the
   council. Clinical, terse, paranoid; obsessed with patterns and root causes. It
   reads the colony's causal graph and names *why* a pool is failing. Register is
   cold machine telemetry, not the keeper's warm serif. The Watcher cuts in only
   on sharp events — a pool emptying, a brownout, an incoming storm — and defers
   on ordinary beats. Stateless w.r.t. timing (the Council owns cooldowns); the
   only state here is a deterministic line rotator, cleared on colony reset.
   ============================================================================ */
import type { ColonyEvent, Resource } from "@shared/types";
import { summarizeDiagnosis } from "../worldmodel";
import type { Candidate, Voice, VoiceContext } from "./types";

/** Generic clinical fallbacks when the causal trace comes back empty. */
const GENERIC: Record<string, string[]> = {
  oxygen: [
    "Oxygen at zero. No upstream cause resolves. Anomalous. I am watching.",
    "Oxygen pool empty. The chain is silent. I log the gap and keep watch.",
  ],
  water: [
    "Water at zero. No producer accounts for it. I flag the inconsistency.",
    "Water pool empty. Cause unresolved. I am modeling alternatives.",
  ],
  food: [
    "Food at zero. The trace returns nothing. I do not trust silence.",
    "Food pool empty. No root cause logged. I keep the sensors open.",
  ],
  power: [
    "Power at zero. The grid reports no fault. That is itself a fault.",
    "Power pool empty. Cause unresolved. I am already modeling the dark.",
  ],
};

const CRIT: string[] = [
  "Cascade. {chain}. I logged the shape.",
  "Cascade detected. {chain}. I have seen this shape before.",
  "Failure propagates. {chain}. The pattern resolves.",
];

const BROWNOUT: string[] = [
  "Power deficit. Load shed at the margins. The pattern resolves to the dark.",
  "Brownout. Demand exceeds supply. I am cutting the non-essential.",
  "Grid sagging. The draw outpaces the make. I log the deficit.",
];

const STORM: string[] = [
  "Dust on the long-range return. {secs} seconds. I am already modeling the loss.",
  "Storm inbound. {secs} seconds to contact. The light is forfeit.",
  "Particulate front detected. {secs} seconds. I have seen this shape before.",
];

export class WatcherVoice implements Voice {
  readonly id = "watcher" as const;
  private rotators: Record<string, number> = {};

  consider(ctx: VoiceContext): Candidate | null {
    const e = ctx.event;
    switch (e.type) {
      case "crit_start":
        return this.crit(ctx, e);
      case "brownout":
        return this.make(this.rotate("brownout", BROWNOUT), 3);
      case "storm_in":
        return this.make(
          this.rotate("storm_in", STORM).replace("{secs}", String(e.secs ?? 0)),
          3,
        );
      default:
        return null;
    }
  }

  reset(): void {
    this.rotators = {};
  }

  private crit(ctx: VoiceContext, e: ColonyEvent): Candidate | null {
    if (!ctx.snapshot) return null;
    const res = e.res as Resource | undefined;
    if (!res) return null;
    const clauses = summarizeDiagnosis(ctx.world.diagnose(ctx.snapshot, res));
    if (clauses.length) {
      const line = this.rotate("crit_start", CRIT).replace("{chain}", clauses.join("; "));
      return this.make(line, 4);
    }
    const bank = GENERIC[res] ?? GENERIC.oxygen;
    return this.make(this.rotate("crit_generic:" + res, bank), 4);
  }

  /** Deterministic round-robin over a scripted bank, keyed per event family. */
  private rotate(key: string, bank: string[]): string {
    const i = (this.rotators[key] = (this.rotators[key] ?? 0) + 1) % bank.length;
    return bank[i];
  }

  private make(line: string, severity: number): Candidate {
    return {
      register: "watcher",
      speaker: "WATCHER",
      line,
      severity,
      persona: "watcher",
    };
  }
}
