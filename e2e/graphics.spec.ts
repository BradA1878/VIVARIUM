import { expect, test, type Page } from "@playwright/test";
import type { SimBridge } from "../src/worker/bridge";
import type { SceneManager } from "../src/render/three/scene";
import type { GridSpace } from "../src/render/three/coords";
import type { CameraControls } from "../src/render/three/camera-controls";
import type { DirectionalLight, Vector3 } from "three";

type DebugWindow = Window & {
  __viv: {
    bridge: SimBridge;
    renderer: {
      scene: SceneManager;
      grid: GridSpace;
      cameraControls: CameraControls;
      camFocus: Vector3;
      running: boolean;
      raf: number;
      placed: Map<number, { mesh: { object: { position: { x: number; z: number } } } }>;
      setQuality(q: "auto" | "low" | "high"): void;
    };
  };
};

/** Every visible point between the ground and the tallest structures must
 *  fall inside the sun's fitted shadow camera, at dawn, noon and dusk. The
 *  check casts its own rays through the four screen corners rather than
 *  reusing the renderer's fitting math. */
async function visibleGroundShadowed(page: Page): Promise<{ worst: number; mapSize: number[] }> {
  return page.evaluate(() => {
    const { renderer: r } = (window as DebugWindow).__viv;
    const { sun } = r.scene as unknown as { sun: DirectionalLight };
    const cam = r.scene.camera;
    const V = r.camFocus.constructor as new (x?: number, y?: number, z?: number) => Vector3;
    let worst = 0;
    for (const tod of [0.26, 0.3, 0.5, 0.7, 0.74]) {
      r.scene.update(tod, false);
      r.scene.render();
      sun.updateMatrixWorld();
      sun.target.updateMatrixWorld();
      sun.shadow.updateMatrices(sun);
      for (const nx of [-1, 1]) {
        for (const ny of [-1, 1]) {
          const near = new V(nx, ny, -1).unproject(cam);
          const dir = new V(nx, ny, 1).unproject(cam).sub(near).normalize();
          for (const h of [0, 5]) {
            const p = near.clone().addScaledVector(dir, (h - near.y) / dir.y).project(sun.shadow.camera);
            worst = Math.max(worst, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
          }
        }
      }
    }
    return { worst, mapSize: sun.shadow.mapSize.toArray() };
  });
}

async function startColony(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".boot")?.click());
  await page.getByRole("button", { name: "BEGIN", exact: true }).click();
  await page.waitForFunction(() => (window as DebugWindow).__viv?.bridge.latest?.started);
  const close = page.getByRole("button", { name: /close field guide/i });
  if (await close.isVisible()) await close.click();
  await page.evaluate(() => (window as DebugWindow).__viv.bridge.setPaused(true));
}

test("a moved building mesh follows the authoritative footprint", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  await startColony(page);
  const move = await page.evaluate(() => {
    const { bridge } = (window as DebugWindow).__viv;
    const building = bridge.latest!.buildings.find((b) => b.defId === "solar")!;
    for (let gy = 1; gy < bridge.latest!.N - 2; gy++) {
      for (let gx = 1; gx < bridge.latest!.N - 2; gx++) {
        if (Math.abs(gx - building.gx) < 3 || !bridge.canMove(building.uid, gx, gy)) continue;
        bridge.move(building.uid, gx, gy);
        return { uid: building.uid, gx, gy, offset: (bridge.latest!.N - 1) / 2 };
      }
    }
    throw new Error("No free destination for the solar array");
  });
  await expect.poll(() => page.evaluate(({ uid }) => {
    const { bridge, renderer } = (window as DebugWindow).__viv;
    const b = bridge.latest!.buildings.find((candidate) => candidate.uid === uid)!;
    const mesh = renderer.placed.get(uid)!.mesh.object;
    // The solar array has a 2x2 footprint (CELL = 1).
    return { gx: b.gx, gy: b.gy, x: mesh.position.x, z: mesh.position.z };
  }, move)).toEqual({ gx: move.gx, gy: move.gy, x: move.gx + 0.5 - move.offset, z: move.gy + 0.5 - move.offset });
});

test("construction reaches all four expanded edges through the canvas", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  await startColony(page);
  // pin HIGH so the governor cannot drop shadows mid-test on a slow runner
  await page.evaluate(() => (window as DebugWindow).__viv.renderer.setQuality("high"));
  const N = await page.evaluate(() => (window as DebugWindow).__viv.bridge.latest!.N);
  expect(N).toBe(41);
  await page.getByRole("button", { name: /^Solar Array/ }).click();
  const middle = Math.floor(N / 2);
  for (const [gx, gy] of [[0, middle], [N - 2, middle], [middle, 0], [middle, N - 2]]) {
    // Use the same bounded pan intent as mouse dragging, then exercise actual
    // pointer picking and placement at cells outside each old 25-cell edge.
    await page.evaluate(({ gx, gy }) => {
      const { renderer: r } = (window as DebugWindow).__viv;
      const target = r.grid.cellCenter(gx, gy);
      r.cameraControls.rig.setOffset(target.sub(r.camFocus), r.camFocus);
    }, { gx, gy });
    // wait until the cell is near the middle of the screen AND the camera has
    // stopped: the click point is read from the camera, and the colony anchor
    // keeps easing after each placement, so a moving camera can carry the
    // click onto a neighbor
    let last: { x: number; y: number } | null = null;
    await expect.poll(async () => {
      const p = await page.evaluate(({ gx, gy }) => {
        const { renderer: r } = (window as DebugWindow).__viv;
        const v = r.grid.cellCenter(gx, gy).project(r.scene.camera);
        return { x: v.x, y: v.y };
      }, { gx, gy });
      const still = last != null && Math.abs(p.x - last.x) < 0.002 && Math.abs(p.y - last.y) < 0.002;
      last = p;
      return still && Math.abs(p.x) < 0.1 && Math.abs(p.y) < 0.1;
    }).toBe(true);
    const shadow = await visibleGroundShadowed(page);
    expect(shadow.worst).toBeLessThan(1);
    expect(shadow.mapSize).toEqual([2048, 2048]);
    // read the point and click with nothing in between
    const point = await page.evaluate(({ gx, gy }) => {
      const { renderer: r } = (window as DebugWindow).__viv;
      const p = r.grid.cellCenter(gx, gy).project(r.scene.camera);
      const rect = r.scene.renderer.domElement.getBoundingClientRect();
      return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
    }, { gx, gy });
    await page.mouse.click(point.x, point.y);
    await expect.poll(() => page.evaluate(({ gx, gy }) => {
      const { bridge, renderer } = (window as DebugWindow).__viv;
      const b = bridge.latest!.buildings.find((b) => b.defId === "solar" && b.gx === gx && b.gy === gy);
      return !!b && renderer.placed.has(b.uid);
    }, { gx, gy })).toBe(true);
  }
  const blocked = await page.evaluate(() => {
    const { bridge } = (window as DebugWindow).__viv;
    const n = bridge.latest!.N;
    return [bridge.canPlace("solar", n - 1, 0), bridge.canPlace("solar", 0, n - 1), bridge.canPlace("solar", -1, 0)];
  });
  expect(blocked).toEqual([false, false, false]);
});

test("quality paths grade the same frozen scene identically without bloom", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  await startColony(page);
  const result = await page.evaluate(() => {
    const { renderer } = (window as DebugWindow).__viv;
    // Freeze render-side animation too, then compare the actual GPU output of
    // both paths at the same resolution. The scene includes fog and emissives.
    renderer.running = false;
    cancelAnimationFrame(renderer.raf);
    const { scene } = renderer;
    scene.setBloom(true);
    scene.render();
    const fx = scene.postfx as unknown as { bloom: { strength: number } };
    fx.bloom.strength = 0;
    scene.render();
    const high = scene.renderer.domElement.toDataURL();
    scene.setBloom(false);
    scene.render();
    const low = scene.renderer.domElement.toDataURL();
    return { same: high === low, bytes: high.length, exposure: scene.renderer.toneMappingExposure };
  });
  expect(result.bytes).toBeGreaterThan(10_000);
  expect(result.exposure).toBe(1.15);
  expect(result.same).toBe(true);
});

test("GPU resources return to baseline across worlds, quality steps, and a sol of sky changes", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  // a full sol at 30x plus twelve world switches: ~45 s on an idle machine
  test.setTimeout(120_000);
  const glErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /webgl|GL_|shader/i.test(m.text())) glErrors.push(m.text());
  });
  await startColony(page);
  const cycle = () => page.evaluate(async () => {
    const { bridge, renderer } = (window as DebugWindow).__viv;
    const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    for (const world of ["ceres", "io", "titan", "mars"] as const) {
      const save = await bridge.save();
      save.state.world = world;
      await bridge.load(save);
      await settle(400);
    }
    renderer.setQuality("low");
    await settle(300);
    renderer.setQuality("high");
    await settle(600);
    const { geometries, textures } = renderer.scene.renderer.info.memory;
    return { geometries, textures };
  });
  // one full sol at 30x first: the sun sweeps the sky and the environment
  // re-bakes, and render-side caches (bubble chip textures) warm up. The colony
  // is restored afterwards so building counts stay comparable.
  const bakes = await page.evaluate(async () => {
    const { bridge, renderer } = (window as DebugWindow).__viv;
    const before = renderer.scene.envBakes;
    const save = await bridge.save();
    bridge.setSpeed(30);
    bridge.setPaused(false);
    await new Promise((resolve) => setTimeout(resolve, 5500));
    bridge.setPaused(true);
    bridge.setSpeed(1);
    await bridge.load(save);
    await new Promise((resolve) => setTimeout(resolve, 4500)); // transient FX expire
    return renderer.scene.envBakes - before;
  });
  expect(bakes).toBeGreaterThan(5);
  // each cycle re-bakes the sky four times (one per world) and rebuilds the
  // post chain twice; any per-bake or per-rebuild leak grows these counts
  const first = await cycle();
  const second = await cycle();
  const third = await cycle();
  expect(second).toEqual(first);
  expect(third).toEqual(first);
  expect(glErrors).toEqual([]);
});
