import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import type { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { PostFx } from "./postfx";
import { ColonyAOPass } from "./ao";

function fixture() {
  const dimensions = { width: 800, height: 600, ratio: 1.5 };
  const renderer = {
    getSize: (target: THREE.Vector2) => target.set(dimensions.width, dimensions.height),
    getPixelRatio: () => dimensions.ratio,
    toneMapping: THREE.NoToneMapping,
    toneMappingExposure: 1,
  } as unknown as THREE.WebGLRenderer;
  const fx = new PostFx(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
  type AntialiasUniforms = {
    resolution: { value: THREE.Vector2 };
    lift: { value: THREE.Color };
    gain: { value: THREE.Color };
    saturation: { value: number };
    vignette: { value: number };
  };
  const internals = fx as unknown as { composer: EffectComposer | null; bloom: UnrealBloomPass | null; antialias: { uniforms: AntialiasUniforms } | null };
  return { fx, renderer, dimensions, internals };
}

describe("post-processing quality transitions", () => {
  beforeEach(() => {
    // Construct the real targets and passes; GPU drawing belongs to browser QA.
    vi.spyOn(EffectComposer.prototype, "render").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("keeps antialiasing at the drawing-buffer size through DPR, resize, and quality changes", () => {
    const { fx, dimensions, internals } = fixture();
    expect(internals.composer).toBeNull();
    fx.render();
    const high = internals.composer!;
    for (const target of [high.renderTarget1, high.renderTarget2]) {
      expect([target.width, target.height, target.samples]).toEqual([1200, 900, 0]);
    }
    expect(high.readBuffer.texture.type).toBe(THREE.HalfFloatType);
    expect(high.writeBuffer.texture.type).toBe(THREE.UnsignedByteType);
    expect(high.writeBuffer.depthBuffer).toBe(false);
    expect(high.passes.at(-1)?.needsSwap).toBe(true);
    expect(internals.antialias!.uniforms.resolution.value.toArray()).toEqual([1 / 1200, 1 / 900]);

    dimensions.ratio = 1.25;
    fx.setPixelRatio(dimensions.ratio);
    expect([high.readBuffer.width, high.readBuffer.height]).toEqual([1000, 750]);
    dimensions.width = 500;
    dimensions.height = 300;
    fx.setSize(dimensions.width, dimensions.height);
    expect([high.readBuffer.width, high.readBuffer.height]).toEqual([625, 375]);
    expect(internals.antialias!.uniforms.resolution.value.toArray()).toEqual([1 / 625, 1 / 375]);

    const disposed = vi.fn();
    high.renderTarget1.addEventListener("dispose", disposed);
    high.renderTarget2.addEventListener("dispose", disposed);
    internals.bloom!.renderTargetBright.addEventListener("dispose", disposed);
    fx.setEnabled(false);
    expect(disposed).toHaveBeenCalledTimes(3);
    expect(internals.composer).toBeNull();
    expect(internals.bloom).toBeNull();

    fx.render();
    const low = internals.composer!;
    expect(internals.bloom).toBeNull();
    expect(low.passes).toHaveLength(3);
    expect(low.passes.at(-1)?.needsSwap).toBe(true);
    expect([low.readBuffer.width, low.readBuffer.height, low.readBuffer.samples])
      .toEqual([625, 375, 0]);
    fx.dispose();
    expect(internals.composer).toBeNull();
  });

  it("keeps the same grade and flare cadence when bloom is disabled or toggled mid-pulse", () => {
    const high = fixture();
    const low = fixture();
    low.fx.setEnabled(false);
    for (const { fx, renderer } of [high, low]) {
      expect(renderer.toneMapping).toBe(THREE.ACESFilmicToneMapping);
      expect(renderer.toneMappingExposure).toBe(1.15);
      fx.setFlare(0.7);
      fx.update(0);
      fx.update(0.125);
      expect(renderer.toneMappingExposure).toBeCloseTo(1.15 + 0.65 * 0.7);
    }

    low.fx.setEnabled(true);
    low.fx.render();
    expect(low.internals.bloom!.strength).toBeCloseTo(0.55 + 0.5 * 0.7);
    low.fx.setEnabled(false);
    // A tier change must neither restart nor skip the current/following spike.
    for (let i = 0; i < 40; i++) {
      high.fx.update(0.125);
      low.fx.update(0.125);
      expect(low.renderer.toneMappingExposure).toBeCloseTo(high.renderer.toneMappingExposure);
    }
    low.fx.setFlare(0);
    expect(low.renderer.toneMappingExposure).toBe(1.15);
    high.fx.dispose();
    low.fx.dispose();
  });

  it("adds ambient occlusion only when enabled, sized to the drawing buffer, and releases it on toggle", () => {
    const { fx, dimensions, internals } = fixture();
    const ao = () => internals.composer!.passes.find((p) => p instanceof ColonyAOPass) as ColonyAOPass | undefined;
    fx.render();
    expect(ao()).toBeUndefined();
    fx.setAO(true);
    expect(internals.composer).toBeNull(); // rebuilt lazily, like bloom
    fx.render();
    const pass = ao()!;
    expect(internals.composer!.passes.indexOf(pass)).toBe(1); // right after the scene render
    expect([pass.width, pass.height]).toEqual([1200, 900]);
    dimensions.ratio = 1.25;
    fx.setPixelRatio(1.25);
    expect([pass.width, pass.height]).toEqual([1000, 750]);
    const released = vi.fn();
    pass.gtaoRenderTarget.addEventListener("dispose", released);
    pass.pdRenderTarget.addEventListener("dispose", released);
    fx.setAO(false);
    expect(released).toHaveBeenCalledTimes(2);
    fx.render();
    expect(ao()).toBeUndefined();
    fx.dispose();
  });

  it("keeps a set grade live and across a composer rebuild triggered by a quality toggle", () => {
    const { fx, internals } = fixture();
    const lift = new THREE.Color(0.1, 0.05, 0.02);
    const gain = new THREE.Color(1.1, 1.05, 0.95);
    fx.setGrade({ lift, gain, saturation: 1.05, vignette: 0.2 });

    fx.render(); // build() must write the pre-set grade into the new pass
    const high = internals.antialias!.uniforms;
    expect(high.lift.value.equals(lift)).toBe(true);
    expect(high.gain.value.equals(gain)).toBe(true);
    expect(high.saturation.value).toBe(1.05);
    expect(high.vignette.value).toBe(0.2);

    // setGrade on an already-built pass updates its uniforms live, no rebuild
    const neutralLift = new THREE.Color(0, 0, 0);
    const neutralGain = new THREE.Color(1, 1, 1);
    fx.setGrade({ lift: neutralLift, gain: neutralGain, saturation: 1, vignette: 0 });
    expect(high.lift.value.equals(neutralLift)).toBe(true);
    expect(high.saturation.value).toBe(1);

    // restore the tuned grade, then force a rebuild (bloom off = low chain)
    fx.setGrade({ lift, gain, saturation: 1.05, vignette: 0.2 });
    fx.setEnabled(false);
    fx.render();
    const low = internals.antialias!.uniforms;
    expect(low.lift.value.equals(lift)).toBe(true);
    expect(low.gain.value.equals(gain)).toBe(true);
    expect(low.saturation.value).toBe(1.05);
    expect(low.vignette.value).toBe(0.2);
    fx.dispose();
  });

  it("keeps an even number of buffer swaps per frame, so the scene always renders into the HDR target with depth", () => {
    // The scene pass renders into the composer's read buffer. Only one of the
    // two targets has depth (and HDR color); an odd swap count per frame would
    // hand the scene the depthless 8-bit target on every other frame.
    for (const bloom of [true, false]) {
      for (const ao of [true, false]) {
        const { fx, internals } = fixture();
        fx.setEnabled(bloom);
        fx.setAO(ao);
        fx.render();
        const composer = internals.composer!;
        const swaps = composer.passes.filter((p) => p.enabled && p.needsSwap).length;
        expect(swaps % 2, `bloom ${bloom}, ao ${ao}`).toBe(0);
        expect(composer.readBuffer.texture.type).toBe(THREE.HalfFloatType);
        expect(composer.readBuffer.depthBuffer).toBe(true);
        fx.dispose();
      }
    }
  });
});
