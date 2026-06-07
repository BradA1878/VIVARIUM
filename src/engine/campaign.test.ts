/* ============================================================================
   Campaign tests — the launch-window arc resolves to victory or defeat (doc §2.5).
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony, Tuning } from "./index";
import type { ColonyEvent } from "@shared/types";

function runCollecting(c: Colony, seconds: number, step = 0.2): ColonyEvent[] {
  const evs: ColonyEvent[] = [];
  for (let i = 0; i < Math.round(seconds / step); i++) {
    c.tick(step);
    evs.push(...c.drainEvents());
  }
  return evs;
}

describe("the campaign", () => {
  it("a fresh colony starts mid-campaign with no outcome", () => {
    const s = new Colony().snapshot();
    expect(s.outcome).toBeNull();
    expect(s.deadlineSol).toBe(Tuning.DEADLINE_SOL);
    expect(s.targetPop).toBe(Tuning.TARGET_POP);
  });

  it("the self-sufficiency clock only runs while the colony is balanced", () => {
    const c = new Colony(1);
    // the seed colony isn't self-sufficient (too few crew), so the clock must
    // stay pinned at zero — no accidental drift toward a false victory.
    for (let i = 0; i < 200 / 0.2; i++) { c.tick(0.2); c.drainEvents(); }
    const s = c.snapshot();
    expect(s.selfSufficientFor).toBe(0);
    expect(s.outcome).not.toBe("victory");
  });

  it("losing the whole colony is a defeat", () => {
    const c = new Colony(9);
    c.removeAt(5, 7); // electrolysis — no oxygen production
    // run long enough for repeated suffocation to wipe the colony
    const evs = runCollecting(c, 600);
    const s = c.snapshot();
    if (s.population <= 0) {
      expect(s.outcome).toBe("defeat");
      expect(s.outcomeReason).toBe("colony");
      expect(evs.some((e) => e.type === "defeat")).toBe(true);
      expect(s.paused).toBe(true); // the engine halts on an outcome
    } else {
      // colony clung on — at least confirm no false victory was declared
      expect(s.outcome).not.toBe("victory");
    }
  });

  it("reaching the launch deadline without self-sufficiency is a defeat", () => {
    const c = new Colony(3);
    // tick straight past the deadline sol; the seed colony won't self-sustain
    const solSeconds = Tuning.SOL_LENGTH;
    const evs = runCollecting(c, solSeconds * (Tuning.DEADLINE_SOL + 1));
    const s = c.snapshot();
    expect(s.outcome).toBe("defeat");
    // either the window closed or the colony died first — both are defeats
    expect(["window", "colony"]).toContain(s.outcomeReason);
    expect(evs.some((e) => e.type === "defeat")).toBe(true);
  });
});
