/* ============================================================================
   THE STRATEGIST — the council's forward-looking advisor (doc §3.3). Where
   VIVARIUM narrates and the WATCHER warns of the immediate, the Strategist reads
   the colony's structure and names the next bottleneck before it bites. It speaks
   in spare imperatives and only on beats where a fresh plan is worth hearing
   (hub coming online, the turn of a sol, a new arrival). It stays silent when the
   colony is sound, so its rare line carries weight. Its severity is deliberately
   low: advice must always lose arbitration to a live crisis.
   ============================================================================ */
import type { ColonyEvent, Resource, Snapshot } from "@shared/types";
import { DEFS } from "@/engine";
import type { Candidate, Voice, VoiceContext } from "./types";

/** the event beats on which the Strategist will consider speaking */
const SPEAK_ON: ReadonlySet<ColonyEvent["type"]> = new Set([
  "hub_online",
  "new_sol",
  "arrival",
]);

/** the bottlenecks the Strategist knows how to name, in priority order */
type Concern = "battery" | "water" | "housing" | "food" | "labor";

/** 1–2 scripted variants per concern, rotated deterministically */
const SCRIPTS: Record<Concern, readonly string[]> = {
  battery: [
    "Stored power: zero. One night ends the colony. Build a battery.",
    "No charge survives dusk. Night demand goes unmet. Build a battery.",
  ],
  water: [
    "Oxygen production draws water nothing replaces. Build an extractor.",
    "Water sources on the grid: zero. The pool only falls. Build an extractor.",
  ],
  housing: [
    "Housing full. Growth is capped at the berth count. Build a habitat.",
    "Every berth taken. No arrivals until there is a roof. Build a habitat.",
  ],
  food: [
    "Food flow is negative. Stores trend to zero. Build hydroponics.",
    "Consumption exceeds growth. The shortfall compounds. Build hydroponics.",
  ],
  labor: [
    "Labor at 100 percent. Buildings stand unstaffed. Build a habitat.",
    "Every hand assigned. The work outpaces the workers. Build a habitat.",
  ],
};

/** generic build nudges for a colony with no named bottleneck — idle is the one
 *  beat where unprompted advice fits */
const IDLE_NUDGES: readonly string[] = [
  "No active deficit. The lull is budget. Build spare capacity.",
  "Quiet sol. Buildings cost less now than mid-crisis. Build ahead of need.",
];

export class StrategistVoice implements Voice {
  readonly id = "strategist" as const;

  /** per-concern rotation cursors; deterministic, no Math.random */
  private rotators: Record<Concern, number> = {
    battery: 0,
    water: 0,
    housing: 0,
    food: 0,
    labor: 0,
  };

  /** rotation cursor for the generic idle nudges */
  private idleRot = 0;

  consider(ctx: VoiceContext): Candidate | null {
    if (!SPEAK_ON.has(ctx.event.type)) return null;
    const snap = ctx.snapshot;
    if (!snap) return null;

    const concern = this.diagnose(snap);
    if (!concern) return null;

    const line = this.pick(concern);
    const severity = ctx.event.type === "hub_online" ? 2 : 1;
    return {
      register: "strategist",
      speaker: "STRATEGIST",
      line,
      severity,
      persona: "strategist",
    };
  }

  considerIdle(ctx: VoiceContext): Candidate | null {
    const snap = ctx.snapshot;
    if (!snap) return null;
    // a found bottleneck reuses the concern SCRIPTS — idle is when advice fits
    const concern = this.diagnose(snap);
    const line = concern ? this.pick(concern) : IDLE_NUDGES[this.idleRot++ % IDLE_NUDGES.length];
    return {
      register: "strategist",
      speaker: "STRATEGIST",
      line,
      severity: 0,
      persona: "strategist",
    };
  }

  reset(): void {
    this.rotators = { battery: 0, water: 0, housing: 0, food: 0, labor: 0 };
    this.idleRot = 0;
  }

  /** the single most pressing structural bottleneck, or null if the colony is sound */
  private diagnose(snap: Snapshot): Concern | null {
    const defIds = snap.buildings.map((b) => b.defId);

    // 1. No battery — surviving the dark is the core tension.
    if (!defIds.some((id) => DEFS[id]?.caps?.power != null)) return "battery";

    // 2. No water source.
    if (!defIds.some((id) => hasProduce(id, "water"))) return "water";

    // 3. Housing full.
    if (snap.population >= snap.housing) return "housing";

    // 4. Food draining.
    if (snap.flow.food < -0.05) return "food";

    // 5. Labor saturated, with at least one staffed building running.
    if (
      snap.labor > 0 &&
      snap.laborUsed >= snap.labor &&
      defIds.some((id) => (DEFS[id]?.staffing ?? 0) > 0)
    ) {
      return "labor";
    }

    return null;
  }

  private pick(concern: Concern): string {
    const variants = SCRIPTS[concern];
    const i = this.rotators[concern] % variants.length;
    this.rotators[concern] += 1;
    return variants[i];
  }
}

function hasProduce(defId: string, res: Resource): boolean {
  const v = DEFS[defId]?.produces[res];
  return v != null && v > 0;
}
