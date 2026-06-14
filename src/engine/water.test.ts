/* ============================================================================
   Water-tech + resupply tick mechanics — the Water Reclaimer pass, the adaptive
   resupply basket, and the resupply_done banked-total event. All deterministic
   (doc §0): the reclaim pass and the basket take ZERO rng draws — pure arithmetic
   over the resolved pool/flow state. (The AWG, aquifer terrain, and well-placement
   tests live in generation.test.ts; this file owns the tick passes.)
   ============================================================================ */
import { describe, it, expect } from "vitest";
import type { ColonyEvent, Resource } from "@shared/types";
import { RESOURCES } from "@shared/types";
import { Colony, DEFS } from "./index";
import type { ColonyState } from "./state";
import { PERSON, RESUPPLY_AMOUNT, RESUPPLY_WINDOW } from "./tuning";

/** advance a colony, collecting events */
function run(c: Colony, seconds: number, step = 0.2): ColonyEvent[] {
  const events: ColonyEvent[] = [];
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) { c.tick(step); events.push(...c.drainEvents()); }
  return events;
}

/** reach the engine's private state (the suite's seam for injecting/inspecting) */
const stateOf = (c: Colony): ColonyState => (c as unknown as { s: ColonyState }).s;

/** a colony with a controlled surface: deposits cleared, every scheduled visitor +
 *  resupply pushed past the horizon — so the pools and flows under test have
 *  exactly one writer (mirrors generation.test.ts) */
function controlled(seed: number): { c: Colony; s: ColonyState } {
  const c = new Colony(seed);
  const s = stateOf(c);
  s.deposits = [];
  s.depositRespawn = 1e9;
  s.nextTrade = 1e9;
  s.nextUfo = 1e9;
  s.nextHazard = 1e9;
  s.nextArrival = 1e9;
  s.nextBirth = 1e9;
  s.nextResupply = 1e9;
  s.unlocked.push("reclaimer", "awg", "aquifer");
  return { c, s };
}

// ---- the Water Reclaimer (one pure tick pass) -------------------------------

/** a minimal SEALED rig in a cleared field: a hub at (4,4) plus units placed
 *  adjacent to it (so connectivity attaches the pressure buildings — manual
 *  `b.connected` is overwritten by recomputeConnectivity each tick). Cells
 *  (6,4) and (6,5) abut the hub's east edge; reclaimers go further out on
 *  corridors. Returns the state after one 0.2s tick. */
function rig(seed: number, opts: {
  units: { def: string; gx: number; gy: number }[];
  pop?: number; power?: number; water?: number; waterCap?: number; tod?: number;
}): ColonyState {
  const c = new Colony(seed);
  const s = stateOf(c);
  s.deposits = []; s.depositRespawn = 1e9; s.nextTrade = 1e9; s.nextUfo = 1e9;
  s.nextHazard = 1e9; s.nextArrival = 1e9; s.nextBirth = 1e9; s.nextResupply = 1e9;
  s.unlocked.push("reclaimer", "awg", "aquifer");
  s.buildings = []; s.grid.fill(0);
  s.materials.amount = 9999; // afford whatever the rig places
  expect(c.place("hub", 4, 4, 0)).toBe(true);
  for (const u of opts.units) expect(c.place(u.def, u.gx, u.gy, 0)).toBe(true);
  s.population = opts.pop ?? 4;
  s.housing = 999; // labor isn't housing-gated here; staffing reads s.labor
  s.pools.power.amount = opts.power ?? 200;
  s.pools.water.amount = opts.water ?? 30;
  if (opts.waterCap !== undefined) s.pools.water.capacity = opts.waterCap;
  s.tod = opts.tod ?? 0.5;
  c.tick(0.2); c.drainEvents();
  return s;
}

describe("Water Reclaimer — returns a fraction of the colony's water draw", () => {
  it("with no sinks present it contributes nothing (can't bootstrap from empty)", () => {
    // nothing draws water this tick (no crew, no water-consuming recipe), so the
    // reclaim pass's `waterSunk > 0` guard short-circuits — water flow is flat at 0.
    // (The reclaimer is unstaffed at pop 0, which only reinforces the point: with
    // no sink there is nothing to recover either way.)
    const s = rig(11, { units: [{ def: "reclaimer", gx: 6, gy: 4 }], pop: 0, water: 20 });
    const rcl = s.buildings.find((b) => b.defId === "reclaimer")!;
    expect(rcl.connected).toBe(true);
    expect(s.flow.water).toBeCloseTo(0, 9); // no draw → reclaim adds nothing
    expect(s.pools.water.amount).toBeCloseTo(20, 9); // pool untouched
  });

  it("an online reclaimer recovers only its sole sink (the crew) when nothing else draws", () => {
    // staff the reclaimer with one colonist (its only labor) — that colonist's own
    // water demand is then the ONLY sink, so the reclaim is exactly frac × crew draw:
    // a tiny amount that scales straight down with the sink, never a flat bonus.
    const s = rig(13, { units: [{ def: "reclaimer", gx: 6, gy: 4 }], pop: 1, water: 30 });
    const rcl = s.buildings.find((b) => b.defId === "reclaimer")!;
    expect(rcl.online).toBe(true);
    const crew = PERSON.water * 1;
    // net.water = reclaim − crew draw; isolate the reclaim contribution
    expect(s.flow.water + crew).toBeCloseTo(DEFS.reclaimer.reclaim!.frac * crew, 6);
  });

  it("returns frac × the water sunk this tick, isolated as a with/without delta", () => {
    // electrolysis sinks water; the crew sinks water; the reclaimer hands a slice
    // back. Measure its contribution as the delta in flow.water (like the reactor
    // test), so the crew/electrolysis draw cancels out of the comparison.
    const base = rig(23, { units: [{ def: "electrolysis", gx: 6, gy: 4 }] });
    const withR = rig(23, { units: [
      { def: "electrolysis", gx: 6, gy: 4 },
      { def: "reclaimer", gx: 6, gy: 5 },
    ] });
    const elec = withR.buildings.find((b) => b.defId === "electrolysis")!;
    const rcl = withR.buildings.find((b) => b.defId === "reclaimer")!;
    expect(elec.online).toBe(true); // the sink is actually running
    expect(rcl.online).toBe(true);  // and so is the reclaimer
    // gross water sunk per second = crew demand + electrolysis recipe draw
    const sunk = PERSON.water * 4 + DEFS.electrolysis.consumes.water!;
    const expected = DEFS.reclaimer.reclaim!.frac * sunk; // one reclaimer, well under max
    expect(withR.flow.water - base.flow.water).toBeCloseTo(expected, 6);
  });

  it("never returns more than reclaim.max per building (the per-unit ceiling)", () => {
    // a huge crew draw makes frac × sunk dwarf the per-unit ceiling, so the cap binds
    const s = rig(29, {
      units: [{ def: "reclaimer", gx: 6, gy: 4 }],
      pop: 200,            // 0.16 × 200 = 32 water/s sunk — frac 0.45 × 32 = 14.4 ≫ max 2.5
      water: 9999, waterCap: 1e6, // never clamp the crew draw or the reclaim add-back
    });
    const rcl = s.buildings.find((b) => b.defId === "reclaimer")!;
    expect(rcl.online).toBe(true);
    // net.water = reclaim − crew; add the crew draw back out to isolate the reclaim
    const crew = PERSON.water * 200;
    expect(s.flow.water + crew).toBeCloseTo(DEFS.reclaimer.reclaim!.max, 6); // capped
  });

  it("splits the captured fraction across multiple reclaimers (÷ nReclaimers)", () => {
    // two reclaimers each get frac×sunk/2; together they recover the same frac×sunk
    // a single one would — until the per-unit max binds. The draw is small, so it
    // doesn't, and the combined contribution equals one reclaimer's whole slice.
    // all units abut the hub seal so each reclaimer connects (a reclaimer is not a
    // conduit, so it can't extend the seal to a further-out neighbour)
    const sink = { def: "electrolysis", gx: 6, gy: 4 };
    const zero = rig(31, { units: [sink] });
    const one = rig(31, { units: [sink, { def: "reclaimer", gx: 6, gy: 5 }] });
    const two = rig(31, { units: [
      sink,
      { def: "reclaimer", gx: 6, gy: 5 },
      { def: "reclaimer", gx: 4, gy: 6 },
    ] });
    expect(one.buildings.filter((b) => b.defId === "reclaimer").every((b) => b.online)).toBe(true);
    expect(two.buildings.filter((b) => b.defId === "reclaimer").every((b) => b.online)).toBe(true);
    const oneGain = one.flow.water - zero.flow.water;
    const twoGain = two.flow.water - zero.flow.water;
    expect(twoGain).toBeCloseTo(oneGain, 6); // same total whether 1 unit or 2 splitting it
    const sunk = PERSON.water * 4 + DEFS.electrolysis.consumes.water!;
    expect(twoGain).toBeCloseTo(DEFS.reclaimer.reclaim!.frac * sunk, 6);
  });

  it("an offline reclaimer (no power) reclaims nothing", () => {
    // night + an empty battery → neither machine runs; the only water draw is the
    // crew, and the offline reclaimer adds nothing back
    const s = rig(37, {
      units: [{ def: "electrolysis", gx: 6, gy: 4 }, { def: "reclaimer", gx: 6, gy: 5 }],
      power: 0, tod: 0.9,
    });
    const rcl = s.buildings.find((b) => b.defId === "reclaimer")!;
    expect(rcl.online).toBe(false);
    expect(s.flow.water).toBeCloseTo(-PERSON.water * 4, 6);
  });
});

describe("Water Reclaimer — cannot fabricate water from a dry pool (regression)", () => {
  it("a colony with no water source still dies of thirst while a reclaimer runs", () => {
    // The bug: pass 5 banked the full REQUESTED crew demand into waterSunk even after
    // takePool clamped the actual draw at 0, so an ONLINE reclaimer refilled a dry pool
    // to a fixed ~0.06 every tick — the shortfall (<=0.001) never tripped, the grace
    // timer never started, and water casualties became impossible. Strip the only water
    // SOURCE, keep the crew + a running reclaimer, and assert the colony still dies.
    const c = new Colony(73);
    const s = stateOf(c);
    s.deposits = []; s.depositRespawn = 1e9; s.nextTrade = 1e9; s.nextUfo = 1e9;
    s.nextHazard = 1e9; s.nextArrival = 1e9; s.nextBirth = 1e9; s.nextResupply = 1e9;
    s.unlocked.push("reclaimer");
    s.buildings = []; s.grid.fill(0);
    s.materials.amount = 9999;
    expect(c.place("hub", 4, 4, 0)).toBe(true);
    expect(c.place("reclaimer", 6, 4, 0)).toBe(true); // abuts the hub east edge → sealed (mirrors rig)
    s.population = 4;
    s.housing = 999;
    s.pools.power.amount = 1e6; s.pools.power.capacity = 1e6; // never browns out → stays online
    s.pools.water.amount = 1.0; s.pools.water.capacity = 100;
    c.tick(0.2); c.drainEvents();
    const rcl = s.buildings.find((b) => b.defId === "reclaimer")!;
    expect(rcl.online).toBe(true); // the reclaimer IS running (the bug only bites when it is)
    let sawCrit = false, sawCasualty = false;
    for (const e of run(c, 100)) {
      if (e.type === "crit_start" && e.res === "water") sawCrit = true;
      if (e.type === "casualty" && e.res === "water") sawCasualty = true;
    }
    expect(sawCrit).toBe(true);      // the pool actually hit empty (the reclaimer can't mask it)
    expect(sawCasualty).toBe(true);  // and the colony paid for it
  });
});

// ---- the adaptive resupply basket -------------------------------------------

/** open a resupply window right now with a fresh banked accumulator (mirrors the
 *  tick's open branch) and return the colony mid-window */
function openWindow(seed: number, fills: Partial<Record<Resource, number>>): { c: Colony; s: ColonyState } {
  const { c, s } = controlled(seed);
  // set each pool's fill fraction (amount = fill × capacity); leave others mid
  for (const k of RESOURCES) {
    const f = fills[k] ?? 0.5;
    s.pools[k].amount = f * s.pools[k].capacity;
  }
  // schedule a window to open on the very next tick
  s.nextResupply = 0.0001;
  return { c, s };
}

describe("adaptive resupply basket — weighted toward the most-depleted pool", () => {
  it("delivers more of the emptiest resource than the existing flat basket would", () => {
    // water bone-dry, everything else comfortable: the basket must lean water
    const { c, s } = openWindow(101, { water: 0.0, power: 0.9, oxygen: 0.9, food: 0.9 });
    // give every pool huge headroom so nothing clamps — we measure the intended
    // allocation, not capacity venting
    for (const k of RESOURCES) s.pools[k].capacity = 1e6;
    for (const k of RESOURCES) s.pools[k].amount = (k === "water" ? 0 : 0.9e6);
    s.population = 0; // no crew draw to muddy the delta
    s.nextHazard = 1e9;
    // open the window
    c.tick(0.2); c.drainEvents();
    // basket allocation for the window is stored on state; water must out-weigh its
    // flat share, and the flush pools must under-weigh theirs
    const basket = (s as unknown as { resupplyBasket: Record<Resource, number> }).resupplyBasket;
    expect(basket.water).toBeGreaterThan(RESUPPLY_AMOUNT.water);
    expect(basket.power).toBeLessThan(RESUPPLY_AMOUNT.power);
    // it stays a BASKET, not an all-to-one dump: the flush pools still get some
    expect(basket.power).toBeGreaterThan(0);
    expect(basket.oxygen).toBeGreaterThan(0);
    expect(basket.food).toBeGreaterThan(0);
  });

  it("conserves the total basket mass (redistributes, never inflates)", () => {
    const { c, s } = openWindow(103, { water: 0.1, power: 0.8, oxygen: 0.4, food: 0.95 });
    for (const k of RESOURCES) s.pools[k].capacity = 1e6;
    c.tick(0.2); c.drainEvents();
    const basket = (s as unknown as { resupplyBasket: Record<Resource, number> }).resupplyBasket;
    const total = RESOURCES.reduce((a, k) => a + basket[k], 0);
    const flatTotal = RESOURCES.reduce((a, k) => a + RESUPPLY_AMOUNT[k], 0);
    expect(total).toBeCloseTo(flatTotal, 6); // same mass, just steered
  });
});

// ---- banked totals + resupply_done ------------------------------------------

/** the basket on state (cleared at window close, so capture it ON the open tick) */
const basketOf = (s: ColonyState): Record<Resource, number> =>
  ({ ...(s as unknown as { resupplyBasket: Record<Resource, number> }).resupplyBasket });
const bankedOf = (s: ColonyState): Record<Resource, number> =>
  ({ ...(s as unknown as { resupplyBanked: Record<Resource, number> }).resupplyBanked });

/** one delivery tick's worth of the whole basket — the float-drift slack a full
 *  window can over/under-deliver by (delivery happens before the resupplyT
 *  decrement, so the closing tick count can drift by one in floating point) */
const tickSlack = (basket: Record<Resource, number>, step = 0.2): number =>
  (RESOURCES.reduce((a, k) => a + basket[k], 0) / RESUPPLY_WINDOW) * step;

describe("resupply_done — fires at window close with the actual banked totals", () => {
  it("emits once when the window closes, carrying per-resource banked amounts", () => {
    const { c, s } = controlled(53);
    // big headroom so the whole basket banks without venting
    for (const k of RESOURCES) { s.pools[k].capacity = 1e6; s.pools[k].amount = 100; }
    s.population = 0;          // no crew draw — banked == delivered
    s.nextResupply = 0.0001;   // open next tick
    // tick once to OPEN the window and compute the basket, then capture it before
    // the close clears it
    c.tick(0.2);
    let opened = c.drainEvents().some((e) => e.type === "resupply");
    expect(opened).toBe(true);
    const basket = basketOf(s);

    // run the rest of the window; collect the single resupply_done
    let done: ColonyEvent | null = null;
    let doneCount = 0;
    for (const e of run(c, RESUPPLY_WINDOW + 5)) {
      if (e.type === "resupply") opened = true;
      if (e.type === "resupply_done") { done = e; doneCount++; }
    }
    expect(done).not.toBeNull();
    expect(doneCount).toBe(1); // exactly once, at close
    expect(done!.amounts).toBeDefined();
    // with full headroom and no crew, the banked totals match the basket totals
    // (to within one delivery tick's float drift)
    const basketTotal = RESOURCES.reduce((a, k) => a + basket[k], 0);
    const bankedTotal = RESOURCES.reduce((a, k) => a + (done!.amounts![k] ?? 0), 0);
    expect(bankedTotal).toBeCloseTo(basketTotal, -1); // ~within a couple units
    expect(Math.abs(bankedTotal - basketTotal)).toBeLessThan(tickSlack(basket) + 1e-6);
    // per-resource too: each banked total tracks its basket allocation, to within
    // one delivery tick of that resource's own share (the float-drift slack)
    for (const k of RESOURCES) {
      const perResSlack = (basket[k] / RESUPPLY_WINDOW) * 0.2 + 1e-6;
      expect(Math.abs((done!.amounts![k] ?? 0) - basket[k])).toBeLessThan(perResSlack);
    }
    // the accumulator clears after firing (next window starts from zero)
    const banked = bankedOf(s);
    for (const k of RESOURCES) expect(banked[k]).toBeCloseTo(0, 9);
  });

  it("a full pool reports less banked than delivered (overflow vented)", () => {
    // pin power to its cap so the basket's power share clamps away; the report
    // must show power banked < the basket's power allocation. Clear the colony so
    // power is a STATIC full tank — no generators/consumers reopening headroom.
    const { c, s } = controlled(59);
    s.buildings = []; s.grid.fill(0); // nothing generates or draws power
    s.population = 0;                 // no crew draw either
    // generous headroom on the others; power is parked at the brim
    for (const k of RESOURCES) { s.pools[k].capacity = 1e6; s.pools[k].amount = 100; }
    s.pools.power.capacity = 50;
    s.pools.power.amount = 50; // full — any power delivery vents
    s.nextResupply = 0.0001;
    // open the window, capture the basket before close clears it
    c.tick(0.2); c.drainEvents();
    const basket = basketOf(s);
    expect(basket.power).toBeGreaterThan(0); // power WAS allocated a real share

    let done: ColonyEvent | null = null;
    for (const e of run(c, RESUPPLY_WINDOW + 5)) if (e.type === "resupply_done") done = e;
    expect(done).not.toBeNull();
    // the full pool ate almost none of its allocation → banked ≪ basket (vented)
    expect(done!.amounts!.power ?? 0).toBeLessThan(basket.power);
    expect(done!.amounts!.power ?? 0).toBeCloseTo(0, 4); // brim → essentially nothing banked
    // water (had room) banked its full allocation (within a tick's float drift)
    expect(done!.amounts!.water ?? 0).toBeCloseTo(basket.water, -1);
  });
});

// ---- determinism: the new passes take zero rng draws ------------------------

describe("determinism with the water tier + adaptive resupply in play", () => {
  it("two same-seed colonies stay in lockstep through several resupply windows", () => {
    const a = new Colony(24611);
    const b = new Colony(24611);
    // place a reclaimer in both so the new pass actually runs (corridor reaches it)
    for (const col of [a, b]) {
      col.place("corridor", 6, 7);
      col.place("reclaimer", 6, 8);
    }
    const evA = run(a, 700); // past RESUPPLY_FIRST (180) + a couple of gaps (280)
    const evB = run(b, 700);
    expect(evB).toEqual(evA);
    expect(b.snapshot()).toEqual(a.snapshot());
  });

  it("a save mid-window resumes the basket + banked accumulator bit-identically", () => {
    const c = new Colony(8123);
    // advance until a window is open
    for (let i = 0; i < 1200 && c.snapshot().resupplyT <= 0; i++) { c.tick(0.2); c.drainEvents(); }
    expect(c.snapshot().resupplyT).toBeGreaterThan(0); // mid-window
    const d = Colony.load(c.serialize());
    run(c, 60);
    run(d, 60);
    expect(d.snapshot()).toEqual(c.snapshot()); // basket + banked round-tripped
  });
});
