import { expect, test } from "@playwright/test";

/* Field Console (tier 2 phone astronaut): below the 560×440 floor the gate is
   a join fork, not a wall. Only offline-assertable paths run here — no host
   answers in CI, which IS the `failed` story (JOIN_TIMEOUT_MS = 15 s; a
   network-less environment fails faster through the join catch). The live
   two-client loop is the documented manual check in docs/development.md. */

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

test("phone: the gate is a field console with a join form", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "phone adaptation check");
  await page.goto("/");
  await page.locator(".boot").click({ timeout: 4_000 }).catch(() => {});

  await expect(page.getByRole("heading", { name: /field console/i })).toBeVisible();
  await expect(page.getByText(/joining one works right here/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /join as astronaut/i })).toBeDisabled(); // no code yet
  await page.getByPlaceholder("e.g. marsbase").fill("someroom");
  await expect(page.getByRole("button", { name: /join as astronaut/i })).toBeEnabled();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test("phone: ?join= prefills the code and a dead room reports failure", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes("mobile"), "phone adaptation check");
  test.setTimeout(90_000); // rides out JOIN_TIMEOUT_MS with margin
  const deadRoom = `e2e-dead-${Date.now().toString(36)}`; // unique → no stranger's host can answer
  await page.goto(`/?join=${deadRoom}`);
  await page.locator(".boot").click({ timeout: 4_000 }).catch(() => {});

  await expect(page.getByPlaceholder("e.g. marsbase")).toHaveValue(deadRoom);
  await page.getByPlaceholder("your name").fill("Ada");
  await page.getByRole("button", { name: /join as astronaut/i }).click();

  // end state only — `connecting` may be too brief to assert when the network
  // layer throws immediately (offline CI). Scoped to the gate's status line:
  // the sim-error banner under the gate reports the same timeout wording.
  await expect(page.locator(".gate-status")).toHaveText(/no host answered/i, { timeout: 30_000 });
  await expect(page.getByPlaceholder("e.g. marsbase")).toHaveValue(deadRoom); // code survives for retry
});
