import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GROUND_DETAIL_KEY, applyGroundDetail, groundDetailChunks } from "./ground-shader";

describe("ground detail shader", () => {
  const EDGE_HAZE = { start: 60, end: 70 };

  it("injects world-space detail into the standard shader at real r169 anchors", () => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyGroundDetail(mat, 42, EDGE_HAZE);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain("vGroundWorld = (modelMatrix * vec4( transformed, 1.0 )).xyz;");
    expect(shader.fragmentShader).toContain("varying vec3 vGroundWorld;");
    expect(shader.fragmentShader).toMatch(/#include <color_fragment>\s*[\s\S]*diffuseColor\.rgb \*= /);
    // the edge-haze mix is injected right after r169's own fog_fragment chunk,
    // so it applies on top of (not instead of) the standard depth fog
    expect(shader.fragmentShader).toMatch(/#include <fog_fragment>\s*[\s\S]*edgeHaze[\s\S]*mix\(gl_FragColor\.rgb, fogColor, edgeHaze\)/);
    expect((shader.uniforms.uGroundSeed.value as THREE.Vector2).x).not.toBe(0);
    const haze = shader.uniforms.uEdgeHaze.value as THREE.Vector2;
    expect(haze.x).toBe(EDGE_HAZE.start);
    expect(haze.y).toBe(EDGE_HAZE.end);
    expect(mat.customProgramCacheKey()).toBe(GROUND_DETAIL_KEY);
  });

  it("keeps the hash sine-free and the seed offset small enough to stay precise on GPU", () => {
    // sin() of the large arguments this hash used to receive (seed offset + world coords,
    // times the noise frequencies) loses precision on many GPUs and bands or regularizes.
    const { fragmentPars, fragmentMain } = groundDetailChunks();
    expect(fragmentPars + fragmentMain).not.toContain("sin(");

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
    applyGroundDetail(mat, 42, EDGE_HAZE);
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    };
    mat.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, {} as THREE.WebGLRenderer);
    const seed = shader.uniforms.uGroundSeed.value as THREE.Vector2;
    expect(seed.x).toBeGreaterThanOrEqual(0);
    expect(seed.x).toBeLessThan(64);
    expect(seed.y).toBeGreaterThanOrEqual(0);
    expect(seed.y).toBeLessThan(64);
  });
});
