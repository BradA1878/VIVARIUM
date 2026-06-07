/* ============================================================================
   Narrator tests — the gate must keep the voice rare (doc §3.1–3.2): cooldowns
   suppress chatter, but a casualty speaks through anything.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Gate, GLOBAL_COOLDOWN } from "./gate";
import { ScriptedNarrator } from "./narrator";
import type { ColonyEvent } from "@shared/types";

function ev(type: ColonyEvent["type"], t: number, extra: Partial<ColonyEvent> = {}): ColonyEvent {
  return { type, t, sol: 1, tod: 0.3, ...extra };
}

describe("the gate", () => {
  it("enforces the global cooldown between two ordinary lines", () => {
    const g = new Gate();
    const a = ev("dawn", 0);
    expect(g.allow(a, 0)).toBe(true);
    g.mark(a, 0);
    // another (different, low-sev) event right after is suppressed
    expect(g.allow(ev("dusk", 1), 1)).toBe(false);
    // ...but allowed once the global cooldown has elapsed
    expect(g.allow(ev("dusk", GLOBAL_COOLDOWN + 1), GLOBAL_COOLDOWN + 1)).toBe(true);
  });

  it("lets a casualty speak through cooldowns (severity override)", () => {
    const g = new Gate();
    const a = ev("dawn", 0);
    g.allow(a, 0); g.mark(a, 0);
    // immediately after, a casualty (sev 5) still gets through
    expect(g.allow(ev("casualty", 0.2, { res: "oxygen" }), 0.2)).toBe(true);
  });

  it("suppresses repeat of the same type within the type cooldown", () => {
    const g = new Gate();
    const a = ev("storm_in", 0, { secs: 20 });
    expect(g.allow(a, 0)).toBe(true);
    g.mark(a, 0);
    // same type 10s later (< TYPE_COOLDOWN, sev 3 < 4) — suppressed
    expect(g.allow(ev("storm_in", 10, { secs: 20 }), 10)).toBe(false);
  });

  it("gates build chatter by the roll (deterministic via injected roll)", () => {
    const g = new Gate();
    expect(g.allow(ev("build", 0), 0, 0.9)).toBe(false); // roll > 0.18 → silent
    expect(g.allow(ev("build", 0), 0, 0.05)).toBe(true); // roll < 0.18 → speaks
  });
});

describe("ScriptedNarrator", () => {
  it("returns a line for a known event and substitutes {sol}", () => {
    const n = new ScriptedNarrator();
    const line = n.observe(ev("new_sol", 0, { sol: 7 }), 0);
    expect(line).toBeTruthy();
    expect(line).toContain("Sol 7");
  });

  it("picks the resource-specific bank for crit_start", () => {
    const n = new ScriptedNarrator();
    const line = n.observe(ev("crit_start", 0, { res: "oxygen" }), 0);
    expect(line?.toLowerCase()).toContain("oxygen");
  });

  it("lineFor ignores the gate (live-build fallback path)", () => {
    const n = new ScriptedNarrator();
    expect(n.lineFor(ev("brownout", 0))).toBeTruthy();
    expect(n.lineFor(ev("brownout", 0))).toBeTruthy(); // again, gate not consulted
  });
});
