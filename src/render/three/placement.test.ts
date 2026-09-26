import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { SealPreview } from "@/engine";
import type { BridgeCore } from "@/worker/bridge";
import { aoVisible } from "./ao";
import { GridSpace } from "./coords";
import { PlacementController } from "./placement";

const controllers: PlacementController[] = [];
afterEach(() => { for (const controller of controllers.splice(0)) controller.dispose(); });

function fixture() {
  const canvas = Object.assign(new EventTarget(), {
    getBoundingClientRect: () => ({ left: 30, top: 50, width: 100, height: 100 }),
    classList: { toggle: vi.fn(), remove: vi.fn() },
  });
  const input = { dragging: false };
  // CameraControls registers its drag-click suppression before placement.
  canvas.addEventListener("click", (event) => { if (input.dragging) event.stopImmediatePropagation(); });
  const camera = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 100);
  camera.position.set(0, 30, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const grid = new GridSpace(5);
  const buildings = [{ uid: 1, defId: "battery", gx: 0, gy: 0 }, { uid: 7, defId: "battery", gx: 4, gy: 3 }];
  const bridge = {
    latest: { possessed: null as number | null },
    place: vi.fn(),
    canPlace: vi.fn(() => true),
    previewSeal: vi.fn((): SealPreview | null => null),
    buildingAt: (gx: number, gy: number) => buildings.find((b) => b.gx === gx && b.gy === gy),
    buildingByUid: (uid: number) => buildings.find((b) => b.uid === uid),
  };
  const controller = new PlacementController(canvas as unknown as HTMLCanvasElement, camera, grid, bridge as unknown as BridgeCore);
  controllers.push(controller);
  const select = vi.fn();
  controller.onSelect(select);
  const dispatch = (type: string, gx: number, gy: number, pointerType = "mouse") => {
    const point = grid.cellCenter(gx, gy).project(camera);
    const event = new Event(type);
    Object.assign(event, {
      clientX: 30 + (point.x + 1) * 50,
      clientY: 50 + (1 - point.y) * 50,
      pointerType,
    });
    canvas.dispatchEvent(event);
  };
  const preview = vi.fn();
  controller.onPreview(preview);
  return { controller, bridge, select, dispatch, input, preview };
}

describe("placement click coordinates", () => {
  it.each([false, true])("uses the mouse click before another render with existing hover=%s", (hasHover) => {
    const { controller, bridge, dispatch } = fixture();
    controller.setTool("battery");
    if (hasHover) {
      dispatch("pointermove", 0, 0);
      controller.update();
    }
    dispatch("pointermove", 3, 1);
    dispatch("click", 4, 2);
    expect(bridge.place.mock.calls).toEqual([["battery", 4, 2, 0, true]]);
  });

  it("selects the current clicked building rather than the last rendered hover", () => {
    const { controller, select, dispatch } = fixture();
    dispatch("pointermove", 0, 0);
    controller.update();
    dispatch("pointermove", 4, 3);
    dispatch("click", 4, 3);
    expect(select.mock.calls).toEqual([[{ uid: 7, defId: "battery" }]]);
  });

  it("does not place at an old valid hover when the click is outside the build grid", () => {
    const { controller, bridge, dispatch } = fixture();
    controller.setTool("battery");
    dispatch("pointermove", 2, 2);
    controller.update();
    dispatch("click", 6, 2);
    expect(bridge.place).not.toHaveBeenCalled();
  });

  it.each(["touch", "pen"])("retains first-tap aim and second-tap placement for %s", (pointerType) => {
    const { controller, bridge, dispatch } = fixture();
    controller.setTool("battery");
    dispatch("click", 1, 1, pointerType);
    expect(bridge.place).not.toHaveBeenCalled();
    dispatch("click", 1, 1, pointerType);
    expect(bridge.place.mock.calls).toEqual([["battery", 1, 1, 0, true]]);
    dispatch("click", 3, 2, pointerType);
    expect(bridge.place).toHaveBeenCalledTimes(1);
    dispatch("click", 3, 2, pointerType);
    expect(bridge.place).toHaveBeenLastCalledWith("battery", 3, 2, 0, true);
  });

  it("keeps piloting and camera drag-click suppression ahead of construction", () => {
    const { controller, bridge, dispatch, input } = fixture();
    controller.setTool("battery");
    bridge.latest.possessed = 7;
    dispatch("click", 2, 2);
    expect(bridge.place).not.toHaveBeenCalled();
    bridge.latest.possessed = null;
    input.dragging = true;
    dispatch("click", 2, 2);
    expect(bridge.place).not.toHaveBeenCalled();
  });
});

describe("placement overlay", () => {
  it("keeps the ghost tiles, outline and door arrow out of the AO pre-pass", () => {
    const { controller, dispatch } = fixture();
    controller.setTool("hab"); // a door building, so the arrow is up
    dispatch("pointermove", 2, 2);
    controller.update();
    const shown: THREE.Object3D[] = [];
    controller.group.traverse((o) => { if (o !== controller.group && o.visible) shown.push(o); });
    expect(shown.some((o) => (o as THREE.Mesh).geometry instanceof THREE.ConeGeometry)).toBe(true);
    for (const o of shown) expect(aoVisible(o), (o as THREE.Mesh).geometry.type).toBe(false);
  });
});

describe("sealed placement preview", () => {
  const corridor = (affordable: boolean): SealPreview => ({
    kind: "corridor", path: [[3, 2], [4, 2]], cells: 2, cost: 4, total: 28, affordable,
  });
  /** the ghost tiles on screen, in pool order */
  const shownTiles = (controller: PlacementController) =>
    controller.group.children.filter(
      (o): o is THREE.Mesh => o instanceof THREE.Mesh && o.geometry instanceof THREE.PlaneGeometry && o.visible,
    );
  const hexOf = (tile: THREE.Mesh) => (tile.material as THREE.MeshBasicMaterial).color.getHexString();

  it("draws the planned corridor beside the footprint and reports the preview once", () => {
    const { controller, bridge, dispatch, preview } = fixture();
    bridge.previewSeal.mockReturnValue(corridor(true));
    controller.setTool("hab");
    dispatch("pointermove", 2, 2);
    controller.update();
    controller.update(); // an unchanged aim does not re-report
    expect(bridge.previewSeal).toHaveBeenLastCalledWith("hab", 2, 2);
    const tiles = shownTiles(controller);
    expect(tiles).toHaveLength(3); // the habitat's one cell + two corridor cells
    expect(tiles.slice(1).map((t) => t.position.y)).toEqual([0.04, 0.04]);
    expect(tiles.every((t) => hexOf(t) === "7fd4e8")).toBe(true);
    expect(preview.mock.calls).toEqual([[corridor(true)]]);
  });

  it("an unaffordable corridor turns the whole ghost rust", () => {
    const { controller, bridge, dispatch } = fixture();
    bridge.previewSeal.mockReturnValue(corridor(false));
    controller.setTool("hab");
    dispatch("pointermove", 2, 2);
    controller.update();
    const tiles = shownTiles(controller);
    expect(tiles).toHaveLength(3);
    expect(tiles.every((t) => hexOf(t) === "e8784f")).toBe(true);
  });

  it("asks for no plan where the building cannot go", () => {
    const { controller, bridge, dispatch, preview } = fixture();
    bridge.canPlace.mockReturnValue(false);
    controller.setTool("hab");
    dispatch("pointermove", 2, 2);
    controller.update();
    expect(bridge.previewSeal).not.toHaveBeenCalled();
    expect(preview).not.toHaveBeenCalled(); // null from the start: nothing to clear
  });

  it("clears the preview when the tool drops or the cursor leaves the canvas", () => {
    const { controller, bridge, dispatch, preview } = fixture();
    bridge.previewSeal.mockReturnValue({ kind: "touching" });
    controller.setTool("hab");
    dispatch("pointermove", 2, 2);
    controller.update();
    dispatch("pointerleave", 2, 2);
    controller.update();
    expect(preview.mock.calls).toEqual([[{ kind: "touching" }], [null]]);
    dispatch("pointermove", 2, 2);
    controller.update();
    controller.clearTool();
    controller.update();
    expect(preview.mock.calls.slice(2)).toEqual([[{ kind: "touching" }], [null]]);
  });

  it("places with connect, so the worker lays the corridor", () => {
    const { controller, bridge, dispatch } = fixture();
    controller.setTool("hab");
    dispatch("click", 2, 2);
    expect(bridge.place.mock.calls).toEqual([["hab", 2, 2, 0, true]]);
  });

  it("reports whether a build tool is up", () => {
    const { controller } = fixture();
    expect(controller.hasTool()).toBe(false);
    controller.setTool("hab");
    expect(controller.hasTool()).toBe(true);
    controller.setDemolish();
    expect(controller.hasTool()).toBe(true);
    controller.setRoute();
    expect(controller.hasTool()).toBe(true);
    controller.clearTool();
    expect(controller.hasTool()).toBe(false);
  });
});
