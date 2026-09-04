import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { createMaterials } from "./materials";
import { createSurfaceDetail } from "./surface-detail";
import { Terrain } from "./terrain";
import { GridSpace } from "./coords";
import { worldLook } from "./worldlook";

function greenMean(texture: THREE.DataTexture): number {
  const data = texture.image.data as Uint8Array;
  let total = 0;
  for (let i = 1; i < data.length; i += 4) total += data[i];
  return total / (data.length / 4 * 255);
}

describe("restrained surface detail", () => {
  it("repeats seeded data without DOM assets, and filters it away at distance", () => {
    for (const kind of ["metal", "soil"] as const) {
      const first = createSurfaceDetail(kind, 123);
      const repeat = createSurfaceDetail(kind, 123);
      const other = createSurfaceDetail(kind, 124);
      expect(first.texture.image.data).toEqual(repeat.texture.image.data);
      expect(first.texture.image.data).not.toEqual(other.texture.image.data);
      expect(first.roughnessMean).toBe(greenMean(first.texture));
      expect(first.texture.colorSpace).toBe(THREE.NoColorSpace);
      expect(first.texture.wrapS).toBe(THREE.RepeatWrapping);
      expect(first.texture.wrapT).toBe(THREE.RepeatWrapping);
      expect(first.texture.minFilter).toBe(THREE.LinearMipmapLinearFilter);
      expect(first.texture.magFilter).toBe(THREE.LinearFilter);
      expect(first.texture.generateMipmaps).toBe(true);
      first.texture.dispose(); repeat.texture.dispose(); other.texture.dispose();
    }
  });

  it("shares metal/dome finish while preserving mean roughness and base colors", () => {
    const materials = createMaterials();
    const metal = materials.metal();
    const trim = materials.metal("#5a626c", { rough: 0.5, metal: 0.8 });
    const dome = materials.frostedDome();
    const map = metal.roughnessMap as THREE.DataTexture;
    expect(map).toBeInstanceOf(THREE.DataTexture);
    expect(trim.roughnessMap).toBe(map);
    expect(dome.roughnessMap).toBe(map);
    const mean = greenMean(map);
    for (const [material, roughness, color] of [
      [metal, 0.62, "#7a828c"], [trim, 0.5, "#5a626c"], [dome, 0.4, "#787f8a"],
    ] as const) {
      expect(material.roughness * mean).toBeCloseTo(roughness, 12);
      expect(material.roughness).toBeLessThanOrEqual(1);
      expect(material.color.equals(new THREE.Color(color))).toBe(true);
      expect(material.map).toBeNull();
    }
    expect(dome.opacity).toBe(0.92);
    expect(dome.metalness).toBe(0.35);
    const disposed = vi.fn();
    map.addEventListener("dispose", disposed);
    metal.dispose(); trim.dispose(); dome.dispose();
    expect(disposed).not.toHaveBeenCalled();
    materials.dispose();
    expect(disposed).toHaveBeenCalledOnce();
  });

  it("keeps fully matte surfaces and signal materials unchanged", () => {
    const materials = createMaterials();
    const matte = materials.metal("#7a828c", { rough: 1 });
    const panel = materials.panel();
    const glow = materials.glow();
    expect(matte.roughness).toBe(1);
    expect(matte.roughnessMap).toBeNull();
    expect(panel.roughness).toBe(0.22);
    expect(panel.roughnessMap).toBeNull();
    expect(glow.roughnessMap).toBeNull();
    expect(glow.emissiveIntensity).toBe(0.9);
    matte.dispose(); panel.dispose(); glow.dispose(); materials.dispose();
  });

  it("preserves each world's palette and mean finish, and owns the packed soil map once", () => {
    for (const world of ["mars", "ceres", "io", "titan"] as const) {
      const terrain = new Terrain(new GridSpace(25), world);
      const ground = terrain.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      const { material } = ground;
      const map = material.bumpMap as THREE.DataTexture;
      const look = worldLook(world);
      expect(material.roughnessMap).toBe(map);
      expect(material.roughness * greenMean(map)).toBeCloseTo(look.mat.rough, 12);
      expect(material.roughness).toBeLessThanOrEqual(1);
      expect(material.color.getHex()).toBe(0xffffff);
      expect(material.vertexColors).toBe(true);
      expect(material.map).toBeNull();
      expect(material.emissive.equals(new THREE.Color(look.ground.accent))).toBe(true);
      expect(material.emissiveIntensity).toBe(look.mat.emissive);
      expect(material.displacementMap).toBeNull();
      expect(material.bumpScale).toBe(0.02);
      const disposed = vi.fn();
      map.addEventListener("dispose", disposed);
      terrain.dispose();
      expect(disposed).toHaveBeenCalledOnce();
    }
  });

  it("anchors soil ripples to the same world coordinates across grid and margin sizes", () => {
    const terrains = [new Terrain(new GridSpace(25)), new Terrain(new GridSpace(31), "mars", 14)];
    const coordinates = terrains.map((terrain) => {
      const ground = terrain.group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
      const texture = ground.material.bumpMap!;
      const half = terrain.surfaceHalfSpan;
      const uv = new THREE.Vector2((2.3 + half) / (2 * half), (half + 4.8) / (2 * half));
      texture.updateMatrix();
      texture.transformUv(uv);
      expect(2 * half / texture.repeat.x).toBe(8);
      expect(2 * half / texture.repeat.y).toBe(8);
      return uv;
    });
    expect(coordinates[0].x).toBeCloseTo(coordinates[1].x, 12);
    expect(coordinates[0].y).toBeCloseTo(coordinates[1].y, 12);
    for (const terrain of terrains) terrain.dispose();
  });
});
