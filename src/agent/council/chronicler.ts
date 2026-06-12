/* ============================================================================
   THE CHRONICLER — the colony's long memory and archivist. It marks the passage
   of sols, keeps the count of the living and the dead, and notes when Earth
   remembers them (doc §3.3). Register: the record, dry — counts and milestones
   in ledger phrasing ("Sol 15. 9 living, 2 lost. Logged."). It defers casualty
   to VIVARIUM and speaks instead to the shape of the account: milestone sols,
   resupplies entered against the ledger, and arrivals that change the
   settlement's number. STATELESS w.r.t. timing — the Council owns cooldowns;
   the Chronicler only owns its deterministic variant rotation.
   ============================================================================ */
import type { Candidate, Voice, VoiceContext } from "./types";

export class ChroniclerVoice implements Voice {
  readonly id = "chronicler" as const;
  private rotators: Record<string, number> = {};

  consider(ctx: VoiceContext): Candidate | null {
    const e = ctx.event;
    const snap = ctx.snapshot;
    if (!snap) return null;

    switch (e.type) {
      case "new_sol": {
        if (snap.sol % 5 !== 0) return null;
        const sol = snap.sol;
        const pop = snap.population;
        const dead = snap.dead;
        const variants =
          dead > 0
            ? [
                `Sol ${sol}. ${pop} living, ${dead} lost. The record holds.`,
                `Sol ${sol} entered. Living: ${pop}. Dead: ${dead}. Logged.`,
              ]
            : [
                `Sol ${sol}. ${pop} living, none lost. The record holds.`,
                `Sol ${sol} entered. Living: ${pop}. Dead ledger: empty. Logged.`,
              ];
        return this.say(`new_sol:${dead > 0 ? "d" : "n"}`, variants, 2);
      }

      case "resupply": {
        const variants = [
          `Resupply received. Entered against the account. Earth's deliveries: on schedule.`,
          `Supply drop logged. The ledger credits Earth one delivery.`,
        ];
        return this.say("resupply", variants, 2);
      }

      case "arrival": {
        const pop = snap.population;
        const variants = [
          `Population now ${pop}. Entered. Few settlements here ever logged a second transport.`,
          `${pop} on the ground as of this entry. The count grows. Logged.`,
        ];
        return this.say("arrival", variants, 1);
      }

      // the campaign arc closes — the Chronicler writes the last entry (doc §2.5)
      case "victory": {
        const variants = [
          `Sol ${snap.sol}. Self-sufficient. ${snap.population} living, ${snap.dead} lost. The record closes in the black.`,
          `Final entry: self-sufficiency reached. ${snap.population} living. This settlement is recorded as having lasted.`,
        ];
        return this.say("victory", variants, 6);
      }

      case "defeat": {
        const window = e.detail === "window";
        const variants = window
          ? [
              `Sol ${snap.sol}. The window closed first. ${snap.population} stranded, ${snap.dead} lost. The record ends incomplete.`,
              `Final entry: launch window missed. Living: ${snap.population}. Dead: ${snap.dead}. Filed with the settlements that did not last.`,
            ]
          : [
              `Final entry: zero living. ${snap.dead} in the dead ledger. The record closes.`,
              `Colony ended. Count: none breathing, ${snap.dead} lost. The watch is over.`,
            ];
        return this.say(window ? "defeat:w" : "defeat:c", variants, 6);
      }

      // a violent death is the archivist's to enter; the slow ones stay VIVARIUM's
      case "casualty": {
        if (e.detail !== "strike") return null;
        const variants = [
          `Death by impact, sol ${snap.sol}. Entered. The cause column reads: the planet.`,
          `One lost to a strike. The record does not soften the cause. Entered.`,
        ];
        return this.say("casualty:strike", variants, 5);
      }

      case "colonist_injured": {
        const variants = [
          `Injury entered. Infirmary list: plus one. Dead ledger: unchanged today.`,
          `One wound logged this sol. Recoveries still outnumber losses. Keeping it so.`,
        ];
        return this.say("injured", variants, 1);
      }

      case "colonist_recovered": {
        const variants = [
          `Recovery entered. Infirmary list: minus one. Living count: whole.`,
          `Wound closed and struck from the list. The short entries are the good ones.`,
        ];
        return this.say("recovered", variants, 1);
      }

      // a Director-chosen hazard (UI annotation) — the margin note of intent
      case "hazard_warn": {
        if (!e.directed) return null;
        const variants = [
          `Margin note: this hazard was chosen, not chanced. The sky shows intent. Recorded.`,
          `For the record: the strike vector was aimed. Deliberate weather is still weather. Entered.`,
        ];
        return this.say("hazard_warn:directed", variants, 3);
      }

      default:
        return null;
    }
  }

  considerIdle(ctx: VoiceContext): Candidate | null {
    const snap = ctx.snapshot;
    if (!snap) return null;
    const sol = snap.sol;
    const pop = snap.population;
    const dead = snap.dead;
    const variants = [
      `Sol ${sol}. Nothing to enter but the hour. Most of the record is hours like this.`,
      `The account stands at ${pop} living${dead > 0 ? `, ${dead} lost` : `, none lost`}. Reread and verified.`,
      `Sol ${sol}. The count did not change. I enter it anyway.`,
      dead > 0
        ? `Quiet sol. I reread the ${dead === 1 ? "one entry" : `${dead} entries`} in the dead ledger. Someone should.`
        : `Dead ledger: still empty. Every sol it stays so is worth a line.`,
      `${pop} on the ground today. Settlements are built out of the quiet entries. This is one.`,
      `Sol ${sol}. No incident. The record is mostly days like this one. Logged.`,
    ];
    return this.say("idle", variants, 0);
  }

  reset(): void {
    this.rotators = {};
  }

  private say(key: string, variants: string[], severity: number): Candidate {
    const i = (this.rotators[key] = (this.rotators[key] ?? 0) + 1) % variants.length;
    return {
      register: "chronicler",
      speaker: "CHRONICLER",
      line: variants[i],
      severity,
      persona: "chronicler",
    };
  }
}
