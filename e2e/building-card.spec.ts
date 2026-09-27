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

test("the palette keeps its rows at common desktop widths", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  await startColony(page);
  const rows = () => page.evaluate(() => new Set([...document.querySelectorAll<HTMLElement>(".pal-grid .pal-btn")].map((b) => b.offsetTop)).size);
  // 1512 and 1728: the 14" and 16" MacBook Pro defaults
  for (const [width, height, expected] of [[1280, 720, 3], [1440, 900, 3], [1512, 982, 2], [1560, 900, 2], [1728, 1117, 2]] as const) {
    await page.setViewportSize({ width, height });
    await expect.poll(rows, { message: `${width}×${height}` }).toBe(expected);
  }
  await expect(page.getByRole("button", { name: /Demolish/ })).toHaveCount(1); // in the palette's header row
});

test("switching colonies drops the selected building", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  test.setTimeout(90_000);
  await startColony(page);
  // wait for the first autosave, which also writes this colony's ledger row
  // (the default slot keeps the legacy unsuffixed save key: persistence/local.ts)
  await expect.poll(() => page.evaluate(() => {
    const slot = localStorage.getItem("vivarium:activeslot:v1") ?? "default";
    const saveKey = slot === "default" ? "vivarium:save:v1" : `vivarium:save:v1:${slot}`;
    const ledger = JSON.parse(localStorage.getItem("vivarium:colonies:v1") ?? "{}") as { colonies?: { slotKey: string }[] };
    return !!localStorage.getItem(saveKey) && !!ledger.colonies?.some((c) => c.slotKey === slot);
  }), { timeout: 30_000 }).toBe(true);
  // a second world to switch to: a copy of this colony under another slot, so
  // its building uids match this one's
  await page.evaluate(() => {
    const slot = localStorage.getItem("vivarium:activeslot:v1") ?? "default";
    const saveKey = slot === "default" ? "vivarium:save:v1" : `vivarium:save:v1:${slot}`;
    const ledger = JSON.parse(localStorage.getItem("vivarium:colonies:v1")!) as { colonies: { slotKey: string }[] };
    const row = ledger.colonies.find((c) => c.slotKey === slot)!;
    localStorage.setItem("vivarium:save:v1:mars:4242", localStorage.getItem(saveKey)!);
    ledger.colonies.push({ ...row, slotKey: "mars:4242" });
    localStorage.setItem("vivarium:colonies:v1", JSON.stringify(ledger));
  });

  const elec = await page.evaluate(() => {
    const b = (window as DebugWindow).__viv.bridge.latest!.buildings.find((x) => x.defId === "electrolysis")!;
    return { gx: b.gx, gy: b.gy };
  });
  await selectBuilding(page, elec.gx, elec.gy);
  await expect(page.locator(".building-card")).toContainText("ELECTROLYSIS UNIT");

  await page.getByRole("button", { name: /COLONIES/ }).click();
  await page.locator(".cr-name:not([disabled])").click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem("vivarium:activeslot:v1")), { timeout: 30_000 }).toBe("mars:4242");
  // the same uid names a building of the arriving colony: no card may act on it
  await expect(page.locator(".building-card")).toHaveCount(0);
});

test("FIRST on a building waiting for crew staffs it ahead of an older one", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "architect console");
  test.setTimeout(90_000);
  await startColony(page);
  // one worker: the seed electrolysis (built first) takes them, and the extractor waits
  await page.evaluate(async () => {
    const { bridge } = (window as DebugWindow).__viv;
    const save = await bridge.save();
    save.state.population = 1;
    await bridge.load(save);
    bridge.setPaused(false);
  });
  const reasonOf = (defId: string) => page.evaluate((id) =>
    (window as DebugWindow).__viv.bridge.latest!.buildings.find((b) => b.defId === id)?.offReason ?? null, defId);
  await expect.poll(() => reasonOf("extractor"), { timeout: 15_000 }).toBe("crew");
  await page.evaluate(() => (window as DebugWindow).__viv.bridge.setPaused(true));

  const ex = await page.evaluate(() => {
    const b = (window as DebugWindow).__viv.bridge.latest!.buildings.find((x) => x.defId === "extractor")!;
    return { gx: b.gx, gy: b.gy };
  });
  await selectBuilding(page, ex.gx, ex.gy);
  const card = page.locator(".building-card");
  await expect(card).toContainText("NO CREW");
  await card.getByRole("button", { name: "FIRST" }).click();
  await page.evaluate(() => (window as DebugWindow).__viv.bridge.setPaused(false));
  await expect.poll(() => reasonOf("extractor"), { timeout: 15_000 }).toBeNull();
  await expect.poll(() => reasonOf("electrolysis"), { timeout: 15_000 }).toBe("crew");
});
