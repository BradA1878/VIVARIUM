/* ============================================================================
   Council tests — arbitration routes the right voice to the right beat, and the
   cooldowns keep the chorus sparse. (Doc §3.3.)
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "@/engine";
import { Council } from "./index";
import { LINES, SEV, bootLines } from "../lines";
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

  it("a directed hazard telegraph routes to the Watcher with the attribution flavor", () => {
    const council = new Council();
    const snap = new Colony().snapshot();
    const u = council.observe(ev("hazard_warn", 50, { kind: "meteor", secs: 12, directed: true }), snap, 50);
    expect(u).toBeTruthy();
    expect(u!.register).toBe("watcher");
    expect(u!.line.toLowerCase()).toMatch(/chose|aim/); // "something chose it"
  });

  it("an undirected hazard telegraph keeps the plain forecast", () => {
    const council = new Council();
    const u = council.observe(ev("hazard_warn", 50, { kind: "meteor", secs: 12 }), null, 50);
    expect(u?.register).toBe("watcher");
    expect(u!.line.toLowerCase()).not.toMatch(/chose|aim/);
  });

  it("an idle candidate never outranks a real event — a fresh real event silences banter", () => {
    const council = new Council(() => 0);
    const snap = new Colony().snapshot();
    // a real event landed THIS second → the quiet predicate fails outright...
    expect(council.observeIdle(snap, 100, 100)).toBeNull();
    // ...while the real event itself speaks normally
    expect(council.observe(ev("dawn", 100), snap, 100)).toBeTruthy();
    expect(SEV.idle).toBe(0); // and idle sits at the bottom of the severity order
  });
});

describe("the new event banks", () => {
  it("speaks to every new colonist/morale event type", () => {
    for (const type of ["morale_low", "morale_recovered", "colonist_injured", "colonist_recovered"] as const) {
      const council = new Council();
      const u = council.observe(ev(type, 10, { id: 3 }), null, 10);
      expect(u, type).toBeTruthy();
    }
  });

  it("carries the spec'd line counts and severities", () => {
    expect((LINES.morale_low as string[]).length).toBe(3);
    expect((LINES.morale_recovered as string[]).length).toBeGreaterThanOrEqual(1);
    expect((LINES.colonist_injured as string[]).length).toBe(3);
    expect((LINES.colonist_recovered as string[]).length).toBeGreaterThanOrEqual(1);
    expect(SEV.morale_low).toBeGreaterThanOrEqual(2);
    expect(SEV.morale_low).toBeLessThanOrEqual(3);
    expect(SEV.morale_recovered).toBe(1);
    expect(SEV.colonist_injured).toBe(2);
    expect(SEV.colonist_recovered).toBe(1);
  });

  it("a strike death finally gets a line — the Chronicler with a snapshot, VIVARIUM without", () => {
    const a = new Council();
    const noSnap = a.observe(ev("casualty", 5, { detail: "strike", n: 1 }), null, 5);
    expect(noSnap).toBeTruthy();
    expect(noSnap!.register).toBe("vivarium");
    const b = new Council();
    const withSnap = b.observe(ev("casualty", 5, { detail: "strike", n: 1 }), new Colony().snapshot(), 5);
    expect(withSnap).toBeTruthy();
    expect(withSnap!.register).toBe("chronicler");
  });

  it("resource casualties still read from the per-resource banks", () => {
    const council = new Council();
    const u = council.observe(ev("casualty", 5, { res: "oxygen" }), null, 5);
    expect(u?.register).toBe("vivarium");
    expect(u!.line.toLowerCase()).toContain("breath");
  });

  it("bootLines vary by difficulty and thread through Council.bootLine", () => {
    expect(bootLines("easy")[0]).not.toBe(bootLines()[0]);
    expect(bootLines("hard")[0]).not.toBe(bootLines()[0]);
    expect(bootLines("normal")[0]).toBe(bootLines()[0]);
    const council = new Council();
    expect(council.bootLine("hard").line).toBe(bootLines("hard")[0]);
    expect(council.bootLine().line).toBe(bootLines()[0]);
  });

  it("speaks to every homeostasis event — unlock, the rover, the robots, and the lineage", () => {
    for (const type of ["unlock", "rover_ready", "robot_ready", "robot_destroyed", "fabricator_ready", "fabricator_stalled"] as const) {
      const council = new Council();
      const u = council.observe(ev(type, 10, { defId: "windturbine", detail: "Wind Turbine", gx: 4, gy: 4 }), null, 10);
      expect(u, type).toBeTruthy();
    }
    // the unlock line carries the schematic's display name through {detail}
    const a = new Council().observe(ev("unlock", 10, { defId: "windturbine", detail: "Wind Turbine" }), null, 10);
    expect(a!.line).toContain("Wind Turbine");
    // the stall line carries its reason through {detail} — the once-per-episode narration
    const f = new Council().observe(ev("fabricator_stalled", 10, { detail: "no clear ground", gx: 4, gy: 4 }), null, 10);
    expect(f!.line).toContain("no clear ground");
    // a scrapped robot is the Watcher's diagnosis (the engine sends no cause detail)
    const b = new Council().observe(ev("robot_destroyed", 10, { gx: 4, gy: 4 }), null, 10);
    expect(b!.register).toBe("watcher");
    expect(b!.line.toLowerCase()).toContain("strike"); // the default cause
  });
});

describe("the dry register guard", () => {
  it("every scripted line is a single line of 140 chars or fewer after placeholder stripping", () => {
    const all: string[] = [...bootLines(), ...bootLines("easy"), ...bootLines("hard")];
    for (const bank of Object.values(LINES)) {
      if (!bank) continue;
      if (Array.isArray(bank)) all.push(...bank);
      else all.push(...Object.values(bank).flat());
    }
    expect(all.length).toBeGreaterThan(40); // the banks actually loaded
    for (const line of all) {
      const stripped = line.replace(/\{[a-z]+\}/g, "");
      expect(stripped.length, line).toBeLessThanOrEqual(140);
      expect(line, line).not.toContain("\n");
    }
  });
});
