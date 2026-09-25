/* ============================================================================
   View-fitted sun shadows. The old rig stretched one shadow map over the whole
   terrain (~6.6 cm of ground per texel), so shadows blurred. fitShadow() wraps
   the map around what the orthographic camera can see — the ground and
   everything up to the tallest structure — squared and rounded to fixed size
   steps so zooming doesn't change sharpness, and snapped to whole texels in
   the sun's frame so panning doesn't make edges crawl. Pure math on three's
   vector types (no renderer, no scene), so it is unit-tested directly.
   ============================================================================ */
import * as THREE from "three";

/** tallest thing that casts or receives shadow in view (world units) */
export const SHADOW_CEILING = 5;
/** padding around the visible slab (world units) */
export const SHADOW_PAD = 1.5;
/** the square box side is rounded up to a multiple of this (world units) */
export const SHADOW_SIZE_STEP = 2;
/** how far up the sun direction the light sits from the fitted center */
export const SHADOW_LIGHT_DISTANCE = 100;

/** an orthographic view: position, unit basis, and frustum extents */
export interface OrthoView {
  position: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  /** unit view direction; y < 0 for a camera looking down at the colony */
  forward: THREE.Vector3;
  left: number;
  rightEdge: number;
  top: number;
  bottom: number;
}

export interface ShadowFit {
  /** world point the light looks at (the box center) */
  center: THREE.Vector3;
  /** world light position: center + sunDir · SHADOW_LIGHT_DISTANCE */
  lightPosition: THREE.Vector3;
  /** up vector the shadow camera needs so its frame matches the snapped basis */
  up: THREE.Vector3;
  /** half the square side: shadow camera left/right/top/bottom = ∓/± this */
  halfSize: number;
  near: number;
  far: number;
  /** world units per shadow texel */
  texel: number;
  /** the center in light-basis coordinates (x/y snapped to whole texels) */
  lightX: number;
  lightY: number;
  lightZ: number;
}

const Y_UP = new THREE.Vector3(0, 1, 0);
const Z_UP = new THREE.Vector3(0, 0, 1);

export function emptyOrthoView(): OrthoView {
  return {
    position: new THREE.Vector3(), right: new THREE.Vector3(1, 0, 0),
    up: new THREE.Vector3(0, 1, 0), forward: new THREE.Vector3(0, 0, -1),
    left: -1, rightEdge: 1, top: 1, bottom: -1,
  };
}

export function emptyShadowFit(): ShadowFit {
  return {
    center: new THREE.Vector3(), lightPosition: new THREE.Vector3(), up: new THREE.Vector3(0, 1, 0),
    halfSize: 1, near: 0.5, far: 1, texel: 1, lightX: 0, lightY: 0, lightZ: 0,
  };
}

/** read an OrthographicCamera's world frame + effective extents (zoom applied) */
export function orthoViewOf(camera: THREE.OrthographicCamera, out: OrthoView = emptyOrthoView()): OrthoView {
  camera.updateMatrixWorld();
  const e = camera.matrixWorld.elements;
  const zoom = camera.zoom || 1;
  const cx = (camera.left + camera.right) / 2;
  const cy = (camera.top + camera.bottom) / 2;
  const hw = (camera.right - camera.left) / (2 * zoom);
  const hh = (camera.top - camera.bottom) / (2 * zoom);
  out.position.setFromMatrixPosition(camera.matrixWorld);
  out.right.set(e[0], e[1], e[2]).normalize();
  out.up.set(e[4], e[5], e[6]).normalize();
  out.forward.set(-e[8], -e[9], -e[10]).normalize();
  out.left = cx - hw;
  out.rightEdge = cx + hw;
  out.top = cy + hh;
  out.bottom = cy - hh;
  return out;
}

/** the view's four corner rays cut at the ground (y = 0) and at the ceiling,
 *  as ground/ceiling pairs per corner. Runs every frame, so with `out` passed
 *  it creates no arrays or iterators: index bits pick the corner (4: right
 *  edge, 2: top) and the height (1: ceiling). */
export function viewSlabPoints(
  view: OrthoView,
  ceiling = SHADOW_CEILING,
  out: THREE.Vector3[] = Array.from({ length: 8 }, () => new THREE.Vector3()),
): THREE.Vector3[] {
  const fy = view.forward.y;
  for (let i = 0; i < 8; i++) {
    const sx = i & 4 ? view.rightEdge : view.left;
    const sy = i & 2 ? view.top : view.bottom;
    const h = i & 1 ? ceiling : 0;
    const p = out[i];
    p.copy(view.position).addScaledVector(view.right, sx).addScaledVector(view.up, sy);
    const t = Math.abs(fy) < 1e-6 ? 0 : (h - p.y) / fy;
    p.addScaledVector(view.forward, t);
  }
  return out;
}

/** writes the frame three's Object3D.lookAt builds for a camera at +z looking
 *  back along it (x = up × z, y = z × x), with a Z-up fallback near vertical */
function basisInto(sunDir: THREE.Vector3, x: THREE.Vector3, y: THREE.Vector3, z: THREE.Vector3, up: THREE.Vector3): void {
  z.copy(sunDir).normalize();
  up.copy(Math.abs(z.y) > 0.99 ? Z_UP : Y_UP);
  x.crossVectors(up, z).normalize();
  y.crossVectors(z, x);
}

/** the light basis for a sun direction (allocates — tests and one-offs) */
export function lightBasis(sunDir: THREE.Vector3): { x: THREE.Vector3; y: THREE.Vector3; z: THREE.Vector3; up: THREE.Vector3 } {
  const b = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3(), up: new THREE.Vector3() };
  basisInto(sunDir, b.x, b.y, b.z, b.up);
  return b;
}

const _pts = Array.from({ length: 8 }, () => new THREE.Vector3());
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/** fit a square, texel-snapped shadow box around the visible slab */
export function fitShadow(
  view: OrthoView,
  sunDir: THREE.Vector3,
  mapSize: number,
  out: ShadowFit = emptyShadowFit(),
  ceiling = SHADOW_CEILING,
): ShadowFit {
  basisInto(sunDir, _x, _y, _z, out.up);
  viewSlabPoints(view, ceiling, _pts);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < _pts.length; i++) {
    const p = _pts[i];
    const px = p.dot(_x), py = p.dot(_y), pz = p.dot(_z);
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz;
    if (pz > maxZ) maxZ = pz;
  }
  const side = Math.max(maxX - minX, maxY - minY) + 2 * SHADOW_PAD;
  const size = Math.ceil(side / SHADOW_SIZE_STEP) * SHADOW_SIZE_STEP;
  const texel = size / mapSize;
  out.texel = texel;
  out.halfSize = size / 2;
  out.lightX = Math.round((minX + maxX) / 2 / texel) * texel;
  out.lightY = Math.round((minY + maxY) / 2 / texel) * texel;
  out.lightZ = (minZ + maxZ) / 2;
  out.center.set(0, 0, 0)
    .addScaledVector(_x, out.lightX)
    .addScaledVector(_y, out.lightY)
    .addScaledVector(_z, out.lightZ);
  out.lightPosition.copy(out.center).addScaledVector(_z, SHADOW_LIGHT_DISTANCE);
  // casters up to the ceiling that shadow the view can sit toward the sun, past
  // the slab: a grazing sun reaches ceiling / sin(elevation) sideways
  const towardSun = ceiling / Math.max(0.1, _z.y);
  out.near = Math.max(0.5, SHADOW_LIGHT_DISTANCE - (maxZ - out.lightZ) - towardSun - 2);
  out.far = SHADOW_LIGHT_DISTANCE + (out.lightZ - minZ) + 2;
  return out;
}
