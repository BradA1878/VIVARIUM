import { describe, expect, it } from "vitest";
import type { BuildingState, OffReason } from "@shared/types";
import { faultAlerts, quakeAlertSub, resupplyAlertCopy } from "./alerts";

function bld(uid: number, defId: string, offReason?: OffReason): BuildingState {
  return {
    uid, defId, gx: 0, gy: 0, rot: 0, online: !offReason, connected: true,
    staffed: true, fed: true, util: offReason ? 0 : 1, integrity: 1, faulted: 0,
    offReason,
  };
}

describe("quakeAlertSub", () => {
  it("explains automatic evacuation, the pilot action, injury, and seal risk", () => {
    expect(quakeAlertSub(3.6, true)).toBe(
      "crew evacuating · release any pilot to shelter · exposed crew can be injured · seals at risk · impact in 4s",
    );
    expect(quakeAlertSub(7.2, false)).toBe(
      "crew evacuating · release any pilot to shelter · exposed crew can be injured · seals at risk · 7s remaining",
    );
  });
});

describe("resupplyAlertCopy", () => {
  it("explains the automatic delivery and departure countdown", () => {
    expect(resupplyAlertCopy(17.6)).toEqual({
      txt: "EARTH RESUPPLY — AUTOMATIC",
      sub: "no action required · adding power, water, oxygen, and food · departs in 18s",
    });
  });
});

describe("faultAlerts", () => {
  it("emits nothing when no building has an off reason", () => {
    expect(faultAlerts([bld(1, "hab"), bld(2, "electrolysis")])).toEqual([]);
  });

  it("ignores power (BROWNOUT already covers it) and conduits", () => {
    const buildings = [
      bld(1, "hab", "power"),
      // a corridor should never carry an off reason in practice, but stays excluded even if it did
      bld(2, "corridor", "seal"),
    ];
    expect(faultAlerts(buildings)).toEqual([]);
  });

  it("orders lines seal, crew, damaged, faulted, water, oxygen, food and skips zero counts", () => {
    const buildings = [
      bld(1, "hab", "food"),
      bld(2, "hab", "oxygen"),
      bld(3, "hab", "water"),
      bld(4, "hab", "faulted"),
      bld(5, "hab", "damaged"),
      bld(6, "hab", "crew"),
      bld(7, "hab", "seal"),
    ];
    expect(faultAlerts(buildings).map((a) => a.k)).toEqual([
      "off-seal", "off-crew", "off-damaged", "off-faulted", "off-water", "off-oxygen", "off-food",
    ]);
  });

  it("counts per reason and lists uids in building order, not sorted", () => {
    const buildings = [bld(30, "hab", "crew"), bld(10, "hab", "crew"), bld(20, "hab", "crew")];
    expect(faultAlerts(buildings)).toEqual([
      { k: "off-crew", sev: 2, txt: "3 UNSTAFFED", sub: "no free crew", uids: [30, 10, 20] },
    ]);
  });

  it("gives the exact text and severity for every reason", () => {
    expect(faultAlerts([bld(1, "hab", "seal")])).toEqual([
      { k: "off-seal", sev: 2, txt: "1 UNSEALED", sub: "no corridor to a hub", uids: [1] },
    ]);
    expect(faultAlerts([bld(1, "hab", "damaged")])).toEqual([
      { k: "off-damaged", sev: 2, txt: "1 DAMAGED", sub: "offline until repaired", uids: [1] },
    ]);
    expect(faultAlerts([bld(1, "hab", "faulted")])).toEqual([
      { k: "off-faulted", sev: 2, txt: "1 FLARE FAULT", sub: "electronics recovering", uids: [1] },
    ]);
    expect(faultAlerts([bld(1, "electrolysis", "water")])).toEqual([
      { k: "off-water", sev: 2, txt: "1 NO WATER", sub: "input tank empty", uids: [1] },
    ]);
    expect(faultAlerts([bld(1, "electrolysis", "oxygen")])).toEqual([
      { k: "off-oxygen", sev: 2, txt: "1 NO OXYGEN", sub: "input tank empty", uids: [1] },
    ]);
    expect(faultAlerts([bld(1, "greenhouse", "food")])).toEqual([
      { k: "off-food", sev: 2, txt: "1 NO FOOD", sub: "input tank empty", uids: [1] },
    ]);
  });
});
