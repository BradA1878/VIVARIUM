import * as THREE from "three";
import { CAMERA_BUTTON_ZOOM_DELTA, CameraRig, wheelPixels } from "./camera-controls";

describe("camera controls", () => {
  test("normalizes wheel delta modes", () => {
    expect(wheelPixels(2, 0, 900)).toBe(2);
    expect(wheelPixels(2, 1, 900)).toBe(32);
    expect(wheelPixels(2, 2, 900)).toBe(1800);
  });

  test("wheel zoom persists and clamps to the supported view range", () => {
    const rig = new CameraRig(20);
    rig.setContext("mars", null);

    rig.zoomBy(-10_000, 13);
    expect(rig.viewFor(13)).toBe(3);
    expect(rig.viewFor(13)).toBe(3); // a later frame cannot overwrite it

    rig.zoomBy(10_000, 13);
    expect(rig.viewFor(13)).toBe(22);
  });

  test("explicit zoom steps use the wheel delta scale and remain reversible", () => {
    const rig = new CameraRig(20);
    rig.setContext("mars", null);

    rig.zoomBy(-CAMERA_BUTTON_ZOOM_DELTA, 13);
    const zoomedIn = rig.viewFor(13);
    expect(zoomedIn).toBeLessThan(13);

    rig.zoomBy(CAMERA_BUTTON_ZOOM_DELTA, 13);
    expect(rig.viewFor(13)).toBeCloseTo(13);
  });

  test("manual pan remains relative to a moving follow anchor", () => {
    const rig = new CameraRig(50);
    rig.setContext("mars", "colonist:1");
    rig.setOffset(new THREE.Vector3(3, 0, -2), new THREE.Vector3(0, 0, 0));

    const out = new THREE.Vector3();
    expect(rig.focusFor(new THREE.Vector3(0, 0, 0), out).toArray()).toEqual([3, 0, -2]);
    expect(rig.focusFor(new THREE.Vector3(4, 0, 5), out).toArray()).toEqual([7, 0, 3]);
  });

  test("overview framing is restored after piloting and each boarding recenters", () => {
    const rig = new CameraRig(50);
    const anchor = new THREE.Vector3();
    const out = new THREE.Vector3();

    rig.setContext("mars", null);
    rig.setOffset(new THREE.Vector3(4, 0, 2), anchor);
    rig.zoomBy(-120, 13);
    const overviewView = rig.viewFor(13);

    rig.setContext("mars", "colonist:1");
    expect(rig.info()).toMatchObject({ profile: "pilot", offset: { x: 0, z: 0 }, zoom: 1 });
    rig.setOffset(new THREE.Vector3(-3, 0, 1), anchor);
    rig.zoomBy(150, 5.5);

    rig.setContext("mars", null);
    expect(rig.focusFor(anchor, out).toArray()).toEqual([4, 0, 2]);
    expect(rig.viewFor(13)).toBeCloseTo(overviewView);

    rig.setContext("mars", "colonist:1");
    expect(rig.info()).toMatchObject({ profile: "pilot", offset: { x: 0, z: 0 }, zoom: 1 });
  });

  test("focus is clamped to terrain bounds and a world hop resets framing", () => {
    const rig = new CameraRig(10);
    const out = new THREE.Vector3();
    rig.setContext("mars", null);
    rig.setOffset(new THREE.Vector3(50, 8, -50), new THREE.Vector3(4, 0, -3));
    expect(rig.focusFor(new THREE.Vector3(4, 0, -3), out).toArray()).toEqual([10, 0, -10]);

    rig.zoomBy(-200, 13);
    rig.setContext("europa", null);
    expect(rig.focusFor(new THREE.Vector3(1, 0, 2), out).toArray()).toEqual([1, 0, 2]);
    expect(rig.viewFor(13)).toBe(13);
  });

  test("an explicit run reset clears framing even when the world is unchanged", () => {
    const rig = new CameraRig(20);
    const anchor = new THREE.Vector3(2, 0, -1);
    const out = new THREE.Vector3();
    rig.setContext("mars", null);
    rig.setOffset(new THREE.Vector3(7, 0, 4), anchor);
    rig.zoomBy(-300, 13);

    rig.reset();
    rig.setContext("mars", null);
    expect(rig.focusFor(anchor, out).toArray()).toEqual([2, 0, -1]);
    expect(rig.viewFor(13)).toBe(13);
  });
});
