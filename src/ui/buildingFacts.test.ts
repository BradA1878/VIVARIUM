/* ============================================================================
   Tests for building facts and status text: buildingFacts's makes/uses/needs
   lines against the real defs, and statusLabel/statusLine against small
   BuildingState + Snapshot fixtures covering every off reason and the
   working/staffed cases.
   ============================================================================ */
import { describe, expect, it } from "vitest";
import type { BuildingState, ColonistView, Snapshot } from "@shared/types";
import { DEFS } from "@/engine";
import { buildingFacts, statusLabel, statusLine } from "./buildingFacts";

function makeBuilding(overrides: Partial<BuildingState> & Pick<BuildingState, "uid" | "defId">): BuildingState {
  return {
    gx: 0, gy: 0, rot: 0,
    online: true, connected: true, staffed: true, fed: true,
    util: 1, integrity: 1, faulted: 0,
    ...overrides,
  };
}

function makeColonist(overrides: Partial<ColonistView> = {}): ColonistView {
  return {
    id: 1, name: "Juno Voss", role: "miner",
    x: 0, y: 0, facing: 0, state: "idle",
    injury: 0, carryKind: null, carryAmt: 0, possessed: false, workUid: null,
    ...overrides,
  };
}

// Only labor/laborUsed/colonists are read by these functions — see task brief.
function makeSnap(overrides: Partial<Pick<Snapshot, "labor" | "laborUsed" | "colonists">> = {}): Snapshot {
  return {
    labor: 0, laborUsed: 0, colonists: [],
    ...overrides,
  } as unknown as Snapshot;
}

describe("buildingFacts", () => {
  it("hydroponics makes food and oxygen, uses power and water, needs crew + botanist note + seal", () => {
    expect(buildingFacts(DEFS.greenhouse)).toEqual({
      makes: ["5 food/s", "0.4 oxygen/s"],
      uses: ["6 power/s", "3 water/s"],
      needs: ["1 crew", "a botanist makes 25% more", "the pressure seal"],
    });
  });

  it("solar makes power up to a cap in full sun, with no crew or seal", () => {
    expect(buildingFacts(DEFS.solar)).toEqual({
      makes: ["up to 22 power/s in full sun"],
      uses: [],
      needs: [],
    });
  });

  it("battery stores power", () => {
    expect(buildingFacts(DEFS.battery)).toEqual({
      makes: ["stores 120 power"],
      uses: [],
      needs: [],
    });
  });

  it("the habitat sleeps colonists and needs the seal", () => {
    expect(buildingFacts(DEFS.hab)).toEqual({
      makes: ["beds for 4"],
      uses: ["1 power/s"],
      needs: ["the pressure seal"],
    });
  });

  it("the aquifer well needs an aquifer site (and has no role note: unmapped)", () => {
    expect(buildingFacts(DEFS.aquifer)).toEqual({
      makes: ["14 water/s"],
      uses: ["3 power/s"],
      needs: ["1 crew", "an aquifer site"],
    });
  });

  it("the medbay gets its own note: a medic heals faster", () => {
    expect(buildingFacts(DEFS.medbay).needs).toEqual(["1 crew", "a medic heals faster", "the pressure seal"]);
  });

  it("the robotics bay has a mapped role but makes nothing, so no role note", () => {
    expect(buildingFacts(DEFS.roboticsbay).needs).toEqual(["1 crew"]);
  });

  it("the Atomic Printer prints the lowest of its four resources", () => {
    expect(buildingFacts(DEFS.atomic).makes).toEqual([
      "the lowest of 6 oxygen/s, 8 water/s, 4 food/s, or 1 materials/s",
    ]);
  });

  it("the water reclaimer returns a percent of usage, capped per second", () => {
    expect(buildingFacts(DEFS.reclaimer).makes).toEqual(["returns 45% of the water the colony uses, up to 2.5/s"]);
  });
});

describe("statusLabel", () => {
  it("shows the off reason's label when one is set", () => {
    expect(statusLabel(makeBuilding({ uid: 1, defId: "greenhouse", offReason: "power" }))).toBe("NO POWER");
  });

  it("shows WORKING for a recipe building with no off reason", () => {
    expect(statusLabel(makeBuilding({ uid: 1, defId: "greenhouse" }))).toBe("WORKING");
  });

  it("shows WORKING for a generator with no off reason", () => {
    expect(statusLabel(makeBuilding({ uid: 1, defId: "solar" }))).toBe("WORKING");
  });

  it("is null for storage, which has no status", () => {
    expect(statusLabel(makeBuilding({ uid: 1, defId: "battery" }))).toBeNull();
  });
});

describe("statusLine", () => {
  it("is null wherever statusLabel is null", () => {
    expect(statusLine(makeBuilding({ uid: 1, defId: "battery" }), makeSnap())).toBeNull();
  });

  it("crew: reports how many colonists are free right now", () => {
    const b = makeBuilding({ uid: 1, defId: "greenhouse", offReason: "crew" });
    expect(statusLine(b, makeSnap({ labor: 5, laborUsed: 3 }))).toBe("no free colonist (3 of 5 busy)");
  });

  it("power", () => {
    const b = makeBuilding({ uid: 1, defId: "greenhouse", offReason: "power" });
    expect(statusLine(b, makeSnap())).toBe("not enough power");
  });

  it("seal", () => {
    const b = makeBuilding({ uid: 1, defId: "greenhouse", offReason: "seal" });
    expect(statusLine(b, makeSnap())).toBe("cut off from the pressure network");
  });

  it("damaged", () => {
    const b = makeBuilding({ uid: 1, defId: "greenhouse", offReason: "damaged" });
    expect(statusLine(b, makeSnap())).toBe("damaged · repairs itself over time");
  });

  it("faulted", () => {
    const b = makeBuilding({ uid: 1, defId: "greenhouse", offReason: "faulted" });
    expect(statusLine(b, makeSnap())).toBe("flare fault · electronics recovering");
  });

  it("water", () => {
    const b = makeBuilding({ uid: 1, defId: "greenhouse", offReason: "water" });
    expect(statusLine(b, makeSnap())).toBe("out of water");
  });

  it("oxygen", () => {
    const b = makeBuilding({ uid: 1, defId: "greenhouse", offReason: "oxygen" });
    expect(statusLine(b, makeSnap())).toBe("out of oxygen");
  });

  it("food", () => {
    const b = makeBuilding({ uid: 1, defId: "greenhouse", offReason: "food" });
    expect(statusLine(b, makeSnap())).toBe("out of food");
  });

  it("off", () => {
    const b = makeBuilding({ uid: 1, defId: "greenhouse", offReason: "off" });
    expect(statusLine(b, makeSnap())).toBe("switched off");
  });

  it("names the worker, with the +25% bonus when their role matches the building's trade", () => {
    const b = makeBuilding({ uid: 7, defId: "greenhouse" });
    const snap = makeSnap({ colonists: [makeColonist({ workUid: 7, name: "Mara Reyes", role: "botanist" })] });
    expect(statusLine(b, snap)).toBe("working · Mara Reyes, botanist, +25%");
  });

  it("names the worker with no bonus suffix when their role doesn't match", () => {
    const b = makeBuilding({ uid: 7, defId: "greenhouse" });
    const snap = makeSnap({ colonists: [makeColonist({ workUid: 7, name: "Kai Tanaka", role: "miner" })] });
    expect(statusLine(b, snap)).toBe("working · Kai Tanaka, miner");
  });

  it('says plain "working" when nobody is posted there', () => {
    const b = makeBuilding({ uid: 7, defId: "greenhouse" });
    expect(statusLine(b, makeSnap())).toBe("working");
  });

  it('says plain "working" for a def with no crew', () => {
    expect(statusLine(makeBuilding({ uid: 1, defId: "solar" }), makeSnap())).toBe("working");
  });
});
