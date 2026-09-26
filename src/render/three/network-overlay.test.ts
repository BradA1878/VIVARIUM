import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { BuildingState } from "@shared/types";
import { GridSpace } from "./coords";
import { NetworkOverlay, overlayCells } from "./network-overlay";

let nextUid = 1;

/** a minimal placed building. Only defId/gx/gy/connected vary by call site —
 *  the rest are steady filler, matching what a real snapshot always carries. */
function bld(defId: string, gx: number, gy: number, connected: boolean): BuildingState {
  return {
    uid: nextUid++,
    defId,
    gx,
    gy,
    rot: 0,
    online: connected,
    connected,
    staffed: true,
    fed: true,
    util: connected ? 1 : 0,
    integrity: 1,
    faulted: 0,
  };
}

const cellKey = (c: { gx: number; gy: number }): string => `${c.gx},${c.gy}`;

describe("overlayCells", () => {
  it("marks every cell of a connected hub as ok", () => {
    const cells = overlayCells([bld("hub", 0, 0, true)]);
    expect(cells).toHaveLength(4);
    expect(cells.every((c) => c.ok)).toBe(true);
    expect(new Set(cells.map(cellKey))).toEqual(new Set(["0,0", "1,0", "0,1", "1,1"]));
  });

  it("marks a connected corridor's cell as ok", () => {
    expect(overlayCells([bld("corridor", 3, 4, true)])).toEqual([{ gx: 3, gy: 4, ok: true }]);
  });

  it("marks a connected sealed building's cell as ok", () => {
    expect(overlayCells([bld("electrolysis", 6, 6, true)])).toEqual([{ gx: 6, gy: 6, ok: true }]);
  });

  it("marks an unconnected sealed building's cell as not ok", () => {
    expect(overlayCells([bld("hab", 5, 5, false)])).toEqual([{ gx: 5, gy: 5, ok: false }]);
  });

  it("a surface building contributes nothing, connected or not", () => {
    const cells = overlayCells([bld("solar", 2, 2, true), bld("solar", 8, 8, false)]);
    expect(cells).toEqual([]);
  });
});

describe("NetworkOverlay", () => {
  const grid = new GridSpace(16);

  function meshes(overlay: NetworkOverlay): THREE.InstancedMesh[] {
    return overlay.group.children.filter(
      (c): c is THREE.InstancedMesh => c instanceof THREE.InstancedMesh,
    );
  }
  const okMeshOf = (overlay: NetworkOverlay) => meshes(overlay).find((m) => m.name === "network-overlay-ok")!;
  const badMeshOf = (overlay: NetworkOverlay) => meshes(overlay).find((m) => m.name === "network-overlay-bad")!;

  it("is hidden until told otherwise", () => {
    const overlay = new NetworkOverlay(grid);
    expect(overlay.group.visible).toBe(false);
    overlay.dispose();
  });

  it("setVisible toggles the group's visibility", () => {
    const overlay = new NetworkOverlay(grid);
    overlay.setVisible(true);
    expect(overlay.group.visible).toBe(true);
    overlay.setVisible(false);
    expect(overlay.group.visible).toBe(false);
    overlay.dispose();
  });

  it("sync sets the ok and bad instance counts", () => {
    const overlay = new NetworkOverlay(grid);
    overlay.sync([bld("hub", 0, 0, true), bld("hab", 5, 5, false)]);
    expect(okMeshOf(overlay).count).toBe(4);
    expect(badMeshOf(overlay).count).toBe(1);
    overlay.dispose();
  });

  it("does not rewrite instance matrices on an unchanged sync", () => {
    const overlay = new NetworkOverlay(grid);
    const spy = vi.spyOn(THREE.InstancedMesh.prototype, "setMatrixAt");
    const hub = bld("hub", 0, 0, true);
    overlay.sync([hub]);
    expect(spy).toHaveBeenCalledTimes(4);
    overlay.sync([{ ...hub }]); // same values, fresh object — the key is value-based, not identity-based
    expect(spy).toHaveBeenCalledTimes(4);
    spy.mockRestore();
    overlay.dispose();
  });

  it("a real change (connectivity flips) does rebuild", () => {
    const overlay = new NetworkOverlay(grid);
    const hab = bld("hab", 5, 5, false);
    overlay.sync([hab]);
    expect(badMeshOf(overlay).count).toBe(1);
    overlay.sync([{ ...hab, connected: true }]);
    expect(okMeshOf(overlay).count).toBe(1);
    expect(badMeshOf(overlay).count).toBe(0);
    overlay.dispose();
  });

  it("dispose disposes the shared geometry and both materials", () => {
    const overlay = new NetworkOverlay(grid);
    const [a, b] = meshes(overlay);
    const geoSpy = vi.spyOn(a.geometry, "dispose");
    const matSpies = [a, b].map((m) => vi.spyOn(m.material as THREE.Material, "dispose"));
    overlay.dispose();
    expect(geoSpy).toHaveBeenCalled();
    for (const s of matSpies) expect(s).toHaveBeenCalled();
  });
});
