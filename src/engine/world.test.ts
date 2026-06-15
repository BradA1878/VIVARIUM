/* ============================================================================
   The world + seed founding channel (PTP slice 3). A run can be founded on a
   chosen seed and world; both ride the engine as deterministic inputs (never
   originated inside it) and round-trip through save/load. Slice 3 carries the
   channel only — every world still behaves like mars until the profiles land.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "@/engine";
import { encode, decode } from "@/persistence/save";

function run(c: Colony, seconds: number, step = 0.2): void {
  for (let i = 0; i < Math.round(seconds / step); i++) { c.tick(step); c.drainEvents(); }
}

describe("world + seed founding channel", () => {
  it("defaults to the mars world", () => {
    expect(new Colony(123).snapshot().world).toBe("mars");
  });

  it("carries the world chosen at construction", () => {
    expect(new Colony(123, "normal", "ceres").snapshot().world).toBe("ceres");
  });

  it("reset applies a new seed (new terrain) and the new world", () => {
    const c = new Colony(0x5eed1234);
    const before = JSON.stringify(c.serialize().state.deposits);
    c.reset("normal", 999, "io");
    expect(c.snapshot().world).toBe("io");
    expect(JSON.stringify(c.serialize().state.deposits)).not.toBe(before);
  });

  it("a non-default seed round-trips byte-identical and continues deterministically", () => {
    const c = new Colony(0xabcdef);
    run(c, 80);
    const restored = Colony.load(decode(encode(c.serialize()))!);
    expect(restored.snapshot()).toEqual(c.snapshot());
    run(c, 40); run(restored, 40);
    expect(restored.snapshot()).toEqual(c.snapshot());
  });

  it("a legacy save without a world backfills to mars", () => {
    const c = new Colony(42, "normal", "titan");
    const save = c.serialize();
    delete (save.state as unknown as Record<string, unknown>).world;
    expect(Colony.load(save).snapshot().world).toBe("mars");
  });
});
