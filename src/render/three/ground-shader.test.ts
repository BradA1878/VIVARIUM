import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GROUND_DETAIL_KEY, applyGroundDetail } from "./ground-shader";

describe("ground detail shader", () => {
  it("injects world-space detail into the standard shader at real r169 anchors", () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyGroundDetail(mat, 42);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain("vGroundWorld = (modelMatrix * vec4( transformed, 1.0 )).xyz;");
    expect(shader.fragmentShader).toContain("varying vec3 vGroundWorld;");
    expect(shader.fragmentShader).toMatch(/#include <color_fragment>\s*[\s\S]*diffuseColor\.rgb \*= /);
    expect((shader.uniforms.uGroundSeed.value as THREE.Vector2).x).not.toBe(0);
    expect(mat.customProgramCacheKey()).toBe(GROUND_DETAIL_KEY);
  });
});
