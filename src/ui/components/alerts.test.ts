import { describe, expect, it } from "vitest";
import type { BuildingState, OffReason } from "@shared/types";
import { brownoutShed, faultAlerts, nextFaultUid, quakeAlertSub, resupplyAlertCopy } from "./alerts";

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
      { k: "off-damaged", sev: 2, txt: "1 DAMAGED", sub: "repairs itself over time", uids: [1] },
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

describe("brownoutShed", () => {
  it("is a sealed building shed for power", () => {
    expect(brownoutShed([bld(1, "electrolysis", "power")])).toBe(true);
  });

  it("is not a damaged or flare-faulted building, though it is offline, connected, staffed, and fed", () => {
    for (const reason of ["damaged", "faulted"] as const) {
      const b = { ...bld(1, "electrolysis", reason), staffed: true, fed: true, connected: true, online: false };
      expect(brownoutShed([b])).toBe(false);
    }
  });

  it("keeps its old scope: a shed surface building alone is not reported", () => {
    expect(brownoutShed([bld(1, "extractor", "power")])).toBe(false);
  });
});

describe("nextFaultUid", () => {
  it("starts at the first building and cycles in order, wrapping", () => {
    const uids = [5, 9, 12];
    const seen: (number | undefined)[] = [];
    let last: number | undefined;
    for (let i = 0; i < 4; i++) { last = nextFaultUid(uids, last); seen.push(last); }
    expect(seen).toEqual([5, 9, 12, 5]);
  });

  it("neither repeats nor skips when the list changes between clicks", () => {
    expect(nextFaultUid([9, 12], 9)).toBe(12); // 5 was fixed after 9 was shown: 12 is next, not 9 again
    expect(nextFaultUid([5, 7, 9, 12], 9)).toBe(12); // 7 was added before the cursor: nothing skipped
    expect(nextFaultUid([5, 12], 9)).toBe(12); // the one shown last is gone: the one after it
  });

  it("has nothing to show for an empty line", () => {
    expect(nextFaultUid([], 3)).toBeUndefined();
  });
});
