import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GRID_N } from "@/engine/tuning";
import { CAMERA_ISO_OFFSET, CAMERA_MAX_VIEW } from "./camera-controls";
import { CELL, GridSpace, SCENIC_MARGIN } from "./coords";
import { GROUND_DETAIL_KEY } from "./ground-shader";
import { EDGE_HAZE_START, FAR_EDGE, Terrain, farRockCount } from "./terrain";
import { worldLook } from "./worldlook";

/** Unproject a screen-space corner at both the near and far clip planes to get
 *  its world-space ray, then intersect that ray with y = 0 — the ground the
 *  far field must cover out to FAR_EDGE / EDGE_HAZE_START. */
function groundHit(camera: THREE.OrthographicCamera, sx: number, sy: number): THREE.Vector3 {
  const near = new THREE.Vector3(sx, sy, -1).unproject(camera);
  const far = new THREE.Vector3(sx, sy, 1).unproject(camera);
  const dir = far.sub(near);
  const t = -near.y / dir.y;
  return near.addScaledVector(dir, t);
}

/** Farthest ground point any screen corner reaches, over every focus the pan
 *  clamp allows, at full zoom-out. */
function maxScreenReach(aspect: number): number {
  const view = CAMERA_MAX_VIEW;
  const camera = new THREE.OrthographicCamera(-view * aspect, view * aspect, view, -view, 0.1, 500);
  const half = new GridSpace(GRID_N).half();
  const offset = new THREE.Vector3(...CAMERA_ISO_OFFSET);
  let reach = 0;
  for (const fx of [-half, half]) {
    for (const fz of [-half, half]) {
      const focus = new THREE.Vector3(fx, 0, fz);
      camera.position.copy(focus).add(offset);
      camera.lookAt(focus);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const hit = groundHit(camera, sx, sy);
          reach = Math.max(reach, Math.abs(hit.x), Math.abs(hit.z));
        }
      }
    }
  }
  return reach;
}

const WORLDS = ["mars", "ceres", "io", "titan"] as const;

function ground(terrain: Terrain): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
  return terrain.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
}

/** scenic rocks and monoliths — the pebble field is deliberately inside the
 *  build area (structures cover it), so it is checked separately */
function decorations(terrain: Terrain): THREE.InstancedMesh[] {
  return terrain.group.children.filter((child): child is THREE.InstancedMesh =>
    child instanceof THREE.InstancedMesh && child.name !== "pebbles");
}

/** Inspect actual transformed vertices, independently of the placement check's
 *  conservative transformed geometry bounding box. Tall leaning tops count. */
function assertSceneryClear(terrain: Terrain, grid: GridSpace): void {
  const matrix = new THREE.Matrix4();
  const vertex = new THREE.Vector3();
  for (const mesh of decorations(terrain)) {
    const positions = mesh.geometry.getAttribute("position");
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      const bounds = new THREE.Box3();
      for (let j = 0; j < positions.count; j++) {
        vertex.fromBufferAttribute(positions, j).applyMatrix4(matrix);
        bounds.expandByPoint(vertex);
      }
      const half = grid.half();
      const overlapsConstruction = bounds.max.x > -half && bounds.min.x < half
        && bounds.max.z > -half && bounds.min.z < half;
      expect(overlapsConstruction, `${mesh.name} instance ${i} overlaps construction`).toBe(false);
      expect(bounds.min.x).toBeGreaterThan(-terrain.surfaceHalfSpan);
      expect(bounds.min.z).toBeGreaterThan(-terrain.surfaceHalfSpan);
      expect(bounds.max.x).toBeLessThan(terrain.surfaceHalfSpan);
      expect(bounds.max.z).toBeLessThan(terrain.surfaceHalfSpan);
    }
  }
}

describe("expanded construction terrain", () => {
  it("keeps a 1-unit mesh out to the far field while exposing 41×41 cells", () => {
    const grid = new GridSpace(GRID_N);
    const terrain = new Terrain(grid);
    const segs = (2 * FAR_EDGE) / CELL;
    expect(GRID_N).toBe(41);
    expect(SCENIC_MARGIN).toBe(2);
    expect(terrain.surfaceHalfSpan).toBe(FAR_EDGE);
    expect(ground(terrain).geometry.getAttribute("position").count).toBe((segs + 1) ** 2);
    expect(ground(terrain).geometry.index!.count).toBe(segs ** 2 * 6);
    // ground, scenic rocks, monoliths, pebbles
    expect(terrain.group.children).toHaveLength(4);
    const pebbles = terrain.group.getObjectByName("pebbles") as THREE.InstancedMesh;
    expect(pebbles.count).toBeGreaterThan(0);
    expect(pebbles.castShadow).toBe(false);
    terrain.dispose();
  });

  it.each(WORLDS)("keeps %s construction corners shallow and the shortened scenic border finite", (world) => {
    const grid = new GridSpace(GRID_N);
    const relief = worldLook(world).relief;
    // The retained three-octave base has total amplitude 1.05; none of the
    // scenic ridge contribution may reach the playable triangles.
    const interiorLimit = 0.15 * (0.55 * relief.noise + 0.5 * relief.dune) + 1e-6;
    for (const margin of [0, 1, SCENIC_MARGIN, 4]) {
      const terrain = new Terrain(grid, world, margin);
      const geometry = ground(terrain).geometry;
      for (const attribute of Object.values(geometry.attributes)) {
        expect(Array.from(attribute.array).every(Number.isFinite)).toBe(true);
      }
      const positions = geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), z = positions.getZ(i);
        if (Math.max(Math.abs(x), Math.abs(z)) <= grid.half()) {
          expect(Math.abs(positions.getY(i))).toBeLessThanOrEqual(interiorLimit);
        }
      }
      for (const x of [-grid.half(), 0, grid.half()]) {
        for (const z of [-grid.half(), 0, grid.half()]) {
          expect(Math.abs(terrain.heightAt(x, z))).toBeLessThanOrEqual(interiorLimit);
        }
      }
      assertSceneryClear(terrain, grid);
      terrain.dispose();
    }
  });

  it.each(WORLDS)("keeps complete %s decorative silhouettes outside construction with repeatable placement", (world) => {
    const grid = new GridSpace(GRID_N);
    const first = new Terrain(grid, world);
    const repeat = new Terrain(grid, world);
    assertSceneryClear(first, grid);
    const look = worldLook(world);
    const meshes = decorations(first), copies = decorations(repeat);
    expect(meshes).toHaveLength(2);
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      expect(mesh.count).toBe(i === 0 ? farRockCount(look) : look.monoliths.count * 3);
      expect(copies[i].count).toBe(mesh.count);
      expect(copies[i].instanceMatrix.array).toEqual(mesh.instanceMatrix.array);
    }
    first.dispose(); repeat.dispose();
  });

  it.each(WORLDS)("keeps %s ridged relief continuing across the far field", (world) => {
    const grid = new GridSpace(GRID_N);
    const terrain = new Terrain(grid, world);
    const threshold = grid.half() + SCENIC_MARGIN + 1;
    const positions = ground(terrain).geometry.getAttribute("position");
    let maxHeight = -Infinity;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i);
      if (Math.max(Math.abs(x), Math.abs(z)) > threshold) maxHeight = Math.max(maxHeight, positions.getY(i));
    }
    expect(maxHeight).toBeGreaterThanOrEqual(0.6 * worldLook(world).relief.ridge);
    terrain.dispose();
  });

  it("disposes everything it built", () => {
    const grid = new GridSpace(GRID_N);
    const terrain = new Terrain(grid);
    const groundMesh = ground(terrain);
    const [rocks, monoliths] = decorations(terrain);
    const spies = [
      vi.spyOn(groundMesh.geometry, "dispose"),
      vi.spyOn(groundMesh.material, "dispose"),
      vi.spyOn(groundMesh.material.bumpMap!, "dispose"),
      vi.spyOn(rocks.geometry, "dispose"),
      vi.spyOn(rocks.material as THREE.Material, "dispose"),
      vi.spyOn(monoliths.geometry, "dispose"),
      vi.spyOn(monoliths.material as THREE.Material, "dispose"),
    ];
    terrain.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledTimes(1);
  });

  it("covers the screen at full zoom-out and full pan, with haze only on wider-than-16:9 screens", () => {
    expect(maxScreenReach(16 / 9)).toBeLessThanOrEqual(EDGE_HAZE_START);
    expect(maxScreenReach(2.4)).toBeLessThan(FAR_EDGE);
  });

  it("carries the edge-haze injection on the ground material", () => {
    const grid = new GridSpace(GRID_N);
    const terrain = new Terrain(grid);
    const mat = ground(terrain).material;
    expect(mat.customProgramCacheKey()).toBe(GROUND_DETAIL_KEY);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toMatch(/#include <color_fragment>\s*[\s\S]*diffuseColor\.rgb \*= clamp\(1\.0 \+ tone/);
    expect(shader.fragmentShader).toMatch(/#include <fog_fragment>\s*[\s\S]*edgeHaze/);
    const haze = shader.uniforms.uEdgeHaze.value as THREE.Vector2;
    expect(haze.x).toBe(EDGE_HAZE_START);
    expect(haze.y).toBe(FAR_EDGE - 0.5);
    terrain.dispose();
  });
});
