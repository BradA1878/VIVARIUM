/* ============================================================================
   THE WATCHER (doc §3.3, §7) — a Sentinel-flavored sensor intelligence on the
   council. Diagnostics in the dry register: it reads the colony's causal graph
   and names the CAUSAL CHAIN root-cause-first, with the number that proves it.
   It diagnoses; it never consoles. The Watcher cuts in only on sharp events — a
   pool emptying, a brownout, an incoming hazard, a structure lost — and defers
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
    "Oxygen at zero. No upstream fault resolves. Flagged as anomalous.",
    "Oxygen pool empty. The causal trace returns nothing. Watching.",
  ],
  water: [
    "Water at zero. No producer accounts for the loss. Flagged.",
    "Water pool empty. Cause unresolved. Trace logged.",
  ],
  food: [
    "Food at zero. The trace returns no root cause. Sensors open.",
    "Food pool empty. No fault upstream. The gap itself is the finding.",
  ],
  power: [
    "Power at zero. The grid reports no fault. That is the fault.",
    "Power pool empty. Cause unresolved. Modeling the dark.",
  ],
};

const CRIT: string[] = [
  "Cascade. {chain}. Root cause first.",
  "Cascade detected. {chain}. Pattern logged.",
  "Failure chain resolved: {chain}.",
];

const BROWNOUT: string[] = [
  "Power deficit. Draw exceeds supply. Lowest-priority loads shed first.",
  "Brownout. Demand over generation. Deficit logged.",
  "Grid sagging. Output short of draw. Shed order is priority, ascending.",
];

const STORM: string[] = [
  "Dust on the long-range return. {secs} seconds. Solar loss modeled.",
  "Storm inbound. {secs} seconds to contact. The light is forfeit.",
  "Particulate front. {secs} seconds. Solar projection: down by up to 88 percent.",
];

/** incoming-hazard telegraphs, keyed by kind ({secs} = time to impact) */
const HAZARD_WARN: Record<string, string[]> = {
  dust: [
    "Dust front inbound. {secs} seconds. Solar output will drop by up to 88 percent.",
    "Dust storm on approach. {secs} seconds. Expect solar between a tenth and a third.",
  ],
  meteor: [
    "Meteors on the descent track. Impact in {secs} seconds. Structures in the open are at risk.",
    "Debris field inbound. {secs} seconds to first strike. Buildings may take damage.",
  ],
  flare: [
    "Solar flare inbound. {secs} seconds. Electronics will take the surge first.",
    "Coronal ejection detected. {secs} seconds. Expect interference and a generation dip.",
  ],
  coldsnap: [
    "Temperature front falling. {secs} seconds. Heating load will climb sharply.",
    "Cold mass on approach. {secs} seconds. Power demand projection: up.",
  ],
  quake: [
    "Tremor signature building. {secs} seconds. Seals are the weak point.",
    "Subsurface movement. {secs} seconds to the jolt. Watching the corridors.",
  ],
};

const DESTROYED: string[] = [
  "Structure lost: the {name}. Cause: {cause}. Dependencies recomputed.",
  "The {name} is gone. {cause} confirmed as cause. Grid and supply remapped.",
  "The {name}: destroyed by the {cause}. Its output is now zero.",
];

/** a strike scrapped a mining robot — the fleet diagnosis, with the cause */
const ROBOT_DESTROYED: string[] = [
  "Mining robot destroyed. Cause: {cause}. Fleet count is lower.",
  "Robot lost at the impact point. Cause: {cause}. Gather rate recomputed.",
  "One robot scrapped. {cause} confirmed. Replacement requires the bay.",
];

/** the Sentinel's learned-model anomalies (Phase 13) — drift no threshold caught */
const ANOMALY: string[] = [
  "Anomaly. {detail} is {sigma} sigma from learned normal. No threshold tripped. Watching.",
  "The model flags {detail}: {sigma} sigma off baseline. Nothing else has noticed yet.",
  "Deviation in {detail}. {sigma} sigma. New shape. Recording.",
];

/** the clinical read on a sagging colony mood */
const MORALE_LOW: string[] = [
  "Morale below threshold. Work-rate variance climbing. Tired crews make unmodeled errors.",
  "Mood telemetry low. Output tracks it down. The fix is relief, not orders.",
];

/** a telegraph the Director chose — the Watcher names the intent (UI annotation) */
const DIRECTED: string[] = [
  "This {kind} did not drift in. Something chose it. The timing fits a tracked pattern.",
  "Hazard inbound — too well-aimed for chance. Random skies do not aim. Logging intent.",
];

/** how each hazard kind reads inside the attribution lines */
const KIND_NOUN: Record<string, string> = {
  dust: "storm", meteor: "meteorfall", flare: "flare", coldsnap: "cold", quake: "tremor",
};

/** idle telemetry — names the tightest margin when one exists */
const IDLE_MARGIN: string[] = [
  "Quiet. Tightest margin: {res}, {eta} seconds at the current draw. Watching it.",
  "Telemetry nominal. Nearest edge: {res}, {eta} seconds out. Margins are not promises.",
  "All channels steady. {res} runs thinnest: {eta} seconds if nothing changes.",
];

/** ...and distrusts the silence when nothing does */
const IDLE_CALM: string[] = [
  "No risks resolve. Every pool holds. Calm is the pattern I trust least.",
  "Nominal across all channels. Anomalies prefer hours like this one.",
  "Nothing to flag. Widening the sweep anyway.",
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
        // a Director-chosen strike (UI-annotated) earns the attribution read
        if (e.directed) {
          const noun = KIND_NOUN[e.kind ?? "dust"] ?? "storm";
          return this.make(this.rotate("hazard_warn:directed", DIRECTED).replace(/\{kind\}/g, noun), 3);
        }
        const bank = HAZARD_WARN[e.kind ?? "dust"] ?? HAZARD_WARN.dust;
        return this.make(this.rotate("hazard_warn:" + e.kind, bank).replace("{secs}", String(e.secs ?? 0)), 3);
      }
      case "morale_low":
        // sev 2 — the keeper (sev 3) leads the mood; the Watcher backs it up
        return this.make(this.rotate("morale_low", MORALE_LOW), 2);
      case "building_destroyed": {
        const name = (DEFS[e.defId ?? ""]?.name ?? "structure").toLowerCase();
        const line = this.rotate("destroyed", DESTROYED)
          .replace(/\{name\}/g, name)
          .replace(/\{cause\}/g, e.detail ?? "planet");
        return this.make(line, 4);
      }
      case "robot_destroyed": {
        const line = this.rotate("robot_destroyed", ROBOT_DESTROYED)
          .replace(/\{cause\}/g, e.detail ?? "strike");
        return this.make(line, 3);
      }
      default:
        return null;
    }
  }

  considerIdle(ctx: VoiceContext): Candidate | null {
    const snap = ctx.snapshot;
    if (!snap) return null;
    const risks = ctx.world.risks(snap);
    if (risks.length) {
      const r = risks[0];
      const line = this.rotate("idle:margin", IDLE_MARGIN)
        .replace("{res}", r.resource)
        .replace("{eta}", String(Math.max(1, Math.round(r.etaSeconds))));
      return this.make(line, 0);
    }
    return this.make(this.rotate("idle:calm", IDLE_CALM), 0);
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
