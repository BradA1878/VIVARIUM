/* ============================================================================
   Graded FXAA — the final color grade (lift/gain/saturation/vignette) applied
   inside the antialiasing pass, so it costs no extra pass and no extra
   texture read: FXAA already reads the scene once and writes the frame once.
   createGradedFxaaShader() clones FXAAShader and inserts the grade uniforms
   and a vivGrade() call right after FXAA's own gl_FragColor assignment, via
   regex anchors on FXAA's source. Both anchors throw if missing, so a three.js
   upgrade that reshapes FXAAShader fails loudly here instead of silently
   shipping unaliased or ungraded output.
   ============================================================================ */
import * as THREE from "three";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";

/** Lift/gain/saturation/vignette grade applied to the antialiased frame.
 *  lift and gain are THREE.Color so PostFx can .copy() into live uniforms
 *  without allocating on every setGrade() call. */
export interface Grade {
  lift: THREE.Color;
  gain: THREE.Color;
  saturation: number;
  vignette: number;
}

/** No-op grade: matches plain FXAA output exactly. */
export const NEUTRAL_GRADE: Grade = {
  lift: new THREE.Color(0, 0, 0),
  gain: new THREE.Color(1, 1, 1),
  saturation: 1,
  vignette: 0,
};

const RESOLUTION_UNIFORM = "uniform vec2 resolution;";

// Inserted right after FXAA's own uniform declarations. lift/gain are vec3 so
// they take a THREE.Color uniform value directly.
const GRADE_DECLARATIONS = `uniform vec2 resolution;
uniform vec3 lift;
uniform vec3 gain;
uniform float saturation;
uniform float vignette;

vec3 vivGrade( vec3 c, vec2 uv ) {
  c = c * gain + lift * ( 1.0 - c );
  float l = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = mix( vec3( l ), c, saturation );
  float r = length( uv - 0.5 ) * 1.25;
  c *= 1.0 - vignette * smoothstep( 0.35, 0.85, r );
  return clamp( c, 0.0, 1.0 );
}`;

// Matches FXAA's single `gl_FragColor = FxaaPixelShader( ... );` statement in
// main(). Non-greedy so it stops at that call's own closing `);` — none of
// its arguments contain parentheses — rather than running past it.
const FXAA_CALL = /gl_FragColor = FxaaPixelShader\([\s\S]*?\);/;

/** FXAAShader plus a grade applied to its output in the same pass: PostFx
 *  builds its antialias ShaderPass from this instead of from FXAAShader
 *  directly, so the composer's pass count and needsSwap flags never change
 *  when the grade is tuned (see postfx.ts). */
export function createGradedFxaaShader(): {
  uniforms: Record<string, THREE.IUniform>;
  vertexShader: string;
  fragmentShader: string;
} {
  const uniforms = THREE.UniformsUtils.clone(FXAAShader.uniforms) as Record<string, THREE.IUniform>;
  uniforms.lift = { value: new THREE.Color(0, 0, 0) };
  uniforms.gain = { value: new THREE.Color(1, 1, 1) };
  uniforms.saturation = { value: 1 };
  uniforms.vignette = { value: 0 };

  if (!FXAAShader.fragmentShader.includes(RESOLUTION_UNIFORM)) {
    throw new Error("createGradedFxaaShader: FXAAShader no longer declares `uniform vec2 resolution;` — update the anchor");
  }
  if (!FXAA_CALL.test(FXAAShader.fragmentShader)) {
    throw new Error("createGradedFxaaShader: FXAAShader no longer has a `gl_FragColor = FxaaPixelShader(...)` statement — update the anchor");
  }

  const fragmentShader = FXAAShader.fragmentShader
    .replace(RESOLUTION_UNIFORM, GRADE_DECLARATIONS)
    .replace(FXAA_CALL, (call) => `${call}\n\t\t\t\tgl_FragColor.rgb = vivGrade( gl_FragColor.rgb, vUv );`);

  return { uniforms, vertexShader: FXAAShader.vertexShader, fragmentShader };
}
