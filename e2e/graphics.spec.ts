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
    };
  };
};

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
    await expect.poll(() => page.evaluate(({ gx, gy }) => {
      const { renderer: r } = (window as DebugWindow).__viv;
      const p = r.grid.cellCenter(gx, gy).project(r.scene.camera);
      return Math.abs(p.x) < 0.1 && Math.abs(p.y) < 0.1;
    }, { gx, gy })).toBe(true);
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
  const shadowCoverage = await page.evaluate(() => {
    const { renderer: r } = (window as DebugWindow).__viv;
    const { sun } = r.scene as unknown as { sun: DirectionalLight };
    const points: number[][] = [];
    for (const tod of [0.25, 0.3, 0.5, 0.7, 0.75]) {
      r.scene.update(tod, false);
      sun.updateMatrixWorld();
      sun.target.updateMatrixWorld();
      sun.shadow.updateMatrices(sun);
      for (const gx of [-0.5, r.grid.N - 0.5]) {
        for (const gy of [-0.5, r.grid.N - 0.5]) {
          for (const height of [0, 6]) {
            const p = r.grid.cellPoint(gx, gy).setY(height).project(sun.shadow.camera);
            points.push(p.toArray());
          }
        }
      }
    }
    return { covered: points.every((p) => p.every((v) => Math.abs(v) < 1)), mapSize: sun.shadow.mapSize.toArray() };
  });
  expect(shadowCoverage).toEqual({ covered: true, mapSize: [1024, 1024] });
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
