/** World-space ground detail: a seeded value-noise tint multiplied onto the
 *  standard material's diffuse color, so terrain tiles lose their per-vertex
 *  repetition without any extra texture or geometry. Injected via
 *  onBeforeCompile at three's own chunk anchors — no new material, no new
 *  draw call. Render-local RNG only; never touches the engine's seeded
 *  streams. */
import * as THREE from "three";

/** Bump this if the injected GLSL changes shape, so three recompiles instead
 *  of reusing a cached program from the old shader. */
export const GROUND_DETAIL_KEY = "viv-ground-detail-2";

export function groundDetailChunks(): {
  vertexPars: string;
  vertexMain: string;
  fragmentPars: string;
  fragmentMain: string;
  fragmentFog: string;
} {
  return {
    vertexPars: `varying vec3 vGroundWorld;`,
    vertexMain: `vGroundWorld = (modelMatrix * vec4( transformed, 1.0 )).xyz;`,
    fragmentPars: `
varying vec3 vGroundWorld;
uniform vec2 uGroundSeed;
uniform vec2 uEdgeHaze;

float gHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float gNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = gHash(i);
  float b = gHash(i + vec2(1.0, 0.0));
  float c = gHash(i + vec2(0.0, 1.0));
  float d = gHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
`,
    fragmentMain: `
vec2 gp = vGroundWorld.xz + uGroundSeed;
float fw = fwidth(gp.x);                         // world units per pixel
float grain = (gNoise(gp * 2.5) - 0.5) * (1.0 - smoothstep(0.08, 0.3, fw));
float patchy = gNoise(gp * 0.33) - 0.5;
float region = gNoise(gp * 0.07) - 0.5;
float speck = step(0.94, gHash(floor(gp * 6.0))) * (1.0 - smoothstep(0.05, 0.16, fw));
float tone = grain * 0.10 + patchy * 0.14 + region * 0.18 - speck * 0.12;
diffuseColor.rgb *= clamp(1.0 + tone, 0.8, 1.2);
`,
    // Injected after r169's own fog_fragment (which has already mixed toward
    // fogColor by depth), so the far field additionally fades to the fog color
    // by distance from the origin — the ground never shows a hard edge on a
    // screen wide enough to see past FAR_EDGE. vGroundWorld is unshifted world
    // position (the ground-detail seed offset above only applies to gp).
    fragmentFog: `
#ifdef USE_FOG
  float edgeHaze = smoothstep(uEdgeHaze.x, uEdgeHaze.y, max(abs(vGroundWorld.x), abs(vGroundWorld.z)));
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, edgeHaze);
#endif
`,
  };
}

/** Installs the ground-detail injection on a standard material. Seed picks a
 *  fixed offset into the noise field (two irrational multiples of it, so the
 *  x/y offsets don't correlate) — same seed, same tiling forever. edgeHaze is
 *  the world-space (start, end) distance band the far field fades to the fog
 *  color over (terrain.ts's EDGE_HAZE_START..FAR_EDGE). Overwrites any prior
 *  onBeforeCompile/customProgramCacheKey; the terrain material has none to
 *  preserve. */
export function applyGroundDetail(
  material: THREE.MeshStandardMaterial,
  seed: number,
  edgeHaze: { start: number; end: number },
): void {
  const uGroundSeed = new THREE.Vector2(
    ((seed * 0.6180339887) % 1) * 64,
    ((seed * 0.4142135) % 1) * 64,
  );
  const uEdgeHaze = new THREE.Vector2(edgeHaze.start, edgeHaze.end);
  const chunks = groundDetailChunks();

  material.onBeforeCompile = (shader: THREE.WebGLProgramParametersWithUniforms, _renderer: THREE.WebGLRenderer): void => {
    shader.uniforms.uGroundSeed = { value: uGroundSeed };
    shader.uniforms.uEdgeHaze = { value: uEdgeHaze };

    // Each anchor occurs exactly once in r169's standard shader, so a plain (non-global) replace patches it correctly.
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${chunks.vertexPars}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${chunks.vertexMain}`);

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${chunks.fragmentPars}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${chunks.fragmentMain}`)
      .replace("#include <fog_fragment>", `#include <fog_fragment>\n${chunks.fragmentFog}`);
  };

  material.customProgramCacheKey = () => GROUND_DETAIL_KEY;
}
