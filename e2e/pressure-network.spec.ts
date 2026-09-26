import { expect, test, type Page } from "@playwright/test";
import type { SimBridge } from "../src/worker/bridge";
import type { SceneManager } from "../src/render/three/scene";
import type { GridSpace } from "../src/render/three/coords";
import type { CameraControls } from "../src/render/three/camera-controls";
import type { Group, Sprite, Vector3 } from "three";

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
      networkOverlay: { group: Group };
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

/** an empty cell where `defId` can go and would lay a corridor of 2–5 new cells */
async function corridorTarget(
  page: Page,
  defId: string,
): Promise<{ gx: number; gy: number; path: [number, number][]; cells: number }> {
  return page.evaluate((defId) => {
    const { bridge } = (window as DebugWindow).__viv;
    const n = bridge.latest!.N;
    for (let gy = 2; gy < n - 2; gy++) {
      for (let gx = 2; gx < n - 2; gx++) {
        if (!bridge.canPlace(defId, gx, gy)) continue;
        const preview = bridge.previewSeal(defId, gx, gy);
        if (preview?.kind === "corridor" && preview.affordable && preview.cells >= 2 && preview.cells <= 5) {
          return { gx, gy, path: preview.path, cells: preview.cells };
        }
      }
    }
    throw new Error(`no cell where ${defId} lays a short corridor`);
  }, defId);
}

/** pan the camera rig to a cell and wait until the eased view has it centred */
async function centreOn(page: Page, gx: number, gy: number): Promise<void> {
  await page.evaluate(({ gx, gy }) => {
    const { renderer: r } = (window as DebugWindow).__viv;
    r.cameraControls.rig.setOffset(r.grid.cellCenter(gx, gy).sub(r.camFocus), r.camFocus);
  }, { gx, gy });
  await expect.poll(() => page.evaluate(({ gx, gy }) => {
    const { renderer: r } = (window as DebugWindow).__viv;
    const p = r.grid.cellCenter(gx, gy).project(r.scene.camera);
    return Math.abs(p.x) < 0.1 && Math.abs(p.y) < 0.1;
  }, { gx, gy }), { timeout: 30_000 }).toBe(true);
}

/** the cell's screen point; `freeze` stops the render loop first so the eased
 *  camera cannot move between reading the point and a click that picks from it */
async function screenPoint(page: Page, gx: number, gy: number, freeze: boolean): Promise<{ x: number; y: number }> {
  return page.evaluate(({ gx, gy, freeze }) => {
    const { renderer: r } = (window as DebugWindow).__viv;
    if (freeze) {
      r.running = false;
      cancelAnimationFrame(r.raf);
    }
    const p = r.grid.cellCenter(gx, gy).project(r.scene.camera);
    const rect = r.scene.renderer.domElement.getBoundingClientRect();
    return { x: rect.left + (p.x + 1) * rect.width / 2, y: rect.top + (1 - p.y) * rect.height / 2 };
  }, { gx, gy, freeze });
}

test("a habitat placed away from the network lays its own corridor", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  test.setTimeout(90_000);
  await startColony(page);
  const target = await corridorTarget(page, "hab");
  const corridorsBefore = await page.evaluate(
    () => (window as DebugWindow).__viv.bridge.latest!.buildings.filter((b) => b.defId === "corridor").length,
  );

  await page.getByRole("button", { name: /^Habitat/ }).click();
  await centreOn(page, target.gx, target.gy);
  const aim = await screenPoint(page, target.gx, target.gy, false);
  await page.mouse.move(aim.x, aim.y);
  await expect(page.locator(".ins-seal")).toHaveText(/^lays \d+ corridor cells? · \d+ mat \(\d+ total\)$/);

  const click = await screenPoint(page, target.gx, target.gy, true);
  await page.mouse.click(click.x, click.y);
  await page.evaluate(() => (window as DebugWindow).__viv.renderer.start());
  await expect.poll(() => page.evaluate(({ gx, gy }) => {
    const s = (window as DebugWindow).__viv.bridge.latest!;
    const hab = s.buildings.find((b) => b.defId === "hab" && b.gx === gx && b.gy === gy);
    return { connected: hab?.connected ?? null, corridors: s.buildings.filter((b) => b.defId === "corridor").length };
  }, target), { timeout: 30_000 }).toEqual({ connected: true, corridors: corridorsBefore + target.cells });
});

test("the network overlay shows only while a build tool is up", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  await startColony(page);
  const overlayVisible = () => page.evaluate(() => (window as DebugWindow).__viv.renderer.networkOverlay.group.visible);
  expect(await overlayVisible()).toBe(false);
  await page.getByRole("button", { name: /^Habitat/ }).click();
  await expect.poll(overlayVisible).toBe(true);
  await page.keyboard.press("Escape");
  await expect.poll(overlayVisible).toBe(false);
  await page.getByRole("button", { name: /Demolish/ }).click();
  await expect.poll(overlayVisible).toBe(true);
});

test("a cut corridor unseals a building: badge, alert, and the alert finds it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  test.setTimeout(90_000);
  await startColony(page);
  const target = await corridorTarget(page, "electrolysis");
  await page.evaluate(({ gx, gy }) => (window as DebugWindow).__viv.bridge.place("electrolysis", gx, gy, 0, true), target);
  await expect.poll(() => page.evaluate(({ gx, gy }) => {
    const b = (window as DebugWindow).__viv.bridge.latest!.buildings.find((x) => x.defId === "electrolysis" && x.gx === gx && x.gy === gy);
    return b?.connected ?? null;
  }, target)).toBe(true);

  // cut the corridor cell beside the building and let the sim tick
  const [cx, cy] = target.path[0];
  await page.evaluate(({ cx, cy }) => {
    const { bridge } = (window as DebugWindow).__viv;
    bridge.remove(cx, cy);
    bridge.setPaused(false);
  }, { cx, cy });
  await expect.poll(() => page.evaluate(({ gx, gy }) => {
    const b = (window as DebugWindow).__viv.bridge.latest!.buildings.find((x) => x.defId === "electrolysis" && x.gx === gx && x.gy === gy);
    return b ? { connected: b.connected, offReason: b.offReason ?? null } : null;
  }, target), { timeout: 15_000 }).toEqual({ connected: false, offReason: "seal" });
  await page.evaluate(() => (window as DebugWindow).__viv.bridge.setPaused(true));

  const line = page.getByRole("button", { name: /1 UNSEALED/ });
  await expect(line).toBeVisible();
  await expect.poll(() => page.evaluate(
    () => (window as DebugWindow).__viv.renderer.faultBadges.pool.some((slot) => slot.sprite.visible && slot.label === "NO SEAL"),
  )).toBe(true);

  // the pan is an exact jump (the rig offset does not ease), so the building
  // must start well off centre and end on it
  const offCentre = () => page.evaluate(({ gx, gy }) => {
    const { renderer: r } = (window as DebugWindow).__viv;
    const p = r.grid.cellCenter(gx, gy).project(r.scene.camera);
    return Math.hypot(p.x, p.y);
  }, target);
  expect(await offCentre()).toBeGreaterThan(0.1);
  await line.click();
  await expect.poll(offCentre, { timeout: 15_000 }).toBeLessThan(0.05);
});

test("piloting from the touch button drops the build tool and its overlay", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "tablet-width console");
  await page.setViewportSize({ width: 880, height: 640 }); // the PILOT COMMANDER button shows at ≤900px
  await startColony(page);
  const overlayVisible = () => page.evaluate(() => (window as DebugWindow).__viv.renderer.networkOverlay.group.visible);
  await page.getByRole("button", { name: /^Habitat/ }).click();
  await expect.poll(overlayVisible).toBe(true);
  await page.getByRole("button", { name: /PILOT COMMANDER/ }).click();
  await expect.poll(() => page.evaluate(() => (window as DebugWindow).__viv.bridge.latest!.possessed)).not.toBeNull();
  await expect.poll(overlayVisible).toBe(false);
  await expect(page.locator(".inspect", { hasText: "PLACING" })).toHaveCount(0);
});
