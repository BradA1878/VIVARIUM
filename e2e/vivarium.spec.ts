import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function reachStartScreen(page: Page): Promise<void> {
  await page.goto("/");
  const boot = page.locator(".boot");
  await expect(boot).toBeVisible();
  await boot.click();
  await expect(page.getByRole("button", { name: "BEGIN" })).toBeVisible();
}

async function possessedPosition(page: Page): Promise<{ x: number; y: number }> {
  return page.evaluate(() => {
    type Actor = { id: number; x: number; y: number };
    type DebugSnapshot = {
      possessed: number | null;
      colonists: Actor[];
      rovers: Actor[];
    };
    type DebugWindow = Window & { __viv?: { bridge?: { latest?: DebugSnapshot | null } } };
    const snapshot = (window as DebugWindow).__viv?.bridge?.latest;
    const actor = snapshot?.possessed == null
      ? null
      : [...snapshot.colonists, ...snapshot.rovers].find((candidate) => candidate.id === snapshot.possessed);
    if (!actor) throw new Error("No possessed actor is available in the debug snapshot");
    return { x: actor.x, y: actor.y };
  });
}

async function cameraPose(page: Page): Promise<{ x: number; z: number; view: number }> {
  return page.evaluate(() => {
    type DebugWindow = Window & {
      __viv?: {
        renderer?: {
          scene?: { camera?: { position?: { x: number; z: number }; top?: number } };
        };
      };
    };
    const camera = (window as DebugWindow).__viv?.renderer?.scene?.camera;
    if (!camera?.position || camera.top == null) throw new Error("No debug camera is available");
    return { x: camera.position.x, z: camera.position.z, view: camera.top };
  });
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

test("fresh start is keyboard- and screen-reader-ready", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop console interaction");
  await reachStartScreen(page);

  const standard = page.getByRole("button", { name: /STANDARD/i });
  await standard.focus();
  await page.keyboard.press("Enter");
  await expect(standard).toHaveAttribute("aria-pressed", "true");

  const helpButton = page.getByRole("button", { name: /how to play/i }).first();
  await helpButton.click();
  const help = page.getByRole("dialog", { name: /how to play/i });
  await expect(help).toBeVisible();
  await expect(help.getByRole("heading", { name: "MOVE + GATHER" })).toBeVisible();
  await expect(help).toContainText("Mine a nearby deposit");
  await expect(help.locator(".resource-map")).toContainText("ORE");
  await expect(help.locator(".resource-map")).toContainText("MATERIALS");
  await expect(help).toContainText("does not enter colony stores");
  await expect(help.getByRole("button", { name: /field guide/i })).toHaveCount(0);

  const helpResults = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const helpBlocking = helpResults.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(helpBlocking, helpBlocking.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(helpButton).toBeFocused();

  const settingsButton = page.getByRole("button", { name: /settings/i }).first();
  await settingsButton.click();
  const settings = page.getByRole("dialog", { name: /settings/i });
  await expect(settings).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(settings).toBeHidden();
  await expect(settingsButton).toBeFocused();

  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);
});

test("launch, help, and form input survive global shortcuts", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop console interaction");
  await reachStartScreen(page);
  await page.getByRole("button", { name: "BEGIN" }).click();

  await expect(page.locator(".topbar")).toBeVisible();
  await expect(page.getByRole("button", { name: /help|guide/i }).first()).toBeVisible();

  await page.getByRole("button", { name: /reset/i }).first().click();
  await expect(page.getByText(/begin a new colony/i)).toBeVisible();
  await page.getByRole("button", { name: "CANCEL" }).click();
  await expect(page.getByText(/begin a new colony/i)).toBeHidden();

  await page.getByRole("button", { name: /co-op/i }).click();
  const callsign = page.getByPlaceholder("your name");
  await callsign.fill("Ada");
  await callsign.press("End");
  await callsign.press("Space");
  await callsign.type("Lovelace");
  await expect(callsign).toHaveValue("Ada Lovelace");
});

test("pilot movement is blocked by Help and resumes from restored button focus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop keyboard interaction");
  await reachStartScreen(page);
  await page.getByRole("button", { name: "BEGIN" }).click();
  await expect(page.locator(".topbar")).toBeVisible();

  const closeGuide = page.getByRole("button", { name: /close field guide/i });
  if (await closeGuide.isVisible()) await closeGuide.click();

  await page.keyboard.press("f");
  await expect(page.locator(".pilot").first()).toContainText("PILOTING");

  const helpButton = page.getByRole("button", { name: /how to play/i }).first();
  await helpButton.click();
  const help = page.getByRole("dialog", { name: /how to play/i });
  await expect(help).toBeVisible();
  await expect(page.getByRole("button", { name: /resume/i })).toBeVisible();

  const modalStart = await possessedPosition(page);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(450);
  await page.keyboard.up("ArrowRight");
  const modalEnd = await possessedPosition(page);
  expect(Math.hypot(modalEnd.x - modalStart.x, modalEnd.y - modalStart.y)).toBeLessThan(0.02);

  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
  await expect(helpButton).toBeFocused();
  await expect(page.getByRole("button", { name: /pause/i })).toBeVisible();

  const movementStart = await possessedPosition(page);
  await page.keyboard.down("ArrowRight");
  await page.waitForTimeout(550);
  await page.keyboard.up("ArrowRight");
  await expect.poll(async () => {
    const current = await possessedPosition(page);
    return Math.hypot(current.x - movementStart.x, current.y - movementStart.y);
  }).toBeGreaterThan(0.1);
});

test("mouse drag and wheel control the camera while piloting without snapping back", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop mouse interaction");
  await reachStartScreen(page);
  await page.getByRole("button", { name: "BEGIN" }).click();
  await expect(page.locator(".topbar")).toBeVisible();

  const closeGuide = page.getByRole("button", { name: /close field guide/i });
  if (await closeGuide.isVisible()) await closeGuide.click();

  const canvas = page.locator("canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("No canvas bounding box");
  const x = box.x + box.width * 0.62;
  const y = box.y + box.height * 0.43;

  // A pan must consume its release click, while the very next ordinary click
  // must still reach placement. Spy on the bridge command so terrain validity
  // cannot make this gesture-ownership check flaky.
  await page.evaluate(() => {
    type Bridge = { place: (...args: unknown[]) => unknown };
    type DebugWindow = Window & { __viv?: { bridge?: Bridge }; __cameraPlaceCalls?: number };
    const debug = window as DebugWindow;
    const bridge = debug.__viv?.bridge;
    if (!bridge) throw new Error("No debug bridge is available");
    const place = bridge.place.bind(bridge);
    debug.__cameraPlaceCalls = 0;
    bridge.place = (...args: unknown[]) => {
      debug.__cameraPlaceCalls = (debug.__cameraPlaceCalls ?? 0) + 1;
      return place(...args);
    };
  });
  await page.getByRole("button", { name: /^Solar Array/ }).click();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y + 45, { steps: 6 });
  await page.mouse.up();
  expect(await page.evaluate(() => (window as Window & { __cameraPlaceCalls?: number }).__cameraPlaceCalls)).toBe(0);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(100); // placement resolves hover in the render loop
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  expect(await page.evaluate(() => (window as Window & { __cameraPlaceCalls?: number }).__cameraPlaceCalls)).toBe(1);
  await page.keyboard.press("Escape");

  await page.keyboard.press("f");
  await expect(page.locator(".pilot").first()).toContainText("PILOTING");
  await page.waitForTimeout(1_200); // let the automatic boarding transition settle

  const beforeZoom = await cameraPose(page);
  await page.mouse.move(x, y);
  await page.mouse.wheel(0, -450);
  await expect.poll(async () => (await cameraPose(page)).view).toBeLessThan(beforeZoom.view - 0.4);
  await page.waitForTimeout(800);
  expect((await cameraPose(page)).view).toBeLessThan(beforeZoom.view - 0.4);

  const beforePan = await cameraPose(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 150, y + 70, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const now = await cameraPose(page);
    return Math.hypot(now.x - beforePan.x, now.z - beforePan.z);
  }).toBeGreaterThan(0.5);

  // The follow camera keeps rendering every frame. Waiting here specifically
  // catches the old behavior where any direct camera mutation was overwritten.
  await page.waitForTimeout(900);
  const persisted = await cameraPose(page);
  expect(Math.hypot(persisted.x - beforePan.x, persisted.z - beforePan.z)).toBeGreaterThan(0.5);
  expect(persisted.view).toBeLessThan(beforeZoom.view - 0.4);

  // A same-world Reset is still a new run and must not inherit the old
  // piloting pan/zoom profile.
  await page.getByRole("button", { name: /reset/i }).first().click();
  await page.getByRole("button", { name: "RESET COLONY" }).click();
  await expect.poll(async () => Math.abs((await cameraPose(page)).view - 13)).toBeLessThan(0.05);
});

test("small screens explain the viewport requirement and recover in landscape", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "mobile adaptation check");
  await page.goto("/");
  await page.locator(".boot").click();

  await expect(page.getByRole("heading", { name: /field console/i })).toBeVisible();
  await expect(page.getByText(/joining one works right here/i)).toBeVisible();

  await page.setViewportSize({ width: 800, height: 600 });
  await expect(page.getByRole("heading", { name: /field console/i })).toBeHidden();
  const begin = page.getByRole("button", { name: "BEGIN" });
  await begin.scrollIntoViewIfNeeded();
  await expect(begin).toBeInViewport();

  await page.getByRole("button", { name: /how to play/i }).click();
  const help = page.getByRole("dialog", { name: /how to play/i });
  await expect(help).toBeVisible();
  await expect(help).toBeInViewport();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
