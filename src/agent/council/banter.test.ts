/* ============================================================================
   Idle banter tests — the council fills long quiet stretches with severity-0
   colour, WITHOUT ever touching the real event gates. The scheduler is pure
   given an injected rand, so every window here is pinned. Critically: banter
   marks only its own idle state — a real event arriving one second after a
   banter line must pass the regular cooldowns untouched, and banter itself is
   suppressed the moment anything real is happening (hazards, lethal timers,
   trade, the UFO, pause, the campaign ending).
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { ColonyEvent, Snapshot } from "@shared/types";
import { Council, type Candidate, type Register } from "./index";

// ---- fixtures ----------------------------------------------------------------

function pool(amount = 50, capacity = 100) {
  return { amount, capacity };
}

/** a quiet, healthy colony — every suppression axis off by default */
function makeSnap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    N: 15,
    buildings: [],
    pools: { power: pool(), water: pool(), oxygen: pool(), food: pool() },
    flow: { power: 0, water: 0, oxygen: 0, food: 0 },
    materials: pool(10, 60),
    colonists: [],
    deposits: [],
    vents: [],
    aquifers: [],
    rovers: [],
    robots: [],
    depot: { gx: 8, gy: 6 },
    possessed: null,
    trade: null,
    ufo: null,
    acquiredTech: [],
    population: 4,
    housing: 6,
    labor: 4,
    laborUsed: 2,
    sol: 3,
    tod: 0.5,
    solLength: 120,
    weather: "clear",
    stormT: 0,
    solarMul: 1,
    windLevel: 0,
    unlocks: {},
    hazards: [],
    directorControlled: false,
    nextResupply: 100,
    resupplyT: 0,
    timers: { oxygen: null, water: null, food: null },
    grace: 25,
    dead: 0,
    morale: 0.9,
    difficulty: "normal",
    deadlineSol: 30,
    targetPop: 12,
    selfSufficientFor: 0,
    selfSufficiencyGoal: 240,
    outcome: null,
    outcomeReason: "",
    paused: false,
    speed: 1,
    t: 100,
    started: true,
    ...over,
  };
}

function ev(type: ColonyEvent["type"], t: number, extra: Partial<ColonyEvent> = {}): ColonyEvent {
  return { type, t, sol: 1, tod: 0.3, ...extra };
}

function cand(register: Register): Candidate {
  return { register, speaker: register.toUpperCase(), line: "x", severity: 0, persona: register };
}

// ---- the quiet predicate -------------------------------------------------------

describe("idle banter — the quiet predicate", () => {
  it("stays silent before the idle gap has elapsed", () => {
    const c = new Council(() => 0); // gap pinned to the 25s floor
    expect(c.observeIdle(makeSnap(), 10, 0)).toBeNull();
    expect(c.observeIdle(makeSnap(), 24.9, 0)).toBeNull();
  });

  it("speaks once the injected-rand gap (25–40) has elapsed", () => {
    const lo = new Council(() => 0); // 25
    expect(lo.observeIdle(makeSnap(), 25, 0)).toBeTruthy();
    const hi = new Council(() => 1); // 40
    expect(hi.observeIdle(makeSnap(), 39.9, 0)).toBeNull();
    expect(hi.observeIdle(makeSnap(), 40, 0)).toBeTruthy();
    const mid = new Council(() => 0.5); // 32.5
    expect(mid.observeIdle(makeSnap(), 32.4, 0)).toBeNull();
    expect(mid.observeIdle(makeSnap(), 32.5, 0)).toBeTruthy();
  });

  it("measures the quiet from the last REAL event", () => {
    const c = new Council(() => 0);
    expect(c.observeIdle(makeSnap(), 100, 90)).toBeNull(); // something real 10s ago
    expect(c.observeIdle(makeSnap(), 115, 90)).toBeTruthy();
  });

  it("is suppressed during hazards, lethal timers, trade, the UFO, pause, and after the end", () => {
    const c = new Council(() => 0);
    const t = 100;
    const hazard = { kind: "dust" as const, phase: "telegraph" as const, intensity: 0.5, remaining: 10 };
    const trade = {
      id: 1, phase: "landed" as const, give: { res: "water" as const, amount: 10 },
      take: { res: "food" as const, amount: 5 }, deadline: 20, gx: 3, gy: 3,
    };
    const ufo = { id: 1, phase: "inbound" as const, targetId: 2, gx: 5, gy: 5 };
    expect(c.observeIdle(makeSnap({ hazards: [hazard] }), t, 0)).toBeNull();
    expect(c.observeIdle(makeSnap({ timers: { oxygen: 12, water: null, food: null } }), t, 0)).toBeNull();
    expect(c.observeIdle(makeSnap({ trade }), t, 0)).toBeNull();
    expect(c.observeIdle(makeSnap({ ufo }), t, 0)).toBeNull();
    expect(c.observeIdle(makeSnap({ paused: true }), t, 0)).toBeNull();
    expect(c.observeIdle(makeSnap({ outcome: "victory" }), t, 0)).toBeNull();
    // control: the same clock with a genuinely quiet colony does speak
    expect(c.observeIdle(makeSnap(), t, 0)).toBeTruthy();
  });
});

// ---- rotation + the idle-only cooldowns ------------------------------------------

describe("idle banter — rotation and cooldowns", () => {
  it("rotates the starting voice so all four members banter over successive lines", () => {
    const c = new Council(() => 0);
    const seen: string[] = [];
    for (let i = 1; i <= 4; i++) {
      const u = c.observeIdle(makeSnap(), i * 25, 0);
      expect(u, `banter #${i}`).toBeTruthy();
      seen.push(u!.register);
    }
    expect(new Set(seen).size).toBe(4); // no voice dominates the severity-0 tie
  });

  it("honors the 90s per-voice idle cooldown — skips cooling voices, silent when all cool", () => {
    const c = new Council(() => 0);
    c.markIdle(cand("vivarium"), 0);
    c.markIdle(cand("watcher"), 1);
    expect(c.observeIdle(makeSnap(), 26, 0)?.register).toBe("strategist"); // viv+watcher inside 90s
    expect(c.observeIdle(makeSnap(), 51, 0)?.register).toBe("chronicler");
    expect(c.observeIdle(makeSnap(), 76, 0)).toBeNull(); // every voice inside its window
    expect(c.observeIdle(makeSnap(), 91, 0)?.register).toBe("vivarium"); // first one back out
  });

  it("banter marks ONLY idle state — a sev-1 real event right after banter passes untouched", () => {
    const c = new Council(() => 0);
    const u = c.observeIdle(makeSnap(), 25, 0);
    expect(u).toBeTruthy();
    expect(u!.register).toBe("vivarium");
    // one second later, an ordinary dawn (sev 1, also vivarium) must speak: banter
    // must not have set lastGlobal, the voice cooldown, or any topic cooldown.
    const real = c.observe(ev("dawn", 26), makeSnap({ t: 26 }), 26);
    expect(real).toBeTruthy();
    expect(real!.register).toBe("vivarium");
  });

  it("reset clears the idle state (rotation, per-voice clocks, the gap)", () => {
    const c = new Council(() => 0);
    expect(c.observeIdle(makeSnap(), 25, 0)?.register).toBe("vivarium");
    c.reset();
    // vivarium spoke 0.1s ago in wall terms — but reset wiped the idle books,
    // so the rotation restarts at vivarium and its 90s clock is gone
    expect(c.observeIdle(makeSnap(), 25, 0)?.register).toBe("vivarium");
  });
});

// ---- voice content ------------------------------------------------------------

describe("idle banter — voice content", () => {
  it("the Watcher names the tightest margin when one exists, and distrusts the calm otherwise", () => {
    // rotate the council until the watcher's turn comes up, on a draining colony
    const draining = makeSnap({
      flow: { power: 0, water: -0.5, oxygen: 0, food: 0 },
      pools: { power: pool(), water: pool(40), oxygen: pool(), food: pool() },
    });
    const c = new Council(() => 0);
    expect(c.observeIdle(draining, 25, 0)?.register).toBe("vivarium");
    const margin = c.observeIdle(draining, 50, 0);
    expect(margin?.register).toBe("watcher");
    expect(margin!.line.toLowerCase()).toContain("water"); // names the tightest margin
    const c2 = new Council(() => 0);
    expect(c2.observeIdle(makeSnap(), 25, 0)?.register).toBe("vivarium");
    const calm = c2.observeIdle(makeSnap(), 50, 0);
    expect(calm?.register).toBe("watcher");
    expect(calm!.line.toLowerCase()).not.toContain("water"); // the distrust-the-calm variant
  });

  it("the Strategist reuses its bottleneck advice when its diagnosis finds one", () => {
    // an empty colony diagnoses "battery" — the existing SCRIPTS bank fires
    const c = new Council(() => 0);
    c.markIdle(cand("vivarium"), 0);
    c.markIdle(cand("watcher"), 1);
    const u = c.observeIdle(makeSnap(), 26, 0);
    expect(u?.register).toBe("strategist");
    expect(u!.line.toLowerCase()).toContain("battery");
  });
});
