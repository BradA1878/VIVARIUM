/* ============================================================================
   Embodied-layer tests — the colonist roster, possession + moveIntent piloting,
   mining → carry, hauling → unload, the materials gate on construction, and the
   alien trade swap. All deterministic: the engine integrates moveIntent purely,
   so we drive closed-loop intents from the latest snapshot and assert outcomes.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "./index";
import type { ColonyEvent, Snapshot, Resource } from "@shared/types";

/** advance a colony by `seconds` in fixed `step`s, collecting events */
function run(c: Colony, seconds: number, step = 0.2): ColonyEvent[] {
  const events: ColonyEvent[] = [];
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    c.tick(step);
    events.push(...c.drainEvents());
  }
  return events;
}

/** read a tradeable resource's amount off a snapshot (materials is its own pool) */
function amountOf(snap: Snapshot, res: Resource | "materials"): number {
  return res === "materials" ? snap.materials.amount : snap.pools[res].amount;
}

describe("colonist roster", () => {
  it("tracks population and is part of the deterministic state", () => {
    const c = new Colony();
    const s = c.snapshot();
    expect(s.colonists.length).toBe(s.population);
    expect(s.population).toBe(4);
  });

  it("two same-seed colonies produce identical colonist arrays after a long run", () => {
    const a = new Colony(12345);
    const b = new Colony(12345);
    run(a, 120);
    run(b, 120);
    expect(a.snapshot().colonists).toEqual(b.snapshot().colonists);
  });
});

describe("possession + moveIntent", () => {
  it("moves the possessed colonist, stays in bounds, and release clears possession", () => {
    const c = new Colony(7);
    const id = c.snapshot().colonists[0].id;
    c.possess(id);
    expect(c.snapshot().possessed).toBe(id);

    const startX = c.snapshot().colonists.find((k) => k.id === id)!.x;
    c.setMoveIntent(1, 0); // drive east
    run(c, 2, 0.1);

    const me = c.snapshot().colonists.find((k) => k.id === id)!;
    const N = c.snapshot().N;
    // ~2.6 cells/s for ~2s, but clamped to grid; assert a meaningful eastward move
    expect(me.x).toBeGreaterThan(startX + 1);
    expect(me.x).toBeGreaterThanOrEqual(0);
    expect(me.x).toBeLessThanOrEqual(N - 1);
    expect(me.possessed).toBe(true);

    c.possess(null);
    expect(c.snapshot().possessed).toBe(null);
    expect(c.snapshot().colonists.find((k) => k.id === id)!.possessed).toBe(false);
  });

  it("an identical possess+intent+tick sequence lands at the same position", () => {
    const drive = (c: Colony): { x: number; y: number } => {
      const id = c.snapshot().colonists[0].id;
      c.possess(id);
      c.setMoveIntent(1, 0);
      run(c, 1.5, 0.1);
      c.setMoveIntent(0, 1);
      run(c, 1.5, 0.1);
      const me = c.snapshot().colonists.find((k) => k.id === id)!;
      return { x: me.x, y: me.y };
    };
    expect(drive(new Colony(99))).toEqual(drive(new Colony(99)));
  });
});

describe("mining", () => {
  it("walks to a deposit, presses P to pick up a load, depleting it", () => {
    const c = new Colony(7);
    const id = c.snapshot().colonists[0].id;
    c.possess(id);

    const dep0 = c.snapshot().deposits[0];
    const depId = dep0.id;
    const depMax = dep0.max;

    // steer toward the deposit each tick until in pickup range, then press P
    let inRange = false;
    for (let i = 0; i < 800; i++) {
      const snap = c.snapshot();
      const dep = snap.deposits.find((d) => d.id === depId);
      const me = snap.colonists.find((k) => k.id === id)!;
      if (!dep) break;
      const dx = dep.gx - me.x;
      const dy = dep.gy - me.y;
      if (Math.hypot(dx, dy) <= 1.1) { inRange = true; break; }
      c.setMoveIntent(Math.sign(dx), Math.sign(dy));
      c.tick(0.1);
      c.drainEvents();
    }
    expect(inRange).toBe(true);

    c.setMoveIntent(0, 0);
    c.interact(); // press P → grab a load

    const after = c.snapshot();
    const me = after.colonists.find((k) => k.id === id)!;
    const dep = after.deposits.find((d) => d.id === depId);

    expect(me.carryAmt).toBeGreaterThan(0);
    // the deposit either shrank below its max, or was fully mined out of the field
    const depleted = dep == null || dep.amount < depMax - 1e-6;
    expect(depleted).toBe(true);
  });
});

describe("hauling", () => {
  it("picks up ore, carries it to the depot, and presses P to drop it into materials", () => {
    const c = new Colony(7);
    const id = c.snapshot().colonists[0].id;
    c.possess(id);

    // target an ore deposit → drops into materials (big cap, no demand drain → a
    // clean assertion that the pool grew)
    const ore = c.snapshot().deposits.find((d) => d.kind === "ore");
    expect(ore).toBeTruthy();
    const depId = ore!.id;

    // ---- phase 1: reach the ore deposit and press P to pick up ----
    let picked = false;
    for (let i = 0; i < 900; i++) {
      const snap = c.snapshot();
      const me = snap.colonists.find((k) => k.id === id)!;
      const dep = snap.deposits.find((d) => d.id === depId);
      if (!dep) break;
      const dx = dep.gx - me.x, dy = dep.gy - me.y;
      if (Math.hypot(dx, dy) <= 1.1) { c.setMoveIntent(0, 0); c.interact(); picked = true; break; }
      c.setMoveIntent(Math.sign(dx), Math.sign(dy));
      c.tick(0.1);
      c.drainEvents();
    }
    expect(picked).toBe(true);

    const carrying = c.snapshot().colonists.find((k) => k.id === id)!;
    expect(carrying.carryAmt).toBeGreaterThan(0);
    expect(carrying.carryKind).toBe("ore");
    const poolBefore = amountOf(c.snapshot(), "materials");
    const carryBefore = carrying.carryAmt;

    // ---- phase 2: carry to the depot and press P to drop ----
    const depot = c.snapshot().depot;
    let dropped = false;
    for (let i = 0; i < 900; i++) {
      const me = c.snapshot().colonists.find((k) => k.id === id)!;
      const dx = depot.gx - me.x, dy = depot.gy - me.y;
      if (Math.hypot(dx, dy) <= 1.3) { c.setMoveIntent(0, 0); c.interact(); dropped = true; break; }
      c.setMoveIntent(Math.sign(dx), Math.sign(dy));
      c.tick(0.1);
      c.drainEvents();
    }
    expect(dropped).toBe(true);

    const after = c.snapshot();
    const meAfter = after.colonists.find((k) => k.id === id)!;
    expect(meAfter.carryAmt).toBe(0); // dropped the whole load
    expect(amountOf(after, "materials")).toBeCloseTo(poolBefore + carryBefore, 5);
  });
});

describe("materials gate construction", () => {
  it("starts modest, charges placements, and blocks once materials run dry", () => {
    const c = new Colony();
    expect(c.snapshot().materials.amount).toBeCloseTo(90, 0);

    // an empty, in-bounds cell with materials in the bank → placeable
    expect(c.canPlace("hab", 0, 0)).toBe(true);

    const before = c.snapshot().materials.amount;
    expect(c.place("hab", 0, 0)).toBe(true);
    // placing a hab costs 24 materials
    expect(c.snapshot().materials.amount).toBeCloseTo(before - 24, 5);

    // keep building habs on empty cells until the bank can't cover the next one
    const N = c.snapshot().N;
    const used = new Set<string>(["0,0"]);
    let placed = 1;
    for (let gx = 0; gx < N && c.snapshot().materials.amount >= 24; gx++) {
      for (let gy = 0; gy < N && c.snapshot().materials.amount >= 24; gy++) {
        if (used.has(`${gx},${gy}`)) continue;
        if (c.canPlace("hab", gx, gy) && c.place("hab", gx, gy)) {
          used.add(`${gx},${gy}`);
          placed++;
        }
      }
    }
    expect(placed).toBeGreaterThan(1);
    expect(c.snapshot().materials.amount).toBeLessThan(24);

    // find a still-empty, in-bounds cell — it must be rejected purely on materials
    let emptyFound = false;
    outer:
    for (let gx = 0; gx < N; gx++) {
      for (let gy = 0; gy < N; gy++) {
        if (c.buildingAt(gx, gy)) continue;
        // a 1x1 hab fits here (cell is free); only the gate should stop it
        if (c.canPlace("hab", gx, gy) === false) {
          emptyFound = true;
          break outer;
        }
      }
    }
    expect(emptyFound).toBe(true);
  });
});

describe("alien trade", () => {
  /** tick a colony until a trader has landed (or give up); returns the snapshot at land */
  function runToLanded(c: Colony, capSeconds = 200): boolean {
    const step = 0.2;
    for (let i = 0; i < capSeconds / step; i++) {
      c.tick(step);
      c.drainEvents();
      if (c.snapshot().trade?.phase === "landed") return true;
    }
    return false;
  }

  it("accept swaps the pools and fires trade_done", () => {
    // try a few seeds so we hit a landed offer the colony can actually afford
    let done = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const c = new Colony(seed);
      if (!runToLanded(c)) continue;
      const tr = c.snapshot().trade!;
      if (tr.give.res === "tech") continue; // tech offers are covered separately
      const before = c.snapshot();
      const haveTake = amountOf(before, tr.take.res);
      if (haveTake < tr.take.amount) continue; // unaffordable on this seed — try next
      const giveBefore = amountOf(before, tr.give.res);

      c.respondTrade(true);
      const events = [...c.drainEvents()];
      c.tick(0.2);
      events.push(...c.drainEvents());

      const after = c.snapshot();
      // the `take` resource is debited by ~take.amount (allow a tick of drift)
      expect(amountOf(after, tr.take.res)).toBeLessThanOrEqual(haveTake - tr.take.amount + 1);
      // the `give` resource is credited (clamped to capacity)
      expect(amountOf(after, tr.give.res)).toBeGreaterThanOrEqual(giveBefore);
      expect(events.some((e) => e.type === "trade_done")).toBe(true);
      done = true;
      break;
    }
    expect(done).toBe(true);
  });

  it("decline leaves the traded pools intact and never fires trade_done", () => {
    let tested = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const c = new Colony(seed);
      if (!runToLanded(c)) continue;
      const tr = c.snapshot().trade!;
      // a swap would move the give pool by tr.give.amount (>=26) and the take
      // pool by tr.take.amount (>=18); ordinary per-tick demand is a small drift.
      // We capture the give pool BEFORE responding, then prove no jump occurred.
      const giveBefore = tr.give.res === "tech" ? null : amountOf(c.snapshot(), tr.give.res);

      c.respondTrade(false);
      const events = [...c.drainEvents()];
      c.tick(0.2);
      events.push(...c.drainEvents());

      const after = c.snapshot();
      // no swap occurred: the give pool did NOT jump up by the offered amount
      // (it can only have drifted down or held roughly flat over a single tick).
      if (giveBefore != null && tr.give.res !== "tech") {
        expect(amountOf(after, tr.give.res)).toBeLessThan(giveBefore + tr.give.amount / 2);
      }
      // and decisively: no trade_done fired and the offer is leaving, not landed
      expect(events.some((e) => e.type === "trade_done")).toBe(false);
      expect(after.trade?.phase ?? "leaving").not.toBe("landed");
      tested = true;
      break;
    }
    expect(tested).toBe(true);
  });

  it("accepting an alien-tech offer banks the upgrade and applies its effect", () => {
    // hunt across seeds/windows for an affordable landed TECH offer
    let tested = false;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const) {
      const c = new Colony(seed);
      let found = false;
      const step = 0.2;
      for (let i = 0; i < 900 / step; i++) { // a few windows
        c.tick(step); c.drainEvents();
        const t = c.snapshot().trade;
        if (t?.phase === "landed" && t.give.res === "tech") { found = true; break; }
      }
      if (!found) continue;
      const tr = c.snapshot().trade!;
      if (tr.give.res !== "tech") continue;
      const before = c.snapshot();
      if (amountOf(before, tr.take.res) < tr.take.amount) continue; // can't pay — next seed
      const techId = tr.give.tech;
      const powerCapBefore = before.pools.power.capacity;

      c.respondTrade(true);
      const events = [...c.drainEvents()];
      const after = c.snapshot();

      expect(after.acquiredTech).toContain(techId);
      expect(events.some((e) => e.type === "trade_done")).toBe(true);
      // a capacity tech bumps a pool cap immediately; otherwise the tech is at least banked
      if (techId === "capacitor") expect(after.pools.power.capacity).toBeGreaterThan(powerCapBefore);
      tested = true;
      break;
    }
    expect(tested).toBe(true);
  });
});
