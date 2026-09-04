import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { DEFS } from "@/engine/defs";
import { GridSpace } from "./coords";
import { Terrain } from "./terrain";
import { GroundDetails, groundPatchGeometry } from "./ground-details";

describe("ground surface details", () => {
  it("shares the rendered terrain triangles on every world, including between noise samples", () => {
    for (const world of ["mars", "ceres", "io", "titan"] as const) {
      const terrain = new Terrain(new GridSpace(25), world);
      const ground = terrain.group.children[0];
      ground.updateMatrixWorld(true);
      const geometry = groundPatchGeometry([
        { x: 2.13, z: -3.27, rx: 1.4, rz: 0.8, angle: Math.PI / 2, color: new THREE.Color("white") },
      ], terrain);
      const positions = geometry.getAttribute("position");
      const ray = new THREE.Raycaster();
      for (let i = 0; i < positions.count; i += 3) {
        const center = new THREE.Vector3();
        for (let j = 0; j < 3; j++) center.add(new THREE.Vector3().fromBufferAttribute(positions, i + j));
        center.divideScalar(3);
        ray.set(new THREE.Vector3(center.x, 20, center.z), new THREE.Vector3(0, -1, 0));
        const hit = ray.intersectObject(ground)[0];
        expect(hit).toBeDefined();
        expect(center.y).toBeCloseTo(hit.point.y, 6);
        expect(terrain.heightAt(center.x, center.z)).toBeCloseTo(hit.point.y, 6);
      }
      geometry.dispose();
      terrain.dispose();
    }
  });

  it("keeps night updates cheap, follows transforms, and retires offline/removed spill", () => {
    const terrain = new Terrain(new GridSpace(25));
    const details = new GroundDetails();
    const building = new THREE.Group();
    const door = new THREE.Object3D();
    door.position.z = 1;
    door.userData.groundLight = 0x7fd4e8;
    building.add(door);
    const seen = new Set([1]);
    details.syncBuilding(1, DEFS.hub, building, true);
    details.update(seen, terrain, "mars", 0);
    const spill = details.group.getObjectByName("night-spill") as THREE.Mesh;
    expect(spill.visible).toBe(false);
    const first = spill.geometry;
    const disposed = vi.fn(); first.addEventListener("dispose", disposed);
    details.update(seen, terrain, "mars", 1);
    expect(spill.visible).toBe(true);
    expect(spill.geometry).toBe(first);
    // A rotation + move must rebuild positions/UVs, rather than leaving a light
    // at the door's old world-space position.
    building.position.set(5, 0, 4);
    building.rotation.y = Math.PI / 2;
    details.syncBuilding(1, DEFS.hub, building, true);
    details.update(seen, terrain, "mars", 1);
    expect(disposed).toHaveBeenCalledOnce();
    expect(spill.geometry.boundingSphere!.center.x).toBeGreaterThan(5);
    const contact = details.group.getObjectByName("contact-shadows") as THREE.Mesh;
    const contactGeometry = contact.geometry;
    details.syncBuilding(1, DEFS.hub, building, false);
    details.update(seen, terrain, "mars", 1);
    expect(spill.visible).toBe(false);
    expect(spill.geometry.getAttribute("position").count).toBe(0);
    expect(contact.geometry).toBe(contactGeometry);
    details.update(new Set(), terrain, "mars", 1);
    for (const mesh of details.group.children as THREE.Mesh[]) {
      expect(mesh.visible).toBe(false);
      expect(mesh.geometry.getAttribute("position").count).toBe(0);
    }
    details.dispose(); terrain.dispose();
  });
});
