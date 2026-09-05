/* ============================================================================
   Placement prediction tests — the main-thread ghost-preview helpers must match
   the engine's authoritative canPlace.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "./index";
import { buildingAtPredict, canPlacePredict, canMovePredict } from "./predict";

describe("placement prediction matches the engine", () => {
  it("agrees with Colony.canPlace across the grid for several defs", () => {
    const c = new Colony();
    const snap = c.snapshot();
    for (const defId of ["hab", "solar", "hub", "corridor"]) {
      for (let gx = -1; gx <= snap.N; gx++) {
        for (let gy = -1; gy <= snap.N; gy++) {
          expect(canPlacePredict(snap, defId, gx, gy)).toBe(c.canPlace(defId, gx, gy));
        }
      }
    }
  });

  it("buildingAtPredict finds the hub under each of its 2x2 cells", () => {
    const c = new Colony();
    const snap = c.snapshot();
    const hub = snap.buildings.find((b) => b.defId === "hub")!;
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const b = buildingAtPredict(snap, hub.gx + dx, hub.gy + dy);
      expect(b?.defId).toBe("hub");
    }
    expect(buildingAtPredict(snap, 0, 0)).toBeNull();
  });
});

describe("moving a placed building", () => {
  it("relocates to an empty cell, keeping rotation, and frees the old cells", () => {
    const c = new Colony();
    expect(c.place("hab", 0, 0, 1)).toBe(true);
    const uid = c.buildingAt(0, 0)!.uid;
    expect(c.move(uid, 1, 9)).toBe(true);
    expect(c.buildingAt(0, 0)).toBeNull();        // old cell freed
    const moved = c.buildingAt(1, 9)!;
    expect(moved.uid).toBe(uid);
    expect(moved.rot).toBe(1);                    // rotation preserved
  });

  it("refuses a blocked destination and leaves the building put", () => {
    const c = new Colony();
    const hub = c.snapshot().buildings.find((b) => b.defId === "hub")!;
    expect(c.place("hab", 0, 0)).toBe(true);
    const habUid = c.buildingAt(0, 0)!.uid;
    expect(c.move(habUid, hub.gx, hub.gy)).toBe(false); // onto the hub → blocked
    expect(c.buildingAt(0, 0)!.uid).toBe(habUid); // still in place
  });

  it("canMovePredict ignores the building's own footprint", () => {
    const c = new Colony();
    expect(c.place("hab", 0, 0)).toBe(true);
    const snap = c.snapshot();
    const hub = snap.buildings.find((b) => b.defId === "hub")!;
    const uid = buildingAtPredict(snap, 0, 0)!.uid;
    expect(canMovePredict(snap, uid, 0, 1)).toBe(true);  // overlapping its old self is fine
    expect(canMovePredict(snap, uid, hub.gx, hub.gy)).toBe(false); // onto the hub is not
  });
});
