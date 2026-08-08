import { expect, test, type Page } from "@playwright/test";

/* Touch canvas interaction — the two-step tap contract.

   A touch tap fires pointerdown → pointerup → pointerleave → click with NO
   pointermove, so the mouse hover-ghost model never sees it. The contract under
   test: with a tool armed, the first tap AIMS (moves the ghost preview to the
   tapped cell, commits nothing) and a second tap on the same cell COMMITS; with
   no tool armed, a tap on a building selects it immediately (non-mutating
   actions stay one-step). Mouse behavior is covered by the desktop project and
   must not change. */

async function bootToGame(page: Page): Promise<void> {
  await page.goto("/");
  // Above the ViewportGate floor (560×440), still a touch device: the tablet
  // console this contract targets.
  await page.setViewportSize({ width: 800, height: 600 });
  // the Boot overlay auto-dismisses on its own — click through it only if it
  // is still up (warm loads can outrun the click)
  await page.locator(".boot").click({ timeout: 4_000 }).catch(() => {});
  await page.getByRole("button", { name: "BEGIN" }).click({ timeout: 15_000 });
  await expect(page.locator(".topbar")).toBeVisible();
  const closeGuide = page.getByRole("button", { name: /close field guide/i });
  if (await closeGuide.isVisible().catch(() => false)) await closeGuide.click();
  // let the follow-cam lerp settle so consecutive taps resolve the same cell
  await page.waitForTimeout(900);
}

function buildingCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    type DebugWindow = Window & {
      __viv?: { bridge?: { latest?: { buildings: unknown[] } | null } };
    };
    return (window as DebugWindow).__viv?.bridge?.latest?.buildings?.length ?? -1;
  });
}

function cameraView(page: Page): Promise<number> {
  return page.evaluate(() => {
    type DebugWindow = Window & {
      __viv?: { renderer?: { scene?: { camera?: { top?: number } } } };
    };
    const view = (window as DebugWindow).__viv?.renderer?.scene?.camera?.top;
    if (view == null) throw new Error("no debug camera is available");
    return view;
  });
}

/** Arm the Solar Array tool and two-step-tap it onto open ground. The colony
 *  layout rides the run's seed, so candidate spots are probed until the commit
 *  tap lands; the aim tap must never place anywhere (that failure means the
 *  two-step contract regressed to one-step). Returns the committed screen point. */
async function placeSolarByTouch(page: Page): Promise<{ x: number; y: number }> {
  await page.getByRole("button", { name: /^Solar Array/ }).tap();
  const box = await page.locator("canvas").boundingBox();
  if (!box) throw new Error("no canvas bounding box");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  for (const [dx, dy] of [[150, 0], [-150, 0], [0, 130], [180, 80], [-180, -80], [220, -60], [-120, 130]]) {
    const x = cx + dx;
    const y = cy + dy;
    const before = await buildingCount(page);

    await page.touchscreen.tap(x, y); // aim: ghost preview only
    await page.waitForTimeout(350);
    expect(await buildingCount(page), "the first (aim) tap must never place").toBe(before);

    await page.touchscreen.tap(x, y); // same cell again: commit
    try {
      await expect.poll(() => buildingCount(page), { timeout: 2_000 }).toBe(before + 1);
      return { x, y }; // committed — this spot was placeable
    } catch {
      // not placeable here (terrain/occupied) — probe the next candidate
    }
  }
  throw new Error("no candidate spot accepted a two-step touch placement");
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      // Opaque bootstrap documents have no storage; the app origin does.
    }
  });
});

test("touch: first tap aims the ghost, second tap on the same cell places", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "touch interaction check");
  await bootToGame(page);
  await placeSolarByTouch(page);
});

test("touch: with no tool armed, tapping a building selects it in one tap", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "touch interaction check");
  await bootToGame(page);
  const spot = await placeSolarByTouch(page);

  await page.getByRole("button", { name: /cancel/i }).first().tap(); // disarm the tool
  await page.touchscreen.tap(spot.x, spot.y); // the building we just placed
  // "SELECTED" discriminates the select branch from the sticky hover info line
  await expect(page.locator(".inspect")).toContainText(/selected solar array/i);
});

test("touch: explicit zoom controls stay visible, thumb-sized, and functional", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "touch interaction check");
  await bootToGame(page);

  const group = page.getByRole("group", { name: "Camera zoom controls" });
  const zoomIn = page.getByRole("button", { name: "Zoom camera in" });
  const zoomOut = page.getByRole("button", { name: "Zoom camera out" });
  await expect(group).toBeVisible();
  await expect(group).toBeInViewport();

  for (const button of [zoomIn, zoomOut]) {
    const box = await button.boundingBox();
    if (!box) throw new Error("zoom button has no bounding box");
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }

  const before = await cameraView(page);
  await zoomIn.tap();
  await expect.poll(() => cameraView(page)).toBeLessThan(before - 0.5);
  const zoomedIn = await cameraView(page);
  await zoomOut.tap();
  await expect.poll(() => cameraView(page)).toBeGreaterThan(zoomedIn + 0.5);
});
