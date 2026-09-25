import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  SHADOW_CEILING, SHADOW_LIGHT_DISTANCE, SHADOW_SIZE_STEP,
  fitShadow, lightBasis, orthoViewOf, viewSlabPoints,
} from "./shadow-fit";

const ISO = new THREE.Vector3(28, 26, 28); // scene.ts isoOffset

/** the camera scene.ts setView builds */
function isoCamera(focus: THREE.Vector3, view: number, aspect = 1.6): THREE.OrthographicCamera {
  const cam = new THREE.OrthographicCamera(-view * aspect, view * aspect, view, -view, 0.1, 200);
  cam.position.copy(focus).add(ISO);
  cam.lookAt(focus);
  cam.updateMatrixWorld();
  return cam;
}

function sunFor(tod: number): THREE.Vector3 {
  const ang = (tod - 0.5) * Math.PI * 2;
  const elev = Math.cos(ang);
  return new THREE.Vector3(Math.sin(ang) * 30 + 6, Math.max(-6, elev * 34) + 6, 18).normalize();
}

describe("fitShadow", () => {
  const focuses = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(-18, 0, -18), new THREE.Vector3(20, 0, -20), new THREE.Vector3(7.5, 0, 19)];
  const views = [3, 6.5, 13, 22];
  const tods = [0.26, 0.3, 0.5, 0.7, 0.74, 0.9];

  it("covers every visible point from the ground to the ceiling, at every pan, zoom and sun angle", () => {
    for (const focus of focuses) for (const view of views) for (const tod of tods) {
      const v = orthoViewOf(isoCamera(focus, view));
      const sun = sunFor(tod);
      const fit = fitShadow(v, sun, 2048);
      const b = lightBasis(sun);
      for (const p of viewSlabPoints(v)) {
        expect(Math.abs(p.dot(b.x) - fit.lightX)).toBeLessThanOrEqual(fit.halfSize);
        expect(Math.abs(p.dot(b.y) - fit.lightY)).toBeLessThanOrEqual(fit.halfSize);
        const depth = SHADOW_LIGHT_DISTANCE - (p.dot(b.z) - fit.lightZ);
        expect(depth).toBeGreaterThanOrEqual(fit.near);
        expect(depth).toBeLessThanOrEqual(fit.far);
      }
    }
  });

  it("puts the light at the center, up the sun direction, and matches three's lookAt frame", () => {
    const sun = sunFor(0.4);
    const fit = fitShadow(orthoViewOf(isoCamera(new THREE.Vector3(), 13)), sun, 2048);
    const toLight = fit.lightPosition.clone().sub(fit.center);
    expect(toLight.length()).toBeCloseTo(SHADOW_LIGHT_DISTANCE, 6);
    expect(toLight.normalize().angleTo(sun)).toBeLessThan(1e-9);
    // a camera placed by the scene the same way sees the center at its origin
    const cam = new THREE.OrthographicCamera();
    cam.up.copy(fit.up);
    cam.position.copy(fit.lightPosition);
    cam.lookAt(fit.center);
    cam.updateMatrixWorld();
    const local = fit.center.clone().applyMatrix4(cam.matrixWorldInverse);
    expect(Math.abs(local.x)).toBeLessThan(1e-6);
    expect(Math.abs(local.y)).toBeLessThan(1e-6);
  });

  it("snaps the box to whole texels and rounds its size to fixed steps", () => {
    const sun = sunFor(0.45);
    const fit = fitShadow(orthoViewOf(isoCamera(new THREE.Vector3(1.234, 0, -3.21), 13)), sun, 2048);
    expect((fit.halfSize * 2) % SHADOW_SIZE_STEP).toBe(0);
    expect(fit.texel).toBeCloseTo((fit.halfSize * 2) / 2048, 12);
    expect(Math.abs(fit.lightX / fit.texel - Math.round(fit.lightX / fit.texel))).toBeLessThan(1e-6);
    expect(Math.abs(fit.lightY / fit.texel - Math.round(fit.lightY / fit.texel))).toBeLessThan(1e-6);
  });

  it("moves in whole texels when the camera pans by less than one", () => {
    const sun = sunFor(0.45);
    const a = fitShadow(orthoViewOf(isoCamera(new THREE.Vector3(0, 0, 0), 13)), sun, 2048);
    const nudge = lightBasis(sun).x.multiplyScalar(a.texel * 0.3);
    const b = fitShadow(orthoViewOf(isoCamera(nudge, 13)), sun, 2048);
    expect(b.halfSize).toBe(a.halfSize);
    const steps = (b.lightX - a.lightX) / a.texel;
    expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
    expect(Math.abs(Math.round(steps))).toBeLessThanOrEqual(1);
  });

  it("small zoom changes keep the box size", () => {
    // at the noon sun the unrounded side runs 64.8–65.2 for these views, clear of
    // the 2-unit steps at 64 and 66 (at tod 0.45 this range straddles 72)
    const sun = sunFor(0.5);
    const focus = new THREE.Vector3(2, 0, -1);
    const sizes = [13.0, 13.05, 13.1].map((view) => fitShadow(orthoViewOf(isoCamera(focus, view)), sun, 2048).halfSize);
    expect(sizes).toEqual([sizes[0], sizes[0], sizes[0]]);
  });

  it("is at least twice as sharp as the old whole-terrain map at default zoom", () => {
    const fit = fitShadow(orthoViewOf(isoCamera(new THREE.Vector3(), 13)), sunFor(0.5), 2048);
    const oldTexel = (2 * (22.5 * Math.SQRT2 + 2)) / 1024; // scene.ts's previous fixed frustum
    expect(fit.texel).toBeLessThan(oldTexel / 2);
  });

  it("stays finite for a near-vertical or grazing sun", () => {
    const v = orthoViewOf(isoCamera(new THREE.Vector3(), 13));
    for (const sun of [new THREE.Vector3(0, 1, 1e-5).normalize(), new THREE.Vector3(1, 0, 0.2).normalize()]) {
      const fit = fitShadow(v, sun, 1024);
      for (const n of [fit.halfSize, fit.near, fit.far, fit.texel, fit.lightX, fit.lightY, fit.center.x, fit.center.y, fit.center.z]) {
        expect(Number.isFinite(n)).toBe(true);
      }
      expect(fit.near).toBeGreaterThan(0);
      expect(fit.far).toBeGreaterThan(fit.near);
    }
  });

  it("reuses the output object without allocating a new one", () => {
    const v = orthoViewOf(isoCamera(new THREE.Vector3(), 13));
    const out = fitShadow(v, sunFor(0.5), 2048);
    const again = fitShadow(v, sunFor(0.52), 2048, out);
    expect(again).toBe(out);
    expect(again.center).toBe(out.center);
  });

  it("slab points sit on the ground and at the ceiling", () => {
    const pts = viewSlabPoints(orthoViewOf(isoCamera(new THREE.Vector3(), 13)));
    expect(pts).toHaveLength(8);
    expect(pts.filter((p) => Math.abs(p.y) < 1e-9)).toHaveLength(4);
    expect(pts.filter((p) => Math.abs(p.y - SHADOW_CEILING) < 1e-9)).toHaveLength(4);
  });

  it("slab points are the view's four corner rays, each cut at the ground and at the ceiling", () => {
    const v = orthoViewOf(isoCamera(new THREE.Vector3(3, 0, -2), 13));
    const d = new THREE.Vector3();
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
    const labels = viewSlabPoints(v).map((p) => {
      d.copy(p).sub(v.position);
      const sx = d.dot(v.right);
      const sy = d.dot(v.up);
      const x = near(sx, v.left) ? "left" : near(sx, v.rightEdge) ? "right" : `x=${sx}`;
      const y = near(sy, v.bottom) ? "bottom" : near(sy, v.top) ? "top" : `y=${sy}`;
      const h = near(p.y, 0) ? "ground" : near(p.y, SHADOW_CEILING) ? "ceiling" : `h=${p.y}`;
      return `${x} ${y} ${h}`;
    });
    expect(labels.sort()).toEqual([
      "left bottom ceiling", "left bottom ground", "left top ceiling", "left top ground",
      "right bottom ceiling", "right bottom ground", "right top ceiling", "right top ground",
    ]);
  });
});
