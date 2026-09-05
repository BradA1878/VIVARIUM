import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import type { BridgeCore } from "@/worker/bridge";
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
    canPlace: () => true,
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
  return { controller, bridge, select, dispatch, input };
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
    expect(bridge.place.mock.calls).toEqual([["battery", 4, 2, 0]]);
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
    expect(bridge.place.mock.calls).toEqual([["battery", 1, 1, 0]]);
    dispatch("click", 3, 2, pointerType);
    expect(bridge.place).toHaveBeenCalledTimes(1);
    dispatch("click", 3, 2, pointerType);
    expect(bridge.place).toHaveBeenLastCalledWith("battery", 3, 2, 0);
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
