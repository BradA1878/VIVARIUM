import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { AO_MIN_OPACITY, ColonyAOPass, aoVisible } from "./ao";

const mesh = (params: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial(params));

describe("aoVisible", () => {
  it("keeps opaque and nearly opaque surfaces, drops see-through and unlit extras", () => {
    expect(aoVisible(mesh())).toBe(true);
    expect(aoVisible(mesh({ transparent: true, opacity: 0.92 }))).toBe(true); // frosted dome
    expect(aoVisible(mesh({ transparent: true, opacity: AO_MIN_OPACITY }))).toBe(true);
    expect(aoVisible(mesh({ transparent: true, opacity: 0.55 }))).toBe(false); // corridor skin
    expect(aoVisible(mesh({ depthWrite: false }))).toBe(false); // decals, FX, ghost
    expect(aoVisible(new THREE.Sprite())).toBe(false); // bubbles, name tags
    expect(aoVisible(new THREE.Points())).toBe(false);
    expect(aoVisible(new THREE.LineSegments())).toBe(false);
    const tagged = mesh();
    tagged.userData.noAO = true;
    expect(aoVisible(tagged)).toBe(false);
    expect(aoVisible(new THREE.Group())).toBe(true);
    const multi = new THREE.Mesh(new THREE.BoxGeometry(), [
      new THREE.MeshStandardMaterial(),
      new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 }),
    ]);
    expect(aoVisible(multi)).toBe(false);
  });
});

describe("ColonyAOPass", () => {
  it("hides exactly the non-occluders for the G-buffer and restores every object after", () => {
    const scene = new THREE.Scene();
    const solid = mesh();
    const ghost = mesh({ depthWrite: false });
    const sprite = new THREE.Sprite();
    const hiddenAlready = mesh();
    hiddenAlready.visible = false;
    scene.add(solid, ghost, sprite, hiddenAlready);
    const pass = new ColonyAOPass(scene, new THREE.OrthographicCamera(), 64, 64);
    pass.overrideVisibility();
    expect([solid.visible, ghost.visible, sprite.visible, hiddenAlready.visible]).toEqual([true, false, false, false]);
    pass.restoreVisibility();
    expect([solid.visible, ghost.visible, sprite.visible, hiddenAlready.visible]).toEqual([true, true, true, false]);
    pass.dispose();
  });

  it("multiplies AO onto the scene target in place and never swaps the composer buffers", () => {
    const pass = new ColonyAOPass(new THREE.Scene(), new THREE.OrthographicCamera(), 32, 32);
    expect(pass.needsSwap).toBe(false);
    // stub the two GPU-facing helpers; GTAOPass.render() drives them in order
    const draws: { material: THREE.Material; target: THREE.WebGLRenderTarget | null; clear: unknown }[] = [];
    pass.renderOverride = vi.fn() as unknown as typeof pass.renderOverride;
    pass.renderPass = ((_renderer: THREE.WebGLRenderer, material: THREE.Material, target: THREE.WebGLRenderTarget | null, clear?: unknown) => {
      draws.push({ material, target, clear });
    }) as typeof pass.renderPass;
    const read = new THREE.WebGLRenderTarget(32, 32);
    const write = new THREE.WebGLRenderTarget(32, 32);
    pass.render({} as THREE.WebGLRenderer, write, read, 0, false);
    const last = draws.at(-1)!;
    expect(last.material).toBe(pass.blendMaterial);
    expect(last.target).toBe(read); // the scene target itself, not the write buffer
    expect(last.clear).toBeUndefined(); // no clear before the multiply
    expect(draws.some((d) => d.target === write)).toBe(false);
    pass.dispose();
    read.dispose();
    write.dispose();
  });

  it("builds the same denoise noise every time (deterministic output across rebuilds)", () => {
    const scene = new THREE.Scene();
    const cam = new THREE.OrthographicCamera();
    const a = new ColonyAOPass(scene, cam, 32, 32);
    const b = new ColonyAOPass(scene, cam, 32, 32);
    expect(Array.from(a.pdNoiseTexture.image.data as Uint8Array)).toEqual(Array.from(b.pdNoiseTexture.image.data as Uint8Array));
    a.dispose();
    b.dispose();
  });
});
