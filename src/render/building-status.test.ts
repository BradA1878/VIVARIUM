import { describe, expect, it } from "vitest";
import type { BuildingState } from "@shared/types";
import { buildingStatus } from "./renderer";

const bld = (over: Partial<BuildingState>): BuildingState => ({
  uid: 1, defId: "electrolysis", gx: 0, gy: 0, rot: 0,
  online: true, connected: true, staffed: true, fed: true, util: 1, integrity: 1, faulted: 0,
  ...over,
});

describe("buildingStatus — the status light", () => {
  it("a shed building glows as hurt", () => {
    expect(buildingStatus(bld({ online: false, util: 0, offReason: "power" }))).toEqual({ alive: false, hurt: true });
  });

  it("a building switched OFF is dark but not hurt", () => {
    expect(buildingStatus(bld({ online: false, util: 0, offReason: "off", mode: "off" }))).toEqual({ alive: false, hurt: false });
  });
});
