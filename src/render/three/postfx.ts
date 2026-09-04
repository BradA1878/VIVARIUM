/* ============================================================================
   PostFx — RenderPass → optional UnrealBloomPass → OutputPass → FXAA. Both
   quality paths keep clean edges and the same ACES grade, including fog and
   background: direct rendering applies tone mapping before fog in three r169,
   so setting ACES on the renderer alone would change the low-quality palette.
   HalfFloat scene targets preserve HDR emissives for threshold-1.0 bloom.
   The composer is lazy; toggling bloom releases the old chain, and the low
   path allocates no bloom targets.
   ============================================================================ */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";

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
  private bloom: UnrealBloomPass | null = null;
  private output: OutputPass | null = null;
  private antialias: ShaderPass | null = null;

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
    // RenderPass/bloom stay in the HDR read target. OutputPass writes a small
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
    this.composer.addPass(this.output);
    this.antialias = new ShaderPass(FXAAShader);
    this.composer.addPass(this.antialias);
    this.resizeAntialias();
  }

  private resizeAntialias(): void {
    if (!this.composer || !this.antialias) return;
    const target = this.composer.renderTarget1;
    this.antialias.uniforms.resolution.value.set(1 / target.width, 1 / target.height);
  }

  private disposeComposer(): void {
    this.renderPass?.dispose();
    this.bloom?.dispose(); // releases the bloom mip-chain targets + materials
    this.output?.dispose();
    this.antialias?.dispose();
    this.composer?.dispose(); // releases the HDR/LDR targets + the copy pass
    this.renderPass = null;
    this.bloom = null;
    this.output = null;
    this.antialias = null;
    this.composer = null;
  }
}
