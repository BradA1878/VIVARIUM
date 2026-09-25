import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFS } from "@/engine";
import { createMaterials } from "../materials";
import { buildKitMesh } from "./index";

function materialsOf(obj: THREE.Object3D): THREE.MeshStandardMaterial[] {
  const out: THREE.MeshStandardMaterial[] = [];
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material;
    for (const x of Array.isArray(m) ? m : m ? [m] : []) if ((x as THREE.MeshStandardMaterial).isMeshStandardMaterial) out.push(x as THREE.MeshStandardMaterial);
  });
  return out;
}

describe("kit finish", () => {
  const lib = createMaterials();
  it("solar arrays show the PV cell map and no separate seam strips", () => {
    const mesh = buildKitMesh(DEFS.solar, 1, lib);
    const mats = materialsOf(mesh.object);
    expect(mats.some((m) => m.map)).toBe(true);
    expect(mats.some((m) => m.color.getHex() === 0x0b1019)).toBe(false);
    mesh.dispose();
  });
  it("domes use the paneled shell and light double-sided dishes", () => {
    for (const id of ["hub", "hab", "greenhouse"] as const) {
      for (let uid = 1; uid <= 12; uid++) {
        const mesh = buildKitMesh(DEFS[id], uid, lib);
        const mats = materialsOf(mesh.object);
        expect(mats.some((m) => m.bumpMap && m.transparent)).toBe(true);
        expect(mats.some((m) => m.map)).toBe(false); // no PV map on domes
        mesh.dispose();
      }
    }
  });
  it("corridor skins are nearly opaque so they read as hull and occlude AO", () => {
    const mesh = buildKitMesh(DEFS.corridor, 3, lib);
    mesh.setNeighbors!(0b0101);
    const skins = materialsOf(mesh.object).filter((m) => m.transparent);
    expect(skins.length).toBeGreaterThan(0);
    for (const m of skins) expect(m.opacity).toBeGreaterThanOrEqual(0.85);
    mesh.dispose();
  });
  it("the robotics bay and printer read as steel, with a safety-yellow trim on the gantry", () => {
    const bay = materialsOf(buildKitMesh(DEFS.roboticsbay, 4, lib).object);
    expect(bay.some((m) => m.color.getHexString() === "8c8470")).toBe(false);
    expect(bay.some((m) => m.color.getHexString() === "c9a23a")).toBe(true);
    const printer = materialsOf(buildKitMesh(DEFS.printer, 5, lib).object);
    expect(printer.some((m) => m.color.getHexString() === "8a7f94")).toBe(false);
  });
});
