/* ============================================================================
   Inter-planet shipments (parallel-colonies slice 7) — the SENDER debits a
   manifest from its own pools in its tick; the RECEIVER credits it as plain
   seed-state (capacity-clamped resources; crew as fresh headcount). Both are
   deterministic + RNG-free, so a colony stays reproducible after a shipment op.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "./index";
import type { ColonyState } from "./state";

const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

describe("shipment debit / credit", () => {
  it("dispatchShipment debits resources, materials, and crew", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    const w0 = s.pools.water.amount, m0 = s.materials.amount, p0 = s.population;
    const sent = c.dispatchShipment({ resources: { water: 10 }, materials: 20, crew: 1 });
    expect(s.pools.water.amount).toBeCloseTo(w0 - 10, 6);
    expect(s.materials.amount).toBeCloseTo(m0 - 20, 6);
    expect(s.population).toBe(p0 - 1);
    expect(s.colonists.length).toBe(p0 - 1);
    expect(sent).toEqual({ resources: { water: 10 }, materials: 20, crew: 1 });
  });

  it("over-request debits and returns only what actually left", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    const water = s.pools.water.amount;
    const materials = s.materials.amount;
    const sent = c.dispatchShipment({ resources: { water: 99999 }, materials: 99999, crew: 99999 });
    expect(s.pools.water.amount).toBe(0);
    expect(s.materials.amount).toBe(0);
    expect(s.population).toBe(0);
    expect(sent).toEqual({ resources: { water }, materials, crew: 4 });
  });

  it("rejects negative and non-finite quantities without mutating the colony", () => {
    const c = new Colony(7);
    const before = c.snapshot();
    const sent = c.dispatchShipment({
      resources: { water: -10, oxygen: Number.NaN, food: Number.POSITIVE_INFINITY },
      materials: -50,
      crew: 1.5,
    });
    expect(sent).toEqual({});
    expect(c.snapshot()).toEqual(before);

    // The receiver is defensive too: malformed external credits cannot debit it.
    c.creditShipment({ resources: { water: -10 }, materials: -10, crew: -1 });
    expect(c.snapshot()).toEqual(before);
  });

  it("creditShipment credits resources (clamped to capacity), materials, and FRESH crew", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.pools.water.amount = 0;
    const p0 = s.population, counter0 = s.colonistCounter;
    c.creditShipment({ resources: { water: 10 }, materials: 5, crew: 2 });
    expect(s.pools.water.amount).toBeCloseTo(10, 6);
    expect(s.population).toBe(p0 + 2);
    expect(s.colonists.length).toBe(p0 + 2);
    const ids = s.colonists.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length); // no id collision
    expect(Math.max(...ids)).toBeGreaterThanOrEqual(counter0); // fresh ids past the counter
  });

  it("resource credit clamps at capacity (full tanks vent the overflow)", () => {
    const c = new Colony(7);
    const s = stateOf(c);
    s.pools.water.amount = s.pools.water.capacity;
    c.creditShipment({ resources: { water: 50 } });
    expect(s.pools.water.amount).toBe(s.pools.water.capacity);
  });

  it("debit + credit are RNG-free — the colony stays deterministic afterward", () => {
    const a = new Colony(7), b = new Colony(7);
    a.dispatchShipment({ resources: { water: 5 }, crew: 1 });
    b.dispatchShipment({ resources: { water: 5 }, crew: 1 });
    a.creditShipment({ materials: 10, crew: 1 });
    b.creditShipment({ materials: 10, crew: 1 });
    for (let i = 0; i < 200; i++) { a.tick(0.2); a.drainEvents(); b.tick(0.2); b.drainEvents(); }
    expect(b.snapshot()).toEqual(a.snapshot()); // same ops → same future
  });
});
