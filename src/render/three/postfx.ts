/* ============================================================================
   PostFx — the high-quality render path: RenderPass → UnrealBloomPass →
   OutputPass behind a single enabled switch. Enabled pairs ACES tone mapping
   with a threshold-1.0 bloom, so only deliberately pushed emissives (>1.0)
   glow — the composer's HalfFloat targets (the three r152+ default) carry
   those values into the threshold test, no layers/masks needed. Disabled is
   pixel-identical to the pre-postfx renderer (NoToneMapping, direct render)
   and holds no GPU targets: the composer is built lazily on the first enabled
   render and released on disable.
   ============================================================================ */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";

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
  // built lazily on the first enabled render — the quality-off path never
  // allocates composer targets at all
  private composer: EffectComposer | null = null;
  private renderPass: RenderPass | null = null;
  private bloom: UnrealBloomPass | null = null;
  private output: OutputPass | null = null;

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

  /** flip the whole chain atomically: tone mapping, exposure, and render path.
   *  Off restores NoToneMapping / exposure 1.0 and the direct renderer.render —
   *  pixel-identical to the pre-postfx renderer — and releases the composer's
   *  render targets. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.resetPulse();
    this.applyToneMapping();
    if (!on) this.disposeComposer();
  }

  setSize(w: number, h: number): void {
    this.composer?.setSize(w, h);
  }

  /** keep a LIVE composer's targets at the renderer's pixel ratio — the perf
   *  governor can re-step the ratio mid-bloom (the old all-or-nothing quality
   *  flip always rebuilt the chain, so this case never existed) */
  setPixelRatio(r: number): void {
    this.composer?.setPixelRatio(r);
  }

  /** solar-flare severity 0..1 — while > 0, update() runs the pulsed envelope */
  setFlare(level: number): void {
    const lvl = Math.max(0, Math.min(1, level));
    if (lvl <= 0 && this.flare > 0) this.resetPulse(); // restore the base look
    this.flare = lvl;
  }

  /** advance the flare pulse — a zero-cost no-op when disabled or flare 0 */
  update(dt: number): void {
    if (!this.enabled || this.flare <= 0) return;
    this.sinceSpike += dt;
    this.untilSpike -= dt;
    if (this.untilSpike <= 0) {
      this.sinceSpike = 0;
      this.spikeN++;
      // fixed cadence with a deterministic phase wobble: 1.5..4s between spikes
      this.untilSpike = 2.75 + 1.25 * Math.sin(this.spikeN * 2.4);
    }
    // half-sine envelope: ~125ms attack, ~125ms decay
    const env = this.sinceSpike < SPIKE_LEN ? Math.sin((this.sinceSpike / SPIKE_LEN) * Math.PI) : 0;
    this.renderer.toneMappingExposure = ACES_EXPOSURE + SPIKE_EXPOSURE * this.flare * env;
    if (this.bloom) this.bloom.strength = BLOOM_STRENGTH + SPIKE_STRENGTH * this.flare * env;
  }

  render(): void {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (!this.composer) this.build();
    this.composer!.render();
  }

  dispose(): void {
    this.disposeComposer();
  }

  private applyToneMapping(): void {
    this.renderer.toneMapping = this.enabled ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = this.enabled ? ACES_EXPOSURE : 1.0;
  }

  private resetPulse(): void {
    this.untilSpike = 0; // first spike fires as soon as a flare starts
    this.sinceSpike = Infinity;
    this.spikeN = 0;
    if (this.enabled) this.renderer.toneMappingExposure = ACES_EXPOSURE;
    if (this.bloom) this.bloom.strength = BLOOM_STRENGTH;
  }

  /** lazy build — reads the renderer's current size/pixelRatio, so a quality
   *  toggle that changed either is picked up fresh on rebuild */
  private build(): void {
    const size = this.renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(this.renderer); // HalfFloat targets (r152+ default)
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(size, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.output = new OutputPass(); // applies renderer.toneMapping + sRGB at the end
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
  }

  private disposeComposer(): void {
    this.renderPass?.dispose();
    this.bloom?.dispose(); // releases the bloom mip-chain targets + materials
    this.output?.dispose();
    this.composer?.dispose(); // releases both HalfFloat targets + the copy pass
    this.renderPass = null;
    this.bloom = null;
    this.output = null;
    this.composer = null;
  }
}
