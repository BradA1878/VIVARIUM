/* ============================================================================
   Placement prediction tests — the main-thread ghost-preview helpers must match
   the engine's authoritative canPlace.
   ============================================================================ */
import { describe, it, expect } from "vitest";
import { Colony } from "./index";
import { buildingAtPredict, canPlacePredict } from "./predict";

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
