/* ============================================================================
   Persistence round-trip — a save encoded to JSON and back must restore the
   colony bit-identically, and the resumed colony must stay deterministic going
   forward (same seed/state → same future). (Doc §5.)
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "@/engine";
import { encode, decode } from "./save";

function run(c: Colony, seconds: number, step = 0.2): void {
  for (let i = 0; i < Math.round(seconds / step); i++) {
    c.tick(step);
    c.drainEvents();
  }
}

describe("save JSON round-trip", () => {
  it("encode → decode → load restores the colony exactly", () => {
    const c = new Colony(555);
    run(c, 100);
    const text = encode(c.serialize());
    const restored = Colony.load(decode(text)!);
    expect(restored.snapshot()).toEqual(c.snapshot());
  });

  it("the restored colony continues deterministically", () => {
    const c = new Colony(321);
    run(c, 80);
    const restored = Colony.load(decode(encode(c.serialize()))!);
    run(c, 60);
    run(restored, 60);
    expect(restored.snapshot()).toEqual(c.snapshot());
  });

  it("decode rejects garbage", () => {
    expect(decode("not json")).toBeNull();
    expect(decode('{"version":99}')).toBeNull();
  });
});
