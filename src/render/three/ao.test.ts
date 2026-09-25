import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { GTAOShader } from "three/addons/shaders/GTAOShader.js";
import { AO_MIN_OPACITY, ColonyAOPass, aoVisible } from "./ao";
import { buildDepot } from "./depot";
import { buildAstronaut } from "./kit/astronaut";
import { buildRover } from "./kit/rover";

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

  it("leaves out the astronaut and rover possession rings at every pulse (their opacity crosses the 85% cut)", () => {
    const ringOf = (root: THREE.Object3D) =>
      root.children.find((o) => (o as THREE.Mesh).geometry instanceof THREE.RingGeometry)!;
    const astronaut = buildAstronaut();
    const rover = buildRover();
    for (const pulse of [0, 0.5, 1]) {
      astronaut.setState(true, null, pulse);
      rover.setState(true, 0, pulse);
      expect(aoVisible(ringOf(astronaut.object)), `astronaut, pulse ${pulse}`).toBe(false);
      expect(aoVisible(ringOf(rover.object)), `rover, pulse ${pulse}`).toBe(false);
    }
    astronaut.dispose();
    rover.dispose();
  });

  it("leaves out the depot's glow ring and intake disc, whose opacity also pulses across the cut", () => {
    const depot = buildDepot();
    depot.setGlow(1, 1); // a loaded colonist in range, at the pulse peak: opacity 0.95
    const glows: THREE.Object3D[] = [];
    depot.object.traverse((o) => {
      const g = (o as THREE.Mesh).geometry;
      if (g instanceof THREE.RingGeometry || g instanceof THREE.CircleGeometry) glows.push(o);
    });
    expect(glows).toHaveLength(2);
    for (const o of glows) expect(aoVisible(o), (o as THREE.Mesh).geometry.type).toBe(false);
    depot.dispose();
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

  it("tracks only the objects it hides, with no per-object map writes each frame", () => {
    const scene = new THREE.Scene();
    for (let i = 0; i < 20; i++) scene.add(mesh());
    scene.add(new THREE.Sprite());
    const pass = new ColonyAOPass(scene, new THREE.OrthographicCamera(), 16, 16);
    const set = vi.spyOn(Map.prototype, "set");
    pass.overrideVisibility();
    pass.restoreVisibility();
    const writes = set.mock.calls.length;
    set.mockRestore();
    expect(writes).toBe(0);
    pass.dispose();
  });

  it("keeps its hide-list storage between frames but no references to the objects it restored", () => {
    const scene = new THREE.Scene();
    scene.add(new THREE.Sprite(), new THREE.Sprite(), mesh());
    const pass = new ColonyAOPass(scene, new THREE.OrthographicCamera(), 16, 16);
    const internals = pass as unknown as { hidden: (THREE.Object3D | null)[] };
    pass.overrideVisibility();
    pass.restoreVisibility();
    // truncating to length 0 would make V8 reallocate the storage every frame
    expect(internals.hidden.length).toBe(2);
    expect(internals.hidden.every((o) => o === null)).toBe(true);
    pass.dispose();
  });

  it("starts each frame from the scene's current visibility, not the last frame's", () => {
    const scene = new THREE.Scene();
    const solid = mesh();
    const ghost = mesh({ depthWrite: false });
    const tag = new THREE.Sprite();
    scene.add(solid, ghost, tag);
    const pass = new ColonyAOPass(scene, new THREE.OrthographicCamera(), 16, 16);
    pass.overrideVisibility();
    pass.restoreVisibility();
    tag.visible = false; // the app hides the tag between frames
    pass.overrideVisibility();
    expect([solid.visible, ghost.visible, tag.visible]).toEqual([true, false, false]);
    pass.restoreVisibility();
    expect([solid.visible, ghost.visible, tag.visible]).toEqual([true, true, false]);
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
    pass.render({ shadowMap: { autoUpdate: true } } as unknown as THREE.WebGLRenderer, write, read, 0, false);
    const last = draws.at(-1)!;
    expect(last.material).toBe(pass.blendMaterial);
    expect(last.target).toBe(read); // the scene target itself, not the write buffer
    expect(last.clear).toBeUndefined(); // no clear before the multiply
    expect(draws.some((d) => d.target === write)).toBe(false);
    pass.dispose();
    read.dispose();
    write.dispose();
  });

  it("keeps its G-buffer render from drawing the sun's shadow map a second time, and restores the flag even when that render throws", () => {
    const pass = new ColonyAOPass(new THREE.Scene(), new THREE.OrthographicCamera(), 32, 32);
    const renderer = { shadowMap: { autoUpdate: true } } as unknown as THREE.WebGLRenderer;
    let during: boolean | undefined;
    pass.renderOverride = (() => {
      during = renderer.shadowMap.autoUpdate;
    }) as typeof pass.renderOverride;
    pass.renderPass = (() => {}) as typeof pass.renderPass;
    const read = new THREE.WebGLRenderTarget(32, 32);
    const write = new THREE.WebGLRenderTarget(32, 32);
    pass.render(renderer, write, read, 0, false);
    expect(during).toBe(false); // the scene pass already drew this frame's shadows
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    pass.renderOverride = (() => {
      throw new Error("G-buffer render failed");
    }) as typeof pass.renderOverride;
    expect(() => pass.render(renderer, write, read, 0, false)).toThrow("G-buffer render failed");
    expect(renderer.shadowMap.autoUpdate).toBe(true);
    pass.dispose();
    read.dispose();
    write.dispose();
  });

  it("never leaves the non-occluders hidden, even when its G-buffer render throws", () => {
    const scene = new THREE.Scene();
    const tag = new THREE.Sprite();
    scene.add(tag, mesh());
    const pass = new ColonyAOPass(scene, new THREE.OrthographicCamera(), 32, 32);
    const renderer = { shadowMap: { autoUpdate: true } } as unknown as THREE.WebGLRenderer;
    pass.renderOverride = (() => {
      throw new Error("G-buffer render failed");
    }) as typeof pass.renderOverride;
    pass.renderPass = (() => {}) as typeof pass.renderPass;
    const read = new THREE.WebGLRenderTarget(32, 32);
    const write = new THREE.WebGLRenderTarget(32, 32);
    expect(() => pass.render(renderer, write, read, 0, false)).toThrow("G-buffer render failed");
    expect(tag.visible).toBe(true);
    pass.dispose();
    read.dispose();
    write.dispose();
  });

  it("uses the orthographic camera's constant view direction, and leaves a perspective pass as three ships it", () => {
    const perspectiveLine = "vec3 viewDir = normalize(-viewPos.xyz);";
    const orthographicLine = "vec3 viewDir = vec3( 0.0, 0.0, 1.0 );";
    const ortho = new ColonyAOPass(new THREE.Scene(), new THREE.OrthographicCamera(), 16, 16);
    expect(ortho.gtaoMaterial.fragmentShader).toContain(orthographicLine);
    expect(ortho.gtaoMaterial.fragmentShader).not.toContain(perspectiveLine);
    const persp = new ColonyAOPass(new THREE.Scene(), new THREE.PerspectiveCamera(), 16, 16);
    expect(persp.gtaoMaterial.fragmentShader).toContain(perspectiveLine);
    expect(persp.gtaoMaterial.fragmentShader).not.toContain(orthographicLine);
    ortho.dispose();
    persp.dispose();
  });

  it("fails loudly when three's GTAO shader no longer has the view-direction line it patches", () => {
    const original = GTAOShader.fragmentShader;
    GTAOShader.fragmentShader = original.replace("vec3 viewDir = normalize(-viewPos.xyz);", "vec3 viewDir = normalize(-viewPos);");
    try {
      expect(() => new ColonyAOPass(new THREE.Scene(), new THREE.OrthographicCamera(), 16, 16)).toThrow(/GTAOShader/);
    } finally {
      GTAOShader.fragmentShader = original;
    }
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
