import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GRID_N } from "@/engine/tuning";
import { CELL, GridSpace, SCENIC_MARGIN } from "./coords";
import { Terrain } from "./terrain";
import { worldLook } from "./worldlook";

const WORLDS = ["mars", "ceres", "io", "titan"] as const;

function ground(terrain: Terrain): THREE.Mesh<THREE.PlaneGeometry> {
  return terrain.group.children[0] as THREE.Mesh<THREE.PlaneGeometry>;
}

function decorations(terrain: Terrain): THREE.InstancedMesh[] {
  return terrain.group.children.filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh);
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
  it("keeps the established 45×45 surface and mesh density while exposing 41×41 cells", () => {
    const grid = new GridSpace(GRID_N);
    const terrain = new Terrain(grid);
    expect(GRID_N).toBe(41);
    expect(SCENIC_MARGIN).toBe(2);
    expect(terrain.surfaceHalfSpan * 2).toBe(45 * CELL);
    expect(ground(terrain).geometry.getAttribute("position").count).toBe(46 * 46);
    expect(ground(terrain).geometry.index!.count).toBe(45 * 45 * 6);
    expect(terrain.group.children).toHaveLength(3);
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
      if (margin === 0) expect(decorations(terrain).every((mesh) => mesh.count === 0)).toBe(true);
      terrain.dispose();
    }
  });

  it.each(WORLDS)("keeps complete %s decorative silhouettes outside construction with repeatable placement", (world) => {
    const grid = new GridSpace(GRID_N);
    const first = new Terrain(grid, world);
    const repeat = new Terrain(grid, world);
    assertSceneryClear(first, grid);
    const meshes = decorations(first), copies = decorations(repeat);
    expect(meshes).toHaveLength(2);
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i];
      const expectedRocks = Math.round(worldLook(world).rocks.count * (1 - (grid.half() / first.surfaceHalfSpan) ** 2));
      expect(mesh.count).toBe(i === 0 ? expectedRocks : worldLook(world).monoliths.count);
      expect(copies[i].count).toBe(mesh.count);
      expect(copies[i].instanceMatrix.array).toEqual(mesh.instanceMatrix.array);
    }
    first.dispose(); repeat.dispose();
  });
});
