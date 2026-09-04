import { afterEach, describe, expect, it } from "vitest";
import * as THREE from "three";
import { DEFS } from "@/engine/defs";
import { createMaterials } from "../materials";
import { buildFacility } from "./facility";
import type { BuildingStatus } from "./contract";

const movingParts = {
  printer: "facility-outfeed",
  roboticsbay: "facility-gantry",
  reclaimer: "facility-gantry",
  fabricator: "facility-extruder",
} as const;
type MovingFacility = keyof typeof movingParts;
const active: BuildingStatus = { alive: true, hurt: false, fill: 0.5 };
const cleanup: (() => void)[] = [];

function facility(id: MovingFacility, seed = 17, cell = 1) {
  const materials = createMaterials();
  const kit = buildFacility({ def: DEFS[id], materials, seed, cell });
  cleanup.push(() => { kit.dispose(); materials.dispose(); });
  const part = kit.object.getObjectByName(movingParts[id])!;
  return { kit, part };
}

afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });

describe("functional facility motion", () => {
  it.each(Object.keys(movingParts) as MovingFacility[])("%s freezes exactly when paused or offline and resumes without a time jump", (id) => {
    const { kit, part } = facility(id);
    const initial = part.position.clone();
    kit.setStatus(active, 0.2, { night: 0, dt: 1 });
    expect(part.position.equals(initial)).toBe(false);
    const running = part.position.clone();
    kit.setStatus(active, 0.9, { night: 1, dt: 20, paused: true });
    expect(part.position.equals(running)).toBe(true);
    kit.setStatus({ ...active, alive: false, hurt: true }, 0, { night: 0, dt: 20 });
    expect(part.position.equals(running)).toBe(true);
    // An operational line may be deliberately held (e.g. the lineage cap)
    // even though it has power and a partially completed fabrication cycle.
    kit.setStatus({ ...active, working: false }, 0, { night: 0, dt: 20 });
    expect(part.position.equals(running)).toBe(true);
    // Missing/bad frame deltas must neither move the tool nor poison its phase.
    kit.setStatus(active, 0.5);
    for (const dt of [0, -1, NaN, Infinity]) kit.setStatus(active, 0.5, { night: 0, dt });
    expect(part.position.equals(running)).toBe(true);
    kit.setStatus(active, 0.2, { night: 0, dt: 1 });
    const reference = facility(id);
    reference.kit.setStatus(active, 0.8, { night: 1, dt: 2 });
    expect(part.position.distanceTo(reference.part.position)).toBeLessThan(1e-12);
  });

  it.each(Object.keys(movingParts) as MovingFacility[])("%s moves at the same rate at 30 and 144 fps with stable per-building starting positions", (id) => {
    const low = facility(id);
    const high = facility(id);
    const different = facility(id, 18);
    expect(low.part.position.equals(high.part.position)).toBe(true);
    expect(low.part.position.equals(different.part.position)).toBe(false);
    for (let i = 0; i < 150; i++) low.kit.setStatus(active, 0.1, { night: 0, dt: 1 / 30 });
    for (let i = 0; i < 720; i++) high.kit.setStatus(active, 0.9, { night: 1, dt: 1 / 144 });
    expect(low.part.position.distanceTo(high.part.position)).toBeLessThan(1e-12);
  });

  it("holds a completed fabricator in place while keeping its full progress gauge", () => {
    const { kit, part } = facility("fabricator");
    kit.setStatus(active, 0.4, { night: 0, dt: 1 });
    const running = part.position.clone();
    for (const fill of [1, 1.1]) {
      kit.setStatus({ ...active, fill }, 0.7, { night: 0, dt: 10 });
      expect(part.position.equals(running)).toBe(true);
    }
    const gauge = kit.object.children.filter((o) => o.position.z > 0.35) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
    expect(gauge).toHaveLength(4);
    expect(gauge.map((seg) => seg.material.emissiveIntensity)).toEqual([1.15, 1.15, 1.15, 1.15]);
    kit.setStatus({ ...active, fill: 0 }, 0.1, { night: 0, dt: 1 });
    const reference = facility("fabricator");
    reference.kit.setStatus(active, 0.1, { night: 0, dt: 2 });
    expect(part.position.distanceTo(reference.part.position)).toBeLessThan(1e-12);
  });

  it.each(["roboticsbay", "reclaimer"] as const)("keeps the %s tool, cable and beam attached within the original gantry", (id) => {
    const cell = 1.7;
    const { kit, part } = facility(id, 24, cell);
    expect(part.children).toHaveLength(3);
    const local = part.children.map((child) => child.position.clone());
    const originalBounds = new THREE.Box3().setFromObject(kit.object).expandByScalar(1e-7);
    const innerPost = DEFS[id].foot[0] * cell * 0.74 / 2 - cell * 0.04;
    for (let i = 0; i < 120; i++) {
      kit.setStatus(active, 0.5, { night: 0, dt: 0.25 });
      expect(originalBounds.containsBox(new THREE.Box3().setFromObject(kit.object))).toBe(true);
      const toolBounds = new THREE.Box3().setFromObject(part.children[2]);
      expect(toolBounds.min.x).toBeGreaterThan(-innerPost);
      expect(toolBounds.max.x).toBeLessThan(innerPost);
      part.children.forEach((child, j) => expect(child.position.equals(local[j])).toBe(true));
    }
  });

  it("keeps the extruder clear of its core and towers, and the printer tray inside its old extent", () => {
    const fab = facility("fabricator");
    const printer = facility("printer");
    const towerInner = 0.72 * 0.32 - 0.14 / 2;
    for (let i = 0; i < 120; i++) {
      fab.kit.setStatus(active, 0.5, { night: 0, dt: 0.25 });
      const head = new THREE.Box3().setFromObject(fab.part);
      expect(head.min.x).toBeGreaterThan(-towerInner);
      expect(head.max.x).toBeLessThan(towerInner);
      expect(head.min.y).toBeGreaterThan(0.42 + 0.24 + 0.26 / 2); // core top
      expect(head.max.y).toBeLessThanOrEqual(0.42 + 0.58 - 0.07 / 2 + 1e-7); // beam bottom
      printer.kit.setStatus(active, 0.5, { night: 0, dt: 0.25 });
      const tray = new THREE.Box3().setFromObject(printer.part);
      expect(tray.max.z).toBeLessThanOrEqual(0.7 / 2 + 0.07 + 0.16 / 2 + 1e-7);
      expect(tray.max.z).toBeGreaterThan(0.7 / 2); // visible beyond the housing
    }
  });
});
