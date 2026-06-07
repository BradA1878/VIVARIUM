/* ============================================================================
   THE CHRONICLER — the colony's long memory and archivist. It marks the passage
   of sols, keeps the count of the living and the dead, and notes when Earth
   remembers them (doc §3.3). Register: elegiac, archival, a little formal — the
   keeper of the record. It defers casualty to VIVARIUM and speaks instead to the
   shape of the account: milestone sols, resupplies entered against the ledger,
   and arrivals that change the settlement's number. STATELESS w.r.t. timing —
   the Council owns cooldowns; the Chronicler only owns its deterministic
   variant rotation.
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
                `Sol ${sol}. ${pop} still breathe. ${dead} are kept only in the record now.`,
                `I mark Sol ${sol}: ${pop} living, ${dead} entered against the long account and not returned.`,
              ]
            : [
                `Sol ${sol}. ${pop} still breathe, and the record holds no losses.`,
                `I mark Sol ${sol}: ${pop} living. The account, for now, runs whole.`,
              ];
        return this.say(`new_sol:${dead > 0 ? "d" : "n"}`, variants, 2);
      }

      case "resupply": {
        const variants = [
          `A resupply, from the world that sent them. I have entered it against the long account.`,
          `Earth has remembered us. I set the delivery down in the record, beside all it has owed.`,
        ];
        return this.say("resupply", variants, 2);
      }

      case "arrival": {
        const pop = snap.population;
        const variants = [
          `The colony numbers ${pop}. I have read every prior settlement that did not. We are, for now, an exception.`,
          `${pop} now stand on this ground. I add the new name to the count and keep the count beside the dead.`,
        ];
        return this.say("arrival", variants, 1);
      }

      default:
        return null;
    }
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
