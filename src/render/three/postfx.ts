/* ============================================================================
   PostFx — RenderPass → optional UnrealBloomPass → optional GTAO → OutputPass
   → graded FXAA (the FXAA pass carries the final lift/gain/saturation/vignette
   grade). Both quality paths keep clean edges and the same ACES grade and
   color grade, including fog and background: direct rendering applies tone
   mapping before fog in three r169, so setting ACES on the renderer alone
   would change the low-quality palette. HalfFloat scene targets preserve HDR
   emissives for threshold-1.0 bloom. AO, like bloom, is an optional pass: the
   composer is rebuilt lazily when either toggles, and the low path allocates
   no bloom or AO targets. AO runs after bloom so it never darkens emissives
   before bloom thresholds them.
   ============================================================================ */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { createGradedFxaaShader, NEUTRAL_GRADE, type Grade } from "./grade-fxaa";
import { ColonyAOPass } from "./ao";

const BLOOM_THRESHOLD = 1.0;
const BLOOM_STRENGTH = 0.55;
const BLOOM_RADIUS = 0.35;
const ACES_EXPOSURE = 1.15;
// solar-flare pulse: a ~250ms attack/decay spike every 1.5–4s, peaking at
// +0.65·level exposure and +0.5·level bloom strength (the sharp exposure
// peak is what makes the spike read at a glance in daylight)
const SPIKE_LEN = 0.25;
const SPIKE_EXPOSURE = 0.65;
const SPIKE_STRENGTH = 0.5;

export class PostFx {
  enabled = true;

  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  // Both paths share the final grade; only the enabled path owns bloom's
  // multi-resolution targets. The composer is built lazily after a toggle.
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private aoEnabled = false;
  private ao: ColonyAOPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private output: OutputPass | null = null;
  private antialias: ShaderPass | null = null;
  // final color grade, applied inside the FXAA pass (see grade-fxaa.ts); kept
  // here (not just on the pass) so it survives composer rebuilds and can be
  // written into a freshly built pass in build().
  private grade: Grade = { lift: NEUTRAL_GRADE.lift.clone(), gain: NEUTRAL_GRADE.gain.clone(), saturation: NEUTRAL_GRADE.saturation, vignette: NEUTRAL_GRADE.vignette };

  // flare pulse state
  private flare = 0;
  private untilSpike = 0; // seconds until the next spike fires
  private sinceSpike = Infinity; // seconds since the current spike began
  private spikeN = 0; // spike counter — drives the deterministic cadence wobble

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.applyToneMapping();
  }

  /** toggle bloom without changing the grade or restarting a flare pulse. The
   *  old chain is released immediately; the next render builds the new one. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.disposeComposer();
  }

  /** toggle ambient occlusion; like bloom, the chain is rebuilt lazily and the
   *  released pass takes its G-buffer and AO targets with it */
  setAO(on: boolean): void {
    if (on === this.aoEnabled) return;
    this.aoEnabled = on;
    this.disposeComposer();
  }

  setSize(w: number, h: number): void {
    this.composer?.setSize(w, h);
    this.resizeAntialias();
  }

  /** keep live scene and bloom targets at the renderer's pixel ratio when the
   *  governor changes resolution without rebuilding the quality path */
  setPixelRatio(r: number): void {
    this.composer?.setPixelRatio(r);
    this.resizeAntialias();
  }

  /** solar-flare severity 0..1 — while > 0, update() runs the pulsed envelope */
  setFlare(level: number): void {
    const lvl = Math.max(0, Math.min(1, level));
    if (lvl <= 0 && this.flare > 0) this.resetPulse(); // restore the base look
    this.flare = lvl;
  }

  /** set the final color grade; kept across composer rebuilds (bloom/AO
   *  toggles) so both quality paths grade identically */
  setGrade(g: Grade): void {
    this.grade.lift.copy(g.lift);
    this.grade.gain.copy(g.gain);
    this.grade.saturation = g.saturation;
    this.grade.vignette = g.vignette;
    if (this.antialias) this.applyGrade(this.antialias);
  }

  /** advance the same exposure cue in both tiers; bloom adds its halo on high */
  update(dt: number): void {
    if (this.flare <= 0) return;
    this.sinceSpike += dt;
    this.untilSpike -= dt;
    if (this.untilSpike <= 0) {
      this.sinceSpike = 0;
      this.spikeN++;
      // fixed cadence with a deterministic phase wobble: 1.5..4s between spikes
      this.untilSpike = 2.75 + 1.25 * Math.sin(this.spikeN * 2.4);
    }
    this.applyPulse();
  }

  render(): void {
    if (!this.composer) this.build();
    this.composer!.render();
  }

  dispose(): void {
    this.disposeComposer();
  }

  private applyToneMapping(): void {
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = ACES_EXPOSURE;
  }

  private applyPulse(): void {
    // half-sine envelope: ~125ms attack, ~125ms decay
    const env = this.sinceSpike < SPIKE_LEN ? Math.sin((this.sinceSpike / SPIKE_LEN) * Math.PI) : 0;
    this.renderer.toneMappingExposure = ACES_EXPOSURE + SPIKE_EXPOSURE * this.flare * env;
    if (this.bloom) this.bloom.strength = BLOOM_STRENGTH + SPIKE_STRENGTH * this.flare * env;
  }

  private resetPulse(): void {
    this.untilSpike = 0; // first spike fires as soon as a flare starts
    this.sinceSpike = Infinity;
    this.spikeN = 0;
    this.renderer.toneMappingExposure = ACES_EXPOSURE;
    if (this.bloom) this.bloom.strength = BLOOM_STRENGTH;
  }

  /** lazy build — reads the renderer's current size/pixelRatio, so a quality
   *  toggle that changed either is picked up fresh on rebuild */
  private build(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
    });
    this.composer = new EffectComposer(this.renderer, target);
    // r169 treats a supplied target's dimensions as logical dimensions. Start
    // logical, then size through the composer so DPR is applied exactly once.
    this.composer.setSize(size.x, size.y);
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.output = new OutputPass(); // applies renderer.toneMapping + sRGB at the end
    // RenderPass, bloom and AO stay in the HDR read target. OutputPass writes a small
    // LDR target; FXAA presents that and swaps back, keeping the HDR target as
    // next frame's scene input. No multisample buffers or extra depth target.
    this.composer.renderTarget1.texture.type = THREE.UnsignedByteType;
    this.composer.renderTarget1.depthBuffer = false;
    this.composer.addPass(this.renderPass);
    if (this.enabled) {
      this.bloom = new UnrealBloomPass(size, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
      this.composer.addPass(this.bloom);
      this.applyPulse(); // a rebuilt bloom joins an in-flight flare at its phase
    }
    if (this.aoEnabled) {
      // after bloom: AO multiplies the HDR scene in place, so ahead of bloom it
      // would darken emissives before bloom's threshold test. addPass sizes it
      // to the drawing buffer (logical size × pixel ratio).
      this.ao = new ColonyAOPass(this.scene, this.camera, size.x, size.y);
      this.composer.addPass(this.ao);
    }
    this.composer.addPass(this.output);
    this.antialias = new ShaderPass(createGradedFxaaShader());
    this.composer.addPass(this.antialias);
    this.resizeAntialias();
    this.applyGrade(this.antialias); // carry the stored grade into the new pass
  }

  private resizeAntialias(): void {
    if (!this.composer || !this.antialias) return;
    const target = this.composer.renderTarget1;
    this.antialias.uniforms.resolution.value.set(1 / target.width, 1 / target.height);
  }

  /** write the stored grade into a built antialias pass's uniforms; setGrade
   *  (live update) and build() (fresh pass) both funnel through here so the
   *  two paths can't drift apart */
  private applyGrade(pass: ShaderPass): void {
    pass.uniforms.lift.value.copy(this.grade.lift);
    pass.uniforms.gain.value.copy(this.grade.gain);
    pass.uniforms.saturation.value = this.grade.saturation;
    pass.uniforms.vignette.value = this.grade.vignette;
  }

  private disposeComposer(): void {
    this.renderPass?.dispose();
    this.ao?.dispose(); // releases the G-buffer + AO/denoise render targets
    this.bloom?.dispose(); // releases the bloom mip-chain targets + materials
    this.output?.dispose();
    this.antialias?.dispose();
    this.composer?.dispose(); // releases the HDR/LDR targets + the copy pass
    this.renderPass = null;
    this.ao = null;
    this.bloom = null;
    this.output = null;
    this.antialias = null;
    this.composer = null;
  }
}
