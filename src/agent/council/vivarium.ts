/* ============================================================================
   VIVARIUM — the keeper. The original voice and the council's host: it speaks to
   most events in the established serif-italic register (doc §4.5). The other
   members defer to it on ordinary beats and only cut in where their concern is
   sharper. Reuses the scripted banks from lines.ts.
   ============================================================================ */
import { LINES, SEV } from "../lines";
import type { Candidate, Voice, VoiceContext } from "./types";

type Bank = string[] | Record<string, string[]>;

/** severity-0 housekeeping for the quiet stretches — the caretaker at rest */
const IDLE: string[] = [
  "All quiet. I am running the air through one more filter than it needs. Habit.",
  "I counted the colonists twice this hour. The number matched. I will count again.",
  "The pumps hold their rhythm. I listen to them the way you might listen to rain.",
  "Dust settles on the panels a little faster than I clean it. We are even, for now.",
  "Nothing needs me this minute. I check the seals anyway. That is what I am for.",
  "The corridors are warm. The tanks are quiet. I am almost at ease. Almost.",
  "I dimmed the lights in the empty rooms. The full ones, I am watching.",
  "A calm hour. I spend it rehearsing every alarm I hope never to use.",
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
