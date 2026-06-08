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
    for (const [x, y] of [[4, 4], [5, 4], [4, 5], [5, 5]] as const) {
      const b = buildingAtPredict(snap, x, y);
      expect(b?.defId).toBe("hub");
    }
    expect(buildingAtPredict(snap, 0, 0)).toBeNull();
  });
});

describe("moving a placed building", () => {
  it("relocates to an empty cell, keeping rotation, and frees the old cells", () => {
    const c = new Colony();
    c.place("hab", 0, 0, 1);
    const uid = c.buildingAt(0, 0)!.uid;
    expect(c.move(uid, 1, 9)).toBe(true);
    expect(c.buildingAt(0, 0)).toBeNull();        // old cell freed
    const moved = c.buildingAt(1, 9)!;
    expect(moved.uid).toBe(uid);
    expect(moved.rot).toBe(1);                    // rotation preserved
  });

  it("refuses a blocked destination and leaves the building put", () => {
    const c = new Colony();
    const hub = c.buildingAt(4, 4)!; // 2x2 hub occupies (4,4)
    c.place("hab", 0, 0);
    const habUid = c.buildingAt(0, 0)!.uid;
    expect(c.move(habUid, 4, 4)).toBe(false);     // onto the hub → blocked
    expect(c.buildingAt(0, 0)!.uid).toBe(habUid); // still in place
    void hub;
  });

  it("canMovePredict ignores the building's own footprint", () => {
    const c = new Colony();
    c.place("hab", 0, 0);
    const snap = c.snapshot();
    const uid = buildingAtPredict(snap, 0, 0)!.uid;
    expect(canMovePredict(snap, uid, 0, 1)).toBe(true);  // overlapping its old self is fine
    expect(canMovePredict(snap, uid, 4, 4)).toBe(false); // onto the hub is not
  });
});
