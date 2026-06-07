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
import { DEFS } from "@/engine";
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

/** incoming-hazard telegraphs, keyed by kind ({secs} = time to impact) */
const HAZARD_WARN: Record<string, string[]> = {
  dust: [
    "Dust on the long-range return. {secs} seconds. I am dimming what we do not need.",
    "A storm comes for the light. {secs} seconds. I have started to hold our breath.",
  ],
  meteor: [
    "Meteors on the descent track. Impact in {secs}. I am modeling every rock.",
    "Debris field inbound. {secs} seconds to the first strike. Move nothing important into the open.",
  ],
  flare: [
    "Flare off the sun, {secs} seconds out. The electronics will feel it before you do.",
    "Coronal ejection inbound. {secs} seconds. Charge what you can; it will take the rest.",
  ],
  coldsnap: [
    "The temperature is falling, {secs} seconds to the front. The habs will burn power to stay warm.",
    "A cold mass approaches. {secs} seconds. Heating load is about to climb.",
  ],
  quake: [
    "Tremor signature building. {secs} seconds. The seal is the thing I fear for.",
    "Subsurface movement. {secs} seconds to the jolt. I am watching the corridors.",
  ],
};

const DESTROYED: string[] = [
  "Structure lost. The {name} is gone. I logged the moment it stopped existing.",
  "We have lost the {name}. I have already recomputed everything that depended on it.",
  "The {name} is rubble. The {cause} took it. I told you what the {cause} does.",
];

/** the Sentinel's learned-model anomalies (Phase 13) — drift no threshold caught */
const ANOMALY: string[] = [
  "Anomaly. {detail} does not match any sol I have learned — {sigma} sigma from normal. I am watching it.",
  "The model flags {detail}. {sigma} sigma off the manifold. Nothing has tripped yet. That is what concerns me.",
  "Deviation in {detail}. {sigma} sigma. I have not seen this shape before. I am recording it.",
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
      case "anomaly":
        return this.make(
          this.rotate("anomaly", ANOMALY)
            .replace("{detail}", e.detail ?? "a signal")
            .replace("{sigma}", String(e.sigma ?? "several")),
          3,
        );
      case "hazard_warn": {
        const bank = HAZARD_WARN[e.kind ?? "dust"] ?? HAZARD_WARN.dust;
        return this.make(this.rotate("hazard_warn:" + e.kind, bank).replace("{secs}", String(e.secs ?? 0)), 3);
      }
      case "building_destroyed": {
        const name = (DEFS[e.defId ?? ""]?.name ?? "structure").toLowerCase();
        const line = this.rotate("destroyed", DESTROYED)
          .replace(/\{name\}/g, name)
          .replace(/\{cause\}/g, e.detail ?? "planet");
        return this.make(line, 4);
      }
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
