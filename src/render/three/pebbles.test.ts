import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { PEBBLE_COUNT, buildPebbles } from "./pebbles";

const flat = (x: number, z: number) => 0.01 * Math.sin(x) * Math.cos(z);
const look = { rockSeed: 98213, rockColor: 0x5a3322 };

describe("pebble field", () => {
  it("scatters small seeded pebbles on the ground inside the extent", () => {
    const a = buildPebbles(flat, 23.5, look), b = buildPebbles(flat, 23.5, look);
    expect(a.count).toBe(PEBBLE_COUNT);
    expect(a.castShadow).toBe(false);
    expect(Array.from(a.instanceMatrix.array)).toEqual(Array.from(b.instanceMatrix.array));
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < a.count; i++) {
      a.getMatrixAt(i, m);
      m.decompose(p, q, s);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(23.5);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(23.5);
      expect(Math.max(s.x, s.z)).toBeLessThanOrEqual(0.09 + 1e-9);
      expect(Math.min(s.x, s.z)).toBeGreaterThanOrEqual(0.03 - 1e-9);
      expect(Math.abs(p.y - flat(p.x, p.z))).toBeLessThan(0.05);
    }
    expect(a.instanceColor).toBeTruthy();
    a.geometry.dispose(); (a.material as THREE.Material).dispose();
    b.geometry.dispose(); (b.material as THREE.Material).dispose();
  });
});
