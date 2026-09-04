import { expect, test, type Page } from "@playwright/test";
import type { SimBridge } from "../src/worker/bridge";
import type { SceneManager } from "../src/render/three/scene";

type DebugWindow = Window & {
  __viv: {
    bridge: SimBridge;
    renderer: {
      scene: SceneManager;
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
        return { uid: building.uid, gx, gy };
      }
    }
    throw new Error("No free destination for the solar array");
  });
  await expect.poll(() => page.evaluate(({ uid }) => {
    const { bridge, renderer } = (window as DebugWindow).__viv;
    const b = bridge.latest!.buildings.find((candidate) => candidate.uid === uid)!;
    const mesh = renderer.placed.get(uid)!.mesh.object;
    // The solar array has a 2x2 footprint on the 25x25 grid (CELL = 1).
    return { gx: b.gx, gy: b.gy, x: mesh.position.x, z: mesh.position.z };
  }, move)).toEqual({ gx: move.gx, gy: move.gy, x: move.gx - 11.5, z: move.gy - 11.5 });
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
