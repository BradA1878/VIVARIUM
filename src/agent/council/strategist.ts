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
    "Nothing stores the day. One dark sol will end them. Build a battery.",
    "You hold no charge. When the sun fails, so does everything. A battery.",
  ],
  water: [
    "You make oxygen but draw no ice. The water will run out before the seal matters. An extractor.",
    "No source feeds the water. It only ever falls from here. Build an extractor.",
  ],
  housing: [
    "Every berth is full. No more hands will come until you raise a roof. A habitat.",
    "There is nowhere left to sleep. Growth stops at the wall. A habitat.",
  ],
  food: [
    "The fields are losing. Food trends to nothing. Hydroponics, before Sol turns.",
    "You eat faster than you grow. The shortfall is only patient. Hydroponics.",
  ],
  labor: [
    "Every crew is spent. The work outpaces the workers. House more hands. A habitat.",
    "No one is idle, and that is not strength. Raise a habitat and bring more.",
  ],
};

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

  reset(): void {
    this.rotators = { battery: 0, water: 0, housing: 0, food: 0, labor: 0 };
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
