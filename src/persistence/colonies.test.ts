/* ============================================================================
   The Colonies ledger (PTP slice 2) — cross-run record of every settled world,
   one row per save slot. Meta state on the main thread (the director/memory.ts
   shape), never engine state. Storage-injectable so it tests in plain node.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { loadLedger, upsertColony, removeColony, COLONIES_KEY, type ColonyRecord } from "./colonies";

function fakeStorage(): Pick<Storage, "getItem" | "setItem"> {
  const m = new Map<string, string>();
  return { getItem: (k) => (m.has(k) ? m.get(k)! : null), setItem: (k, v) => void m.set(k, v) };
}

function rec(slotKey: string, over: Partial<ColonyRecord> = {}): ColonyRecord {
  return {
    worldId: "mars", slotKey, seed: 1, difficulty: "normal", label: "Mars",
    outcome: "victory", sols: 12, population: 6, foundedAt: 1000, ...over,
  };
}

describe("colonies ledger", () => {
  it("loads an empty ledger when storage is empty", () => {
    expect(loadLedger(fakeStorage())).toEqual({ v: 1, colonies: [] });
  });

  it("never throws without storage (node-safe)", () => {
    expect(loadLedger()).toEqual({ v: 1, colonies: [] });
  });

  it("upsert adds, then replaces by slotKey (idempotent)", () => {
    const st = fakeStorage();
    upsertColony(rec("ceres", { sols: 5 }), st);
    const after = upsertColony(rec("ceres", { sols: 9, outcome: "defeat" }), st);
    expect(after.colonies).toHaveLength(1);
    expect(after.colonies[0].sols).toBe(9);
    expect(after.colonies[0].outcome).toBe("defeat");
  });

  it("round-trips multiple colonies through storage", () => {
    const st = fakeStorage();
    upsertColony(rec("mars"), st);
    upsertColony(rec("io"), st);
    expect(new Set(loadLedger(st).colonies.map((c) => c.slotKey))).toEqual(new Set(["mars", "io"]));
  });

  it("removeColony drops by slotKey", () => {
    const st = fakeStorage();
    upsertColony(rec("mars"), st);
    upsertColony(rec("io"), st);
    expect(removeColony("mars", st).colonies.map((c) => c.slotKey)).toEqual(["io"]);
  });

  it("normalizes a corrupt blob to an empty ledger", () => {
    const st = fakeStorage();
    st.setItem(COLONIES_KEY, "{not json");
    expect(loadLedger(st)).toEqual({ v: 1, colonies: [] });
  });

  it("drops malformed rows (missing slotKey) on load", () => {
    const st = fakeStorage();
    st.setItem(COLONIES_KEY, JSON.stringify({ v: 1, colonies: [rec("ok"), { worldId: "io" }] }));
    expect(loadLedger(st).colonies.map((c) => c.slotKey)).toEqual(["ok"]);
  });
});
