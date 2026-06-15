/* ============================================================================
   Carried legacy (PTP slice 5) — a launch carries a couple of veteran colonists
   (by literal id, so name + role + commander-rank are preserved) and one alien
   tech into the next run. Applied as plain seed state in seedColony: zero rng,
   and colonistCounter is bumped past the veterans so no later mint collides.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "./index";
import { nameOf, roleOf } from "./roster";
import type { ColonyState } from "./state";

const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

describe("carried legacy", () => {
  it("seeds veterans at their literal ids, the lowest stays commander, counter clears them", () => {
    const c = new Colony(7);
    c.reset("normal", 999, "ceres", { veterans: [5, 6], tech: "capacitor" });
    const s = stateOf(c);
    const ids = s.colonists.map((x) => x.id).sort((a, b) => a - b);
    expect(ids).toContain(5);
    expect(ids).toContain(6);
    expect(Math.min(...ids)).toBe(5); // the lowest veteran is the new commander
    expect(s.colonists).toHaveLength(s.population); // veterans + fresh recruits == population
    expect(s.colonistCounter).toBeGreaterThan(6); // past the veterans → next mint can't dup
  });

  it("a veteran keeps the SAME name + role it had on the old world (identity is the id)", () => {
    const c = new Colony(1);
    c.reset("normal", 42, "io", { veterans: [9] });
    const vet = stateOf(c).colonists.find((x) => x.id === 9)!;
    expect(vet).toBeTruthy();
    // name/role are pure id hashes — the same person, recognizably
    expect(nameOf(9)).toBe(nameOf(9));
    expect(roleOf(vet.id)).toBe(roleOf(9));
  });

  it("carries one alien tech into acquiredTech", () => {
    const c = new Colony(3);
    c.reset("normal", 7, "titan", { veterans: [], tech: "fusioncell" });
    expect(stateOf(c).acquiredTech).toContain("fusioncell");
  });

  it("no legacy → the default four colonists at ids 1-4 (unchanged)", () => {
    const c = new Colony(11);
    c.reset("normal", 5, "mars");
    const ids = stateOf(c).colonists.map((x) => x.id).sort((a, b) => a - b);
    expect(ids).toEqual([1, 2, 3, 4]);
  });

  it("a later mint after carrying veterans never collides with a veteran id", () => {
    const c = new Colony(2);
    c.reset("normal", 8, "ceres", { veterans: [5, 6] });
    const s = stateOf(c);
    // simulate a birth/arrival minting from the counter
    const minted = s.colonistCounter;
    expect(minted).toBeGreaterThan(6);
    expect(s.colonists.some((x) => x.id === minted)).toBe(false); // free id
  });
});
