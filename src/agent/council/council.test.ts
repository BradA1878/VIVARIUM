/* ============================================================================
   Council tests — arbitration routes the right voice to the right beat, and the
   cooldowns keep the chorus sparse. (Doc §3.3.)
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "@/engine";
import { Council } from "./index";
import type { ColonyEvent } from "@shared/types";

function ev(type: ColonyEvent["type"], t: number, extra: Partial<ColonyEvent> = {}): ColonyEvent {
  return { type, t, sol: 1, tod: 0.3, ...extra };
}

describe("the Council", () => {
  it("routes a cascade crit to the Watcher, who names the cause", () => {
    const c = new Colony(7);
    c.removeAt(8, 8); // remove the extractor → water drains → electrolysis starves
    for (let i = 0; i < 80 / 0.2; i++) { c.tick(0.2); c.drainEvents(); }
    const council = new Council();
    const u = council.observe(ev("crit_start", 100, { res: "oxygen", sol: 1, tod: 0.5 }), c.snapshot(), 100);
    expect(u).toBeTruthy();
    expect(u!.register).toBe("watcher"); // wins the sev-4 tie over VIVARIUM
    expect(u!.line.toLowerCase()).toContain("water"); // the causal chain
  });

  it("the keeper handles ordinary beats", () => {
    const council = new Council();
    const u = council.observe(ev("dusk", 0), null, 0);
    expect(u?.register).toBe("vivarium");
  });

  it("the global cooldown silences a second ordinary line right after the first", () => {
    const council = new Council();
    const a = council.observe(ev("dusk", 0), null, 0);
    expect(a).toBeTruthy();
    const b = council.observe(ev("dawn", 1), null, 1); // 1s later, low severity
    expect(b).toBeNull();
  });

  it("a casualty (sev 5) speaks through the cooldown", () => {
    const council = new Council();
    council.observe(ev("dusk", 0), null, 0); // sets the global cooldown
    const u = council.observe(ev("casualty", 0.5, { res: "oxygen" }), null, 0.5);
    expect(u).toBeTruthy();
    expect(u!.register).toBe("vivarium");
  });

  it("the Chronicler marks a milestone sol", () => {
    const council = new Council();
    const snap = new Colony().snapshot();
    snap.sol = 10;
    const u = council.observe(ev("new_sol", 500, { sol: 10 }), snap, 500);
    // VIVARIUM (sev1) and Chronicler (sev2) both want new_sol; the Chronicler's
    // higher severity wins on a milestone sol.
    expect(u?.register).toBe("chronicler");
  });

  it("reset clears cooldowns and rotation", () => {
    const council = new Council();
    council.observe(ev("dusk", 0), null, 0);
    council.reset();
    const u = council.observe(ev("dawn", 0.2), null, 0.2); // would be gated without reset
    expect(u).toBeTruthy();
  });
});
