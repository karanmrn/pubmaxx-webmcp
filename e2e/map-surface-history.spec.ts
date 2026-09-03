import { expect, test, type Page, type TestInfo } from "@playwright/test";

const DESKTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };

async function prepareMap(page: Page, viewport = DESKTOP): Promise<void> {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem(
      "pubmax:map-first-visit-arrival:v1",
      "dismissed",
    );
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/citymcp/status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: null,
        weather: null,
        tubeLines: [],
        signals: [],
      }),
    }),
  );
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [],
        asOf: null,
        sourceObservedAt: null,
        sourceFreshnessKind: "unknown",
      }),
    }),
  );
}

async function openMap(page: Page, path = "/map"): Promise<void> {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  const viewport = page.viewportSize();
  const ready = viewport && viewport.width <= 640
    ? page.locator(".mobileMapTopbar")
    : page.locator(".mapToolbar");
  await expect(ready).toBeVisible({ timeout: 30_000 });
}

async function selectToolbarVenue(page: Page, query = "The French House"): Promise<void> {
  const search = page
    .locator(".mapToolbar")
    .getByRole("combobox", { name: "Search pubs" });
  await search.fill(query);
  const option = page.getByRole("option", { name: new RegExp(query, "i") }).first();
  await expect(option).toBeVisible({ timeout: 20_000 });
  await option.click();
}

async function selectFirstToolbarVenue(page: Page, query: string): Promise<void> {
  const search = page
    .locator(".mapToolbar")
    .getByRole("combobox", { name: "Search pubs" });
  await search.fill(query);
  const option = page
    .getByRole("group", { name: "Venues" })
    .getByRole("option")
    .first();
  await expect(option).toBeVisible({ timeout: 20_000 });
  await option.click();
}

function planner(page: Page) {
  return page.locator(".mapDrawer.left.springDrawer");
}

function venue(page: Page) {
  return page.locator(".mapDrawer.right.springDrawer");
}

async function expectSoleDrawer(page: Page, owner: "planner" | "venue"): Promise<void> {
  await expect(page.locator(".mapDrawer.springDrawer.open")).toHaveCount(1);
  await expect(planner(page)).toHaveAttribute(
    "aria-hidden",
    owner === "planner" ? "false" : "true",
  );
  await expect(venue(page)).toHaveAttribute(
    "aria-hidden",
    owner === "venue" ? "false" : "true",
  );
}

test.describe("one Map surface history owner", () => {
  test.setTimeout(120_000);

  test("venue to planner leaves exactly one desktop drawer", async ({ page }) => {
    await prepareMap(page);
    await openMap(page);
    await selectFirstToolbarVenue(page, "Soho");
    await expectSoleDrawer(page, "venue");

    await page
      .locator(".mapToolbar")
      .getByRole("button", { name: "Plan an outing" })
      .evaluate((button) => (button as HTMLElement).click());

    await expectSoleDrawer(page, "planner");
  });

  test("planner to venue leaves exactly one desktop drawer", async ({ page }) => {
    await prepareMap(page);
    await openMap(page);
    await page
      .locator(".mapToolbar")
      .getByRole("button", { name: "Plan an outing" })
      .click();
    await expectSoleDrawer(page, "planner");

    await selectFirstToolbarVenue(page, "Soho");

    await expectSoleDrawer(page, "venue");
  });

  test("loaded crawl browser Back restores populated planner", async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      window.localStorage.setItem(
        "pubmax:map-first-visit-arrival:v1",
        "dismissed",
      );
      window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
    });
    await page.route("**/api/whats-on**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          rows: [],
          asOf: null,
          sourceObservedAt: null,
          sourceFreshnessKind: "unknown",
        }),
      }),
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openMap(page, "/map?history-loaded-crawl=1");

    const onboarding = page.getByRole("dialog", { name: "Start with a story" });
    await expect(onboarding).toBeVisible({ timeout: 20_000 });
    await onboarding
      .getByRole("button", {
        name: "Load the Victorian Soho crawl, 5 stops",
      })
      .click();

    await expectSoleDrawer(page, "venue");
    await page.goBack();

    await expectSoleDrawer(page, "planner");
    await expect(planner(page).locator(".routeList > li")).toHaveCount(5);
  });

  test("immediate Back after venue to planner transition keeps correct surface with real predecessor", async ({
    page,
  }) => {
    await prepareMap(page);
    await page.goto("/tonight", { waitUntil: "domcontentloaded" });
    await openMap(page, "/map?history-race=1");
    await selectToolbarVenue(page);
    await expectSoleDrawer(page, "venue");
    await expect(page).toHaveURL(/\/map\?.*sel=/);

    await page
      .locator(".mapToolbar")
      .getByRole("button", { name: "Plan an outing" })
      .evaluate((button) => {
        (button as HTMLElement).click();
        window.history.back();
      });

    await expectSoleDrawer(page, "venue");
    await expect(page).toHaveURL(/\/map\?.*sel=/);
  });

  test("Escape restores populated planner from venue", async ({ page }) => {
    test.setTimeout(180_000);
    await prepareMap(page);
    await openMap(page);
    const toolbar = page.locator(".mapToolbar");
    const search = toolbar.getByRole("combobox", { name: "Search pubs" });
    await search.fill("Soho");
    await toolbar.getByRole("button", { name: "Plan an outing" }).click();
    await expectSoleDrawer(page, "planner");
    const heldStops = planner(page).locator(".routeList > li");
    await expect(heldStops.first()).toBeVisible();
    await heldStops.first().getByRole("button").click();
    await expectSoleDrawer(page, "venue");

    await page.keyboard.press("Escape");

    await expectSoleDrawer(page, "planner");
    await expect(planner(page).locator("#railSearchInput")).toHaveValue("Soho");
  });

  test("phone fling-dismiss leaves venue sheet for Map", async ({ page }) => {
    await prepareMap(page, PHONE);
    await openMap(page, "/map?sel=venue-xjf3n0");

    const portal = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    await expect(portal).toBeVisible({ timeout: 20_000 });
    const sheet = portal.locator(".mobileSharedSheet");
    const dragTarget = portal.locator(".mobileSharedSheetHeader");
    const [headerBox, sheetBox] = await Promise.all([
      dragTarget.boundingBox(),
      sheet.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(sheetBox).not.toBeNull();
    if (!headerBox || !sheetBox) throw new Error("phone sheet has no rendered box");
    const x = headerBox.x + 18;
    const y = headerBox.y + headerBox.height - 10;
    const dismissDistance = sheetBox.height - PHONE.height * 0.11 + 24;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(
      x,
      Math.min(PHONE.height - 8, y + dismissDistance),
      { steps: 2 },
    );
    await expect(sheet).toHaveClass(/sheet-dragging/);
    await page.mouse.up();

    await expect(portal).toHaveCount(0, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/map(?:\?.*)?$/);
  });

  test("captures light and dark proof at required viewports", async ({ page }, testInfo: TestInfo) => {
    test.setTimeout(180_000);
    for (const theme of ["light", "dark"] as const) {
      await prepareMap(page, PHONE);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
      await openMap(page, `/map?sel=venue-xjf3n0&history-proof=${theme}-390`);
      await expect(
        page
          .locator('.mobileSheetPortal[data-sheet-kind="venue"]')
          .getByRole("heading", { name: "Arnos Arms" }),
      ).toBeVisible({ timeout: 30_000 });
      await expect(
        page.locator('.mobileSheetPortal[data-sheet-kind="venue"] .mobileSharedSheet'),
      ).not.toHaveClass(/sheet-settling/, { timeout: 30_000 });
      await page.screenshot({
        path: testInfo.outputPath(`history-owner-390-${theme}-firefox.png`),
        animations: "disabled",
      });

      await page.setViewportSize(DESKTOP);
      await openMap(page, `/map?history-proof=${theme}-1440`);
      await page
        .locator(".mapToolbar")
        .getByRole("button", { name: "Plan an outing" })
        .click();
      await expectSoleDrawer(page, "planner");
      await expect(
        planner(page).getByText("Victorian Soho", { exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      await page.screenshot({
        path: testInfo.outputPath(`history-owner-1440-${theme}-firefox.png`),
        animations: "disabled",
      });
    }
  });
});
