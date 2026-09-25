import { describe, expect, it, vi } from "vitest";
import { createMaterials } from "./materials";

describe("MaterialLib", () => {
  it("shares one PV map and one dome panel map, and releases them on dispose", () => {
    const lib = createMaterials();
    const a = lib.panel(), b = lib.panel();
    expect(a.map).toBeTruthy();
    expect(a.map).toBe(b.map);
    expect(a.roughness).toBeLessThan(0.3);
    expect(a.metalness).toBeLessThanOrEqual(0.2);
    const shell = lib.domeShell();
    expect(shell.bumpMap).toBeTruthy();
    expect(shell.roughnessMap).toBe(shell.bumpMap);
    expect(shell.transparent).toBe(true);
    expect(shell.opacity).toBeCloseTo(0.92);
    expect(lib.metal().metalness).toBeCloseTo(0.6);
    expect(lib.frostedDome().metalness).toBeCloseTo(0.2);
    const released = vi.fn();
    a.map!.addEventListener("dispose", released);
    shell.bumpMap!.addEventListener("dispose", released);
    lib.dispose();
    expect(released).toHaveBeenCalledTimes(2);
  });
});
