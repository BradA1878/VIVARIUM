/* ============================================================================
   VIVARIUM — the keeper. The original voice and the council's host: it speaks to
   most events in the established serif-italic register (doc §4.5). The other
   members defer to it on ordinary beats and only cut in where their concern is
   sharper. Reuses the scripted banks from lines.ts.
   ============================================================================ */
import { LINES, SEV } from "../lines";
import type { Candidate, Voice, VoiceContext } from "./types";

type Bank = string[] | Record<string, string[]>;

export class VivariumVoice implements Voice {
  readonly id = "vivarium" as const;
  private rotators: Record<string, number> = {};

  consider(ctx: VoiceContext): Candidate | null {
    const e = ctx.event;
    const bank = LINES[e.type] as Bank | undefined;
    if (!bank) return null;
    const line = this.pick(bank, e.type, e.res, e.sol, e.secs);
    if (!line) return null;
    return {
      register: "vivarium",
      speaker: "VIVARIUM",
      line,
      severity: SEV[e.type] ?? 0,
      persona: "vivarium",
    };
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
  ): string | null {
    let arr: string[];
    if (Array.isArray(bank)) arr = bank;
    else arr = res ? bank[res] ?? [] : [];
    if (!arr.length) return null;
    const key = type + (res ?? "");
    const i = (this.rotators[key] = (this.rotators[key] ?? 0) + 1) % arr.length;
    return arr[i].replace("{sol}", String(sol)).replace("{secs}", String(secs ?? ""));
  }
}
