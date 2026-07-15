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

  it("decode rejects parseable-but-truncated shapes that would crash Colony.load", () => {
    // the shapes Colony.load dereferences unconditionally: grid, buildings, pools.{4}
    expect(decode('{"version":1,"seed":1,"rngState":1,"envRngState":1,"state":{}}')).toBeNull();
    expect(decode('{"version":1,"seed":1,"rngState":1,"envRngState":1,"state":{"N":25,"t":0,"buildings":[],"pools":{}}}')).toBeNull(); // no grid
    expect(decode('{"version":1,"seed":1,"rngState":1,"envRngState":1,"state":{"N":25,"t":0,"grid":[],"pools":{"power":{},"water":{},"oxygen":{},"food":{}}}}')).toBeNull(); // no buildings
    expect(decode('{"version":1,"seed":1,"rngState":1,"envRngState":1,"state":{"N":25,"t":0,"grid":[],"buildings":[]}}')).toBeNull(); // no pools
    const noFood = '{"version":1,"seed":1,"rngState":1,"envRngState":1,"state":{"N":25,"t":0,"grid":[],"buildings":[],"pools":{"power":{},"water":{},"oxygen":{}}}}';
    expect(decode(noFood)).toBeNull(); // a pool missing
  });

  it("the guard never rejects a real save — including a legacy one missing optional fields", () => {
    const c = new Colony(777);
    run(c, 50);
    const json = JSON.parse(encode(c.serialize()));
    // simulate a legacy save: strip every field Colony.load backfills
    for (const k of ["robots", "robotFab", "rovers", "roverFab", "unlocked", "vents",
      "aquifers", "deposits", "colonists", "acquiredTech", "pilots", "world", "difficulty"]) {
      delete json.state[k];
    }
    const decoded = decode(JSON.stringify(json));
    expect(decoded).not.toBeNull();
    expect(() => Colony.load(decoded!)).not.toThrow(); // and load really does tolerate it
  });
});
