import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { StormFx } from "./stormfx";
import { GridSpace } from "./coords";

describe("storm devils", () => {
  it("use a soft shader whose opacity uniform follows the lifetime fade", () => {
    const fx = new StormFx(new GridSpace(41));
    fx.debugDevil();
    fx.update(0.5, null);
    const shells: THREE.ShaderMaterial[] = [];
    fx.group.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined;
      if (m && (m as THREE.ShaderMaterial).isShaderMaterial) shells.push(m);
    });
    expect(shells.length).toBeGreaterThanOrEqual(3);
    const live = shells.filter((m) => m.uniforms.opacity.value > 0);
    expect(live.length).toBeGreaterThan(0);
    for (const m of shells) {
      expect(m.fog).toBe(true);
      expect(m.depthWrite).toBe(false);
      expect(m.uniforms.opacity.value).toBeLessThanOrEqual(1);
    }
    const t0 = live[0].uniforms.time.value;
    fx.update(0.25, null);
    expect(live[0].uniforms.time.value).toBeGreaterThan(t0);
    fx.dispose();
  });
});
