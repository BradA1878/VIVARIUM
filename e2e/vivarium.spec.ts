import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function reachStartScreen(page: Page): Promise<void> {
  await page.goto("/");
  // The intro auto-dismisses and disables pointer events during its 480 ms
  // fade. A Playwright actionability click can begin just as that happens,
  // then retry against a node that has been removed (especially on slower CI
  // runners). This test is not about the intro animation, so atomically finish
  // it only when the button still exists.
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".boot")?.click());
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
  await expect(help).toContainText("EARTH RESUPPLY");
  await expect(help).toContainText("automatically adds power, water, oxygen, and food");
  await expect(help).toContainText("No action is required");
  await expect(help.getByRole("heading", { name: "SHELTER + INJURIES" })).toBeVisible();
  await expect(help).toContainText("unpiloted crew automatically head for the nearest connected, sealed shelter");
  await expect(help).toContainText("Shelter protects them from quake jolts once they arrive");
  await expect(help).toContainText("piloted crew remain exposed until released");
  await expect(help).toContainText("One event cannot hit the same crew member twice");
  await expect(help).toContainText("If a new meteor or quake arrives before a wound heals, another hit can be lethal");
  await expect(help).toContainText("powered, connected Med-Bay");
  await expect(help).toContainText("TRADERS + ALIEN TECH");
  await expect(help).toContainText("the exact effect starts immediately");
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

test("the normal HUD exposes a wounded-crew status without overflowing its rail", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop colony HUD");
  await page.setViewportSize({ width: 760, height: 600 });
  await reachStartScreen(page);
  await page.getByRole("button", { name: "BEGIN" }).click();
  await expect(page.locator(".topbar")).toBeVisible();

  const closeGuide = page.getByRole("button", { name: /close field guide/i });
  if (await closeGuide.isVisible()) await closeGuide.click();

  // The live region exists before a warning is inserted, so assistive tech can
  // announce the later addition without hearing every countdown mutation.
  await expect(page.locator(".alerts")).toHaveCount(1);

  await page.evaluate(async () => {
    type InjurySave = {
      state: {
        paused: boolean;
        colonists: { injury: number }[];
        hazardCounter: number;
        hazards: {
          id: number;
          kind: "quake";
          phase: "telegraph";
          tLeft: number;
          activeDur: number;
          intensity: number;
          cadence: number;
        }[];
      };
    };
    type DebugBridge = {
      save(): Promise<InjurySave>;
      load(save: InjurySave): Promise<unknown>;
    };
    const bridge = (window as Window & { __viv?: { bridge?: DebugBridge } }).__viv?.bridge;
    if (!bridge) throw new Error("No debug bridge is available");
    const save = await bridge.save();
    const colonist = save.state.colonists[0];
    if (!colonist) throw new Error("No crew member is available to wound");
    save.state.paused = true;
    colonist.injury = 30;
    save.state.hazards = [{
      id: save.state.hazardCounter++,
      kind: "quake",
      phase: "telegraph",
      tLeft: 4,
      activeDur: 10,
      intensity: 0.8,
      cadence: 1.6,
    }];
    await bridge.load(save);
  });

  const status = page.locator(".crew-injury");
  await expect(status).toBeVisible();
  await expect(status).toHaveAttribute("role", "status");
  await expect(status).toHaveAttribute("aria-live", "polite");
  await expect(status).toContainText("1 WOUNDED");
  await expect(status).toContainText("OFF SHIFT");
  await expect(status).toContainText("MED-BAY SPEEDS RECOVERY");

  const quakeAlert = page.locator(".alerts .alert").filter({ hasText: "MARSQUAKE" });
  await expect(quakeAlert).toContainText("crew evacuating");
  await expect(quakeAlert).toContainText("release any pilot to shelter");
  await expect(quakeAlert).toContainText("exposed crew can be injured");
  await expect(quakeAlert).toContainText("seals at risk");
  await expect(page.locator(".alerts")).toHaveAttribute("aria-relevant", "additions");
  await expect(page.getByRole("button", { name: /storm/i })).toBeDisabled();

  const [railBox, statusBox, alertRailBox, alertBox] = await Promise.all([
    page.locator(".left-col").boundingBox(),
    status.boundingBox(),
    page.locator(".right-col").boundingBox(),
    quakeAlert.boundingBox(),
  ]);
  if (!railBox || !statusBox || !alertRailBox || !alertBox) throw new Error("HUD geometry is unavailable");
  expect(statusBox.x).toBeGreaterThanOrEqual(railBox.x);
  expect(statusBox.x + statusBox.width).toBeLessThanOrEqual(railBox.x + railBox.width + 1);
  expect(alertBox.x).toBeGreaterThanOrEqual(alertRailBox.x);
  expect(alertBox.x + alertBox.width).toBeLessThanOrEqual(alertRailBox.x + alertRailBox.width + 1);

  const results = await new AxeBuilder({ page })
    .include(".crew-injury")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);
});

test("a quake defeat reports the impact while preserving the resource record", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop end-of-run report");
  await page.setViewportSize({ width: 760, height: 600 });
  await reachStartScreen(page);
  await page.getByRole("button", { name: "BEGIN" }).click();

  const closeGuide = page.getByRole("button", { name: /close field guide/i });
  if (await closeGuide.isVisible()) await closeGuide.click();

  await page.evaluate(async () => {
    type EndSave = {
      state: {
        paused: boolean;
        outcome: "defeat" | null;
        outcomeReason: string;
        defeatCause: { type: "strike"; hazard: "quake" } | null;
        population: number;
        dead: number;
        abducted: number;
        colonists: unknown[];
        pools: Record<"power" | "water" | "oxygen" | "food", { amount: number; capacity: number }>;
        timers: Record<"water" | "oxygen" | "food", number | null>;
      };
    };
    type DebugBridge = {
      save(): Promise<EndSave>;
      load(save: EndSave): Promise<unknown>;
    };
    const bridge = (window as Window & { __viv?: { bridge?: DebugBridge } }).__viv?.bridge;
    if (!bridge) throw new Error("No debug bridge is available");
    const save = await bridge.save();
    save.state.paused = true;
    save.state.outcome = "defeat";
    save.state.outcomeReason = "colony";
    save.state.defeatCause = { type: "strike", hazard: "quake" };
    save.state.population = 0;
    save.state.dead = 3;
    save.state.abducted = 1;
    save.state.colonists = [];
    for (const pool of Object.values(save.state.pools)) pool.amount = pool.capacity;
    save.state.timers = { oxygen: null, water: null, food: null };
    await bridge.load(save);
  });

  const report = page.locator(".endscreen");
  await expect(report).toBeVisible();
  await expect(report.locator(".end-mark")).toHaveText("THE COLONY IS LOST");
  await expect(report.locator(".end-sub")).toHaveText("The final crew member was lost to a marsquake strike.");
  await expect(report.locator(".end-epitaph")).toHaveText(
    "A marsquake strike claimed the final crew member. All resource reserves remained above zero.",
  );
  await expect(report.locator(".end-stats")).toContainText("0 survived");
  await expect(report.locator(".end-stats")).toContainText("3 dead");
  await expect(report.locator(".end-stats")).toContainText("1 abducted");
  await expect(report).not.toContainText(/everything failed|stopped breathing/i);
  const [reportBox, statsBox] = await Promise.all([
    report.locator(".end-inner").boundingBox(),
    report.locator(".end-stats").boundingBox(),
  ]);
  if (!reportBox || !statsBox) throw new Error("End-report geometry is unavailable");
  expect(statsBox.x).toBeGreaterThanOrEqual(reportBox.x);
  expect(statsBox.x + statsBox.width).toBeLessThanOrEqual(reportBox.x + reportBox.width + 1);
  expect(await report.locator(".end-stats").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
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

test("visible camera zoom controls work from the keyboard and expose clear names", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop keyboard interaction");
  await reachStartScreen(page);
  await page.getByRole("button", { name: "BEGIN" }).click();
  await expect(page.locator(".topbar")).toBeVisible();

  const closeGuide = page.getByRole("button", { name: /close field guide/i });
  if (await closeGuide.isVisible()) await closeGuide.click();

  const zoom = page.getByRole("group", { name: "Camera zoom controls" });
  const zoomIn = page.getByRole("button", { name: "Zoom camera in" });
  const zoomOut = page.getByRole("button", { name: "Zoom camera out" });
  await expect(zoom).toBeVisible();
  await expect(zoomIn).toHaveAttribute("title", "Zoom camera in");
  await expect(zoomOut).toHaveAttribute("title", "Zoom camera out");

  const before = await cameraPose(page);
  await zoomIn.focus();
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await cameraPose(page)).view).toBeLessThan(before.view - 0.5);
  const zoomedIn = await cameraPose(page);

  await zoomOut.focus();
  await page.keyboard.press("Space");
  await expect.poll(async () => (await cameraPose(page)).view).toBeGreaterThan(zoomedIn.view + 0.5);
  await expect(zoomOut).toBeFocused();

  const results = await new AxeBuilder({ page })
    .include(".camera-zoom")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);
});

test("accepting alien tech reveals and proves its permanent active effect", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "desktop trade interaction");
  await reachStartScreen(page);
  await page.getByRole("button", { name: "BEGIN" }).click();
  await expect(page.locator(".topbar")).toBeVisible();

  const closeGuide = page.getByRole("button", { name: /close field guide/i });
  if (await closeGuide.isVisible()) await closeGuide.click();
  const techAnnouncement = page.locator(".notice-layer .sr-only");
  await expect(techAnnouncement).toHaveText("");

  const capacityBefore = await page.evaluate(async () => {
    type TechSave = {
      state: {
        materials: { amount: number };
        acquiredTech: string[];
        tradeCounter: number;
        trade: {
          id: number;
          phase: "landed";
          give: { res: "tech"; amount: number; tech: string };
          take: { res: "materials"; amount: number };
          tLeft: number;
          gx: number;
          gy: number;
        } | null;
      };
    };
    type DebugBridge = {
      save(): Promise<TechSave>;
      load(save: TechSave): Promise<unknown>;
      latest: { pools: { power: { capacity: number } }; acquiredTech: string[] } | null;
    };
    const bridge = (window as Window & { __viv?: { bridge?: DebugBridge } }).__viv?.bridge;
    if (!bridge) throw new Error("No debug bridge is available");
    const save = await bridge.save();
    save.state.materials.amount = 100;
    save.state.acquiredTech = save.state.acquiredTech.filter((id) => id !== "capacitor");
    save.state.trade = {
      id: save.state.tradeCounter++,
      phase: "landed",
      give: { res: "tech", amount: 1, tech: "capacitor" },
      take: { res: "materials", amount: 40 },
      tLeft: 30,
      gx: 1,
      gy: 1,
    };
    await bridge.load(save);
    if (!bridge.latest) throw new Error("Loaded snapshot is unavailable");
    return bridge.latest.pools.power.capacity;
  });

  const integrate = page.getByRole("button", { name: /integrate tech/i });
  await expect(integrate).toBeVisible();
  await expect(page.locator(".trade-panel")).toContainText("PERMANENT EFFECT");
  await expect(page.locator(".trade-panel")).toContainText("+140 kW maximum power capacity");
  await integrate.click();

  const reveal = page.locator(".tech-reveal");
  await expect(reveal).toBeVisible();
  await expect(reveal).toContainText("NONHUMAN SYSTEM INTEGRATED");
  await expect(reveal).toContainText("Capacitor Lattice");
  await expect(reveal).toContainText("+140 kW maximum power capacity");
  await expect(reveal).toContainText("This technology stays with this colony");
  await expect(techAnnouncement).toContainText("Permanent effect active now");

  const results = await new AxeBuilder({ page })
    .include(".tech-reveal")
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  expect(blocking, blocking.map((v) => `${v.id}: ${v.help}`).join("\n")).toEqual([]);

  await page.getByRole("button", { name: /dismiss alien tech notice/i }).click();
  await expect(reveal).toBeHidden();

  const ledger = page.locator(".alien-tech");
  await expect(ledger).toContainText("PERMANENT");
  await expect(ledger).toContainText("Capacitor Lattice");
  await expect(ledger).toContainText("+140 kW maximum power capacity");
  await expect.poll(() => page.evaluate(() => {
    type DebugSnapshot = { pools: { power: { capacity: number } }; acquiredTech: string[] };
    const latest = (window as Window & { __viv?: { bridge?: { latest?: DebugSnapshot | null } } })
      .__viv?.bridge?.latest;
    return {
      capacity: latest?.pools.power.capacity ?? -1,
      acquired: latest?.acquiredTech.includes("capacitor") ?? false,
    };
  })).toEqual({ capacity: capacityBefore + 140, acquired: true });
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
  await page.evaluate(() => document.querySelector<HTMLButtonElement>(".boot")?.click());

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
