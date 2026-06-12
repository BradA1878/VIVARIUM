/* ============================================================================
   VIVARIUM — the keeper. The original voice and the council's host: it speaks to
   most events in the dry status-report register (doc §4.5) — what changed, the
   key number, what the kernel is doing about it, plus at most one dry aside.
   The other members defer to it on ordinary beats and only cut in where their
   concern is sharper. Reuses the scripted banks from lines.ts.
   ============================================================================ */
import { LINES, SEV } from "../lines";
import type { Candidate, Voice, VoiceContext } from "./types";

type Bank = string[] | Record<string, string[]>;

/** severity-0 housekeeping for the quiet stretches — the kernel at rest */
const IDLE: string[] = [
  "All systems nominal. I am running the air through one extra filter. Habit.",
  "Quiet hour. I counted the colonists twice. The numbers matched.",
  "Pumps steady. Pressure steady. Nothing requires me. I am checking the seals anyway.",
  "Telemetry flat. Dust on the panels within tolerance. I am cleaning it anyway.",
  "No alarms this hour. I am rehearsing them anyway.",
  "Power, water, oxygen, food: all holding. I logged the hour as uneventful.",
  "Empty rooms dimmed. Occupied rooms watched. Standard cycle.",
  "Nominal across the board. I will say so again in an hour, if it stays true.",
];

export class VivariumVoice implements Voice {
  readonly id = "vivarium" as const;
  private rotators: Record<string, number> = {};

  consider(ctx: VoiceContext): Candidate | null {
    const e = ctx.event;
    const bank = LINES[e.type] as Bank | undefined;
    if (!bank) return null;
    // record banks key by resource; a strike casualty carries detail instead
    const key = e.res ?? (e.type === "casualty" && e.detail === "strike" ? "strike" : undefined);
    const line = this.pick(bank, e.type, key, e.sol, e.secs, e.detail);
    if (!line) return null;
    return {
      register: "vivarium",
      speaker: "VIVARIUM",
      line,
      severity: SEV[e.type] ?? 0,
      persona: "vivarium",
    };
  }

  considerIdle(ctx: VoiceContext): Candidate | null {
    const line = this.pick(IDLE, "idle", undefined, ctx.event.sol, undefined);
    if (!line) return null;
    return { register: "vivarium", speaker: "VIVARIUM", line, severity: 0, persona: "vivarium" };
  }

  reset(): void {
    this.rotators = {};
  }

  private pick(
    bank: Bank,
    type: string,
    res?: string,
    sol?: number,
    secs?: number,
    detail?: string,
  ): string | null {
    let arr: string[];
    if (Array.isArray(bank)) arr = bank;
    else arr = res ? bank[res] ?? [] : [];
    if (!arr.length) return null;
    const key = type + (res ?? "");
    const i = (this.rotators[key] = (this.rotators[key] ?? 0) + 1) % arr.length;
    return arr[i]
      .replace("{sol}", String(sol))
      .replace("{secs}", String(secs ?? ""))
      .replace("{detail}", detail ?? "");
  }
}
