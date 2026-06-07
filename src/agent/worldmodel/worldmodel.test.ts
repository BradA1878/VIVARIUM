/* ============================================================================
   World-model tests — the graph reflects the colony, and the recursive root-cause
   trace walks the cascade down to its environmental origin (doc §3.3).
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "@/engine";
import { buildGraph, diagnoseShortfall, summarizeDiagnosis, risks, producersOf } from "./index";

function run(c: Colony, seconds: number, step = 0.2): void {
  for (let i = 0; i < Math.round(seconds / step); i++) { c.tick(step); c.drainEvents(); }
}

describe("graph construction", () => {
  it("has pool nodes and a feeds edge from electrolysis to oxygen", () => {
    const s = new Colony().snapshot();
    const g = buildGraph(s);
    expect(g.nodes.has("pool:oxygen")).toBe(true);
    const elec = s.buildings.find((b) => b.defId === "electrolysis")!;
    const feeds = g.edges.some((e) => e.from === `b:${elec.uid}` && e.to === "pool:oxygen" && e.kind === "feeds");
    expect(feeds).toBe(true);
  });

  it("producersOf(oxygen) includes electrolysis", () => {
    const s = new Colony().snapshot();
    expect(producersOf(s, "oxygen").some((b) => b.defId === "electrolysis")).toBe(true);
  });
});

describe("root-cause diagnosis traces the cascade", () => {
  it("oxygen failing for lack of water points upstream to water", () => {
    const c = new Colony(7);
    // remove the ice extractor so water drains; electrolysis then starves
    c.removeAt(8, 8);
    run(c, 80); // let water empty and electrolysis go unfed
    const s = c.snapshot();
    const d = diagnoseShortfall(s, "oxygen");
    // electrolysis should be among the failing oxygen producers, starved of water
    const starved = d.failing.find((f) => f.defId === "electrolysis" && f.reason === "starved");
    expect(starved?.starvedOf).toBe("water");
    // and the trace should continue upstream into water
    expect(d.upstream?.resource).toBe("water");
    const phrase = summarizeDiagnosis(d).join(" — ");
    expect(phrase.toLowerCase()).toContain("water");
  });

  it("power shortfall under a storm reads as an environmental cause", () => {
    const c = new Colony(2);
    // strip generation + buffer, then gut the light: power must bottom out and
    // the cause must read environmental (the storm took the light).
    c.removeAt(7, 3); c.removeAt(7, 6); // both solar arrays
    c.removeAt(3, 3); // the battery
    c.forceStorm();
    run(c, 18); // sample mid-storm (storms last ≥26s)
    const s = c.snapshot();
    expect(s.pools.power.amount).toBeLessThan(s.pools.power.capacity * 0.2);
    expect(s.solarMul).toBeLessThan(0.3);
    const d = diagnoseShortfall(s, "power");
    expect(d.environmental).toBe("storm");
  });
});

describe("risk listing", () => {
  it("flags a draining pool with its dependents", () => {
    const c = new Colony(5);
    c.removeAt(5, 7); // electrolysis — oxygen now only drains
    run(c, 50);
    const r = risks(c.snapshot());
    const oxy = r.find((x) => x.resource === "oxygen");
    expect(oxy).toBeTruthy();
    expect(oxy!.dependents).toContain("the colonists");
  });
});
