import { expect, test, type Page } from "@playwright/test";
import type { SimBridge } from "../src/worker/bridge";
import type { SceneManager } from "../src/render/three/scene";
import type { GridSpace } from "../src/render/three/coords";
import type { CameraControls } from "../src/render/three/camera-controls";
import type { Sprite, Vector3 } from "three";

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
      start(): void;
      faultBadges: { pool: { sprite: Sprite; label: string | null }[] };
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

/** select a building by clicking its cell through the canvas: centre the camera
 *  on it, freeze the render loop so the eased camera cannot move between reading
 *  the point and the click, click, resume */
async function selectBuilding(page: Page, gx: number, gy: number): Promise<void> {
  await page.evaluate(({ gx, gy }) => {
    const { renderer: r } = (window as DebugWindow).__viv;
    r.cameraControls.rig.setOffset(r.grid.cellCenter(gx, gy).sub(r.camFocus), r.camFocus);
  }, { gx, gy });
  await expect.poll(() => page.evaluate(({ gx, gy }) => {
    const { renderer: r } = (window as DebugWindow).__viv;
    const p = r.grid.cellCenter(gx, gy).project(r.scene.camera);
    return Math.abs(p.x) < 0.1 && Math.abs(p.y) < 0.1;
  }, { gx, gy }), { timeout: 30_000 }).toBe(true);
  const point = await page.evaluate(({ gx, gy }) => {
    const { renderer: r } = (window as DebugWindow).__viv;
    r.running = false;
    cancelAnimationFrame(r.raf);
    const p = r.grid.cellCenter(gx, gy).project(r.scene.camera);
    const rect = r.scene.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  }, { gx, gy });
  await page.mouse.click(point.x, point.y);
  await page.evaluate(() => (window as DebugWindow).__viv.renderer.start());
}

test("selecting a building opens its card, and its setting changes who runs", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  test.setTimeout(90_000);
  await startColony(page);
  const elec = await page.evaluate(() => {
    const b = (window as DebugWindow).__viv.bridge.latest!.buildings.find((x) => x.defId === "electrolysis")!;
    return { uid: b.uid, gx: b.gx, gy: b.gy };
  });
  await selectBuilding(page, elec.gx, elec.gy);

  const card = page.locator(".building-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("ELECTROLYSIS UNIT");
  await expect(card).toContainText("makes");
  await expect(card).toContainText("5 oxygen/s");

  const modeOf = () => page.evaluate((uid) => (window as DebugWindow).__viv.bridge.latest!.buildings.find((b) => b.uid === uid)!.mode ?? "normal", elec.uid);
  await card.getByRole("button", { name: "OFF" }).click();
  await expect.poll(modeOf).toBe("off");
  // let a few ticks run so the production pass records the reason
  await page.evaluate(() => (window as DebugWindow).__viv.bridge.setPaused(false));
  await expect.poll(() => page.evaluate((uid) =>
    (window as DebugWindow).__viv.bridge.latest!.buildings.find((b) => b.uid === uid)!.offReason ?? null, elec.uid),
  { timeout: 15_000 }).toBe("off");
  await page.evaluate(() => (window as DebugWindow).__viv.bridge.setPaused(true));
  await expect(card).toContainText("switched off");
  await expect.poll(() => page.evaluate(
    () => (window as DebugWindow).__viv.renderer.faultBadges.pool.some((slot) => slot.sprite.visible && slot.label === "OFF"),
  )).toBe(true);
  await expect(page.locator(".alerts")).not.toContainText("OFF"); // the player's choice is not a fault

  await card.getByRole("button", { name: "FIRST" }).click();
  await expect.poll(modeOf).toBe("first");
  await expect(card.getByRole("button", { name: "FIRST" })).toHaveAttribute("aria-pressed", "true");
});

test("the palette has the printers and no Fabricator", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  await startColony(page);
  await expect(page.getByRole("button", { name: /^3D Printer/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Bio Printer/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Atomic Printer/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /^Fabricator/ })).toHaveCount(0);
});
