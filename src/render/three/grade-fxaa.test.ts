import { describe, expect, it } from "vitest";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { createGradedFxaaShader } from "./grade-fxaa";

describe("graded FXAA shader", () => {
  it("keeps FXAA intact and grades its output in the same pass", () => {
    const s = createGradedFxaaShader();
    expect(Object.keys(s.uniforms).sort()).toEqual(["gain", "lift", "resolution", "saturation", "tDiffuse", "vignette"]);
    expect(s.vertexShader).toBe(FXAAShader.vertexShader);
    expect(s.fragmentShader).toContain("gl_FragColor = FxaaPixelShader(");
    expect(s.fragmentShader).toMatch(/gl_FragColor = FxaaPixelShader\([\s\S]*?\);\s*gl_FragColor\.rgb = vivGrade\( gl_FragColor\.rgb, vUv \);/);
    expect(s.fragmentShader).toContain("uniform vec3 lift;");
    expect(createGradedFxaaShader().uniforms.gain).not.toBe(s.uniforms.gain); // fresh uniforms per call
  });
});
