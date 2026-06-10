/* ============================================================================
   The colonist roster — names + roles are PURE derivations of the colonist id
   (zero RNG draws), assignment prefers role-matched buildings, and matched
   staffing boosts produces (never consumes). Determinism stays byte-identical.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { ColonyEvent, ColonistRole } from "@shared/types";
import { Colony, DEFS, Tuning } from "./index";
import { ROLE_BUILDING, nameOf, roleOf } from "./roster";
import type { ColonyState } from "./state";

/** advance a colony, collecting events */
function run(c: Colony, seconds: number, step = 0.2): ColonyEvent[] {
  const events: ColonyEvent[] = [];
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) { c.tick(step); events.push(...c.drainEvents()); }
  return events;
}

/** reach the engine's private state (the suite's seam for injecting/inspecting) */
const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

describe("roleOf / nameOf — pure id derivations, no RNG", () => {
  it("is stable: the same id always yields the same name and role", () => {
    expect(roleOf(7)).toBe(roleOf(7));
    expect(nameOf(7)).toBe(nameOf(7));
    expect(nameOf(7)).toMatch(/^\S+ \S+$/); // "First Last"
  });

  it("the seed crew (ids 1-4) covers all four roles", () => {
    expect(roleOf(1)).toBe("miner");
    expect(roleOf(2)).toBe("engineer");
    expect(roleOf(3)).toBe("botanist");
    expect(roleOf(4)).toBe("medic");
    expect(new Set([1, 2, 3, 4].map(roleOf)).size).toBe(4);
  });

  it("the seed miner + engineer match the starter extractor + electrolysis", () => {
    expect(ROLE_BUILDING[roleOf(1)]).toBe("extractor");
    expect(ROLE_BUILDING[roleOf(2)]).toBe("electrolysis");
  });

  it("names are unique across 30 consecutive ids", () => {
    const names = Array.from({ length: 30 }, (_, i) => nameOf(i + 1));
    expect(new Set(names).size).toBe(30);
  });
});

describe("the snapshot carries the roster", () => {
  it("every colonist view has its derived name and role", () => {
    const snap = new Colony().snapshot();
    expect(snap.colonists.length).toBe(4);
    for (const v of snap.colonists) {
      expect(v.name).toBe(nameOf(v.id));
      expect(v.role).toBe(roleOf(v.id));
    }
  });
});

describe("assignment prefers role-matched colonists", () => {
  it("the miner holds an extractor's workUid after a tick; leftovers backfill in id order", () => {
    const c = new Colony(7);
    expect(c.place("extractor", 1, 1)).toBe(true); // a second extractor slot
    run(c, 0.4); // assign() runs inside the tick

    const s = stateOf(c);
    const byRole = (r: ColonistRole) => s.colonists.find((k) => roleOf(k.id) === r)!;
    const defOf = (uid: number | null) => s.buildings.find((b) => b.uid === uid)?.defId;

    expect(defOf(byRole("miner").workUid)).toBe("extractor");
    expect(defOf(byRole("engineer").workUid)).toBe("electrolysis");
    // no second miner exists — pass 2 backfills the spare extractor by id order
    expect(defOf(byRole("botanist").workUid)).toBe("extractor");
    // the medic's building doesn't exist yet — surplus idles
    expect(byRole("medic").workUid).toBeNull();
  });
});

describe("role-matched staffing boosts production", () => {
  /** one tick of water flow with a chosen colonist holding the extractor slot —
   *  the arrangement is constructed directly; pass 4 reads it before assign()
   *  reshuffles at the tail of the same tick */
  function waterFlowWith(extWorkerId: number): number {
    const c = new Colony(31337);
    const s = stateOf(c);
    const ext = s.buildings.find((b) => b.defId === "extractor")!;
    const elec = s.buildings.find((b) => b.defId === "electrolysis")!;
    for (const k of s.colonists) k.workUid = null;
    s.colonists.find((k) => k.id === extWorkerId)!.workUid = ext.uid;
    s.colonists.find((k) => k.id === 2)!.workUid = elec.uid; // engineer — same in both arrangements
    c.tick(0.2);
    return c.snapshot().flow.water;
  }

  it("a miner on the extractor out-produces a botanist on it by exactly the bonus", () => {
    const matched = waterFlowWith(1);    // id 1 — miner
    const mismatched = waterFlowWith(3); // id 3 — botanist
    expect(matched - mismatched).toBeCloseTo(DEFS.extractor.produces.water! * Tuning.ROLE_BONUS, 5);
  });

  /** one tick of flow with a chosen colonist holding the electrolysis slot —
   *  the miner stays on the extractor in both arrangements */
  function flowWithElecWorker(elecWorkerId: number): Record<string, number> {
    const c = new Colony(31337);
    const s = stateOf(c);
    const ext = s.buildings.find((b) => b.defId === "extractor")!;
    const elec = s.buildings.find((b) => b.defId === "electrolysis")!;
    for (const k of s.colonists) k.workUid = null;
    s.colonists.find((k) => k.id === 1)!.workUid = ext.uid; // miner — same in both arrangements
    s.colonists.find((k) => k.id === elecWorkerId)!.workUid = elec.uid;
    c.tick(0.2);
    return c.snapshot().flow;
  }

  it("the bonus scales produces only — consumes never (water flow is identical)", () => {
    const matched = flowWithElecWorker(2);    // id 2 — engineer
    const mismatched = flowWithElecWorker(4); // id 4 — medic
    expect(matched.oxygen - mismatched.oxygen)
      .toBeCloseTo(DEFS.electrolysis.produces.oxygen! * Tuning.ROLE_BONUS, 5);
    // electrolysis consumes water — an eff leak into consumes splits these apart
    expect(matched.water).toBe(mismatched.water);
  });
});

describe("determinism with the roster in play", () => {
  it("two same-seed colonies stay identical over 600s", () => {
    const a = new Colony(20260610);
    const b = new Colony(20260610);
    run(a, 600);
    run(b, 600);
    expect(a.snapshot()).toEqual(b.snapshot());
  });
});
