/* ============================================================================
   The scripted narrator — VIVARIUM's offline voice. Observes the engine's event
   stream (doc §0: observe, never control), runs the gate, and picks a scripted
   line. Fully offline; no LLM, no network. In Phase 8 a live model can replace
   the line-pick behind the same gate, with this as the guaranteed fallback.
   ============================================================================ */
import type { ColonyEvent } from "@shared/types";
import { Gate } from "./gate";
import { LINES, bootLines } from "./lines";

type Bank = string[] | Record<string, string[]>;

export class ScriptedNarrator {
  private gate = new Gate();
  private rotators: Record<string, number> = {};

  /** the line VIVARIUM would speak for this event, or null if gated/none */
  observe(e: ColonyEvent, now: number): string | null {
    if (!this.gate.allow(e, now)) return null;
    const bank = LINES[e.type] as Bank | undefined;
    if (!bank) return null;
    const line = this.pick(bank, e);
    if (!line) return null;
    this.gate.mark(e, now);
    return line;
  }

  /** gate check only — does this event clear the cooldowns? (live build runs
   *  this BEFORE spending a model call, doc §3.1) */
  shouldSpeak(e: ColonyEvent, now: number): boolean {
    return this.gate.allow(e, now);
  }

  /** record that a line was spoken (call after a live OR scripted line is shown) */
  commit(e: ColonyEvent, now: number): void {
    this.gate.mark(e, now);
  }

  /** a line for a known event, ignoring the gate (used as the live-build fallback) */
  lineFor(e: ColonyEvent): string | null {
    const bank = LINES[e.type] as Bank | undefined;
    return bank ? this.pick(bank, e) : null;
  }

  bootLine(): string {
    const banks = bootLines();
    return banks[Math.floor(Math.random() * banks.length)];
  }

  reset(): void {
    this.gate.reset();
    this.rotators = {};
  }

  private pick(bank: Bank, e: ColonyEvent): string | null {
    let arr: string[];
    if (Array.isArray(bank)) arr = bank;
    else arr = e.res ? bank[e.res] ?? [] : [];
    if (!arr.length) return null;
    const key = e.type + (e.res ?? "");
    const i = (this.rotators[key] = (this.rotators[key] ?? 0) + 1) % arr.length;
    return arr[i]
      .replace("{sol}", String(e.sol))
      .replace("{secs}", String(e.secs ?? ""));
  }
}
