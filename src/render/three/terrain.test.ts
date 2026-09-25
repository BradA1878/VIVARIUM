import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GRID_N } from "@/engine/tuning";
import { CELL, GridSpace, SCENIC_MARGIN } from "./coords";
import { FAR_EDGE, Terrain, farRockCount } from "./terrain";
import { worldLook } from "./worldlook";

const WORLDS = ["mars", "ceres", "io", "titan"] as const;

function ground(terrain: Terrain): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial> {
  return terrain.group.children[0] as THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
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
  it("keeps a 1-unit mesh out to the far field while exposing 41×41 cells", () => {
    const grid = new GridSpace(GRID_N);
    const terrain = new Terrain(grid);
    const segs = (2 * FAR_EDGE) / CELL;
    expect(GRID_N).toBe(41);
    expect(SCENIC_MARGIN).toBe(2);
    expect(terrain.surfaceHalfSpan).toBe(FAR_EDGE);
    expect(ground(terrain).geometry.getAttribute("position").count).toBe((segs + 1) ** 2);
    expect(ground(terrain).geometry.index!.count).toBe(segs ** 2 * 6);
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
});
