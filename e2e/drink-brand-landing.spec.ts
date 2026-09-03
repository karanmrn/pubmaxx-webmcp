import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const BRAND = "Guinness";
const BRAND_SLUG = "guinness";
const SUMMARY = "347 pubs with listed Guinness pints. Collected 3 July 2026.";
const TRACKED_PROOF_DIR = "docs/proof/drink-brand-landing";
type ProofScreenshotName =
  | "guinness-390-light.png"
  | "guinness-390-dark.png"
  | "guinness-1440-light.png";
const MOBILE_VIEWPORTS = [
  { width: 320, height: 844 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

function drinkBrandProofScreenshotPath(
  testInfo: TestInfo,
  fileName: ProofScreenshotName,
  updateProof = process.env.PUBMAX_UPDATE_DRINK_BRAND_PROOF === "1",
): string {
  return updateProof
    ? `${TRACKED_PROOF_DIR}/${fileName}`
    : testInfo.outputPath(fileName);
}

function watchBrowserErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  return errors;
}

async function setLandingState(page: Page): Promise<void> {
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  // Keep auth and analytics browser calls inside the deterministic keyless test
  // boundary. The product still mounts its real providers, but this proof does
  // not depend on a network-only Supabase project or Vercel runtime endpoint.
  await page.route("https://pubmaxx-e2e.supabase.co/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: "{}",
    }),
  );
  await page.route("**/_vercel/insights/script.js", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
  await page.routeWebSocket("wss://pubmaxx-e2e.supabase.co/realtime/v1/websocket**", () => {});
  await page.addInitScript(() => {
    if (!localStorage.getItem("pubmax-theme")) localStorage.setItem("pubmax-theme", "light");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

async function expectAboveFold(
  page: Page,
  locator: Locator,
  label: string,
): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.y, `${label} should start within the viewport`).toBeGreaterThanOrEqual(0);
  expect(
    box.y + box.height,
    `${label} should stay above the fold`,
  ).toBeLessThanOrEqual(page.viewportSize()?.height ?? 0);
}

async function expectTouchTarget(locator: Locator, label: string): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  expect(box.width, `${label} width should meet the 44px touch target`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${label} height should meet the 44px touch target`).toBeGreaterThanOrEqual(44);
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(dimensions.document, "document should not horizontally overflow").toBeLessThanOrEqual(
    dimensions.viewport + 1,
  );
  expect(dimensions.body, "body should not horizontally overflow").toBeLessThanOrEqual(
    dimensions.viewport + 1,
  );
}

async function expectHorizontallyInsideViewport(
  page: Page,
  locator: Locator,
  label: string,
): Promise<void> {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} should have a layout box`).not.toBeNull();
  if (!box) return;
  const viewportWidth = page.viewportSize()?.width ?? 0;
  expect(box.x, `${label} should start inside the viewport`).toBeGreaterThanOrEqual(0);
  expect(
    box.x + box.width,
    `${label} should end inside the viewport`,
  ).toBeLessThanOrEqual(viewportWidth + 1);
}

async function expectVisibleFocus(locator: Locator, label: string): Promise<void> {
  await locator.focus();
  await expect(locator, `${label} should receive keyboard focus`).toBeFocused();
  const focusStyle = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusStyle.outlineStyle, `${label} should show a focus outline`).not.toBe("none");
  expect(focusStyle.outlineWidth, `${label} should show a visible focus outline`).not.toBe("0px");
}

async function expectHeroPublisherLink(page: Page): Promise<void> {
  const status = page.locator(".drinkBrandDirectory__fromPublisher");
  await expect(status).toHaveText("Publisher: Pint Prices");

  const link = status.getByRole("link", {
    name: "Publisher: Pint Prices",
    exact: true,
  });
  await expect(link).toHaveAttribute(
    "href",
    /^https:\/\/www\.pint-prices\.com\/pub\//,
  );
  await expectTouchTarget(link, "hero publisher link");

  const colours = await link.evaluate((element) => {
    const heading = document.querySelector(".drinkBrandLanding h1");
    return {
      link: getComputedStyle(element).color,
      ink: heading ? getComputedStyle(heading).color : "",
    };
  });
  expect(colours.link, "hero publisher link should use the theme ink token").toBe(
    colours.ink,
  );
  await expectVisibleFocus(link, "hero publisher link");
}

async function assertLandingContract(page: Page): Promise<void> {
  const response = await page.goto(`/drink/${BRAND_SLUG}`, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole("heading", { level: 1, name: `Cheapest ${BRAND} pints in London`, exact: true }),
  ).toBeVisible();

  await expectAboveFold(page, page.locator(".drinkBrandDirectory__from strong"), "From price");
  await expect(page.locator(".drinkBrandDirectory__from strong")).toHaveText("From £3.09");
  await expectHeroPublisherLink(page);

  const summary = page.locator(".drinkBrandDirectory__summary");
  await expect(summary).toHaveText(SUMMARY);
  await expect(page.getByText("3 July 2026", { exact: false })).toHaveCount(1);

  const actions = page.locator(".drinkBrandDirectory__actions");
  await expectAboveFold(page, actions, "brand actions");
  const primaryAction = actions.getByRole("link", { name: `Find ${BRAND} on the map`, exact: true });
  const secondaryAction = actions.getByRole("link", {
    name: `Log a ${BRAND} pint price`,
    exact: true,
  });
  // ?brand= alone. decodeDrinkLens already fills the category from the brand,
  // and PubMap excludes beer from the selected lens, so ?drink=beer would not
  // select a lens. `log=1` names the venue it arms.
  await expect(primaryAction).toHaveAttribute("href", "/map?brand=guinness");
  await expect(secondaryAction).toHaveAttribute(
    "href",
    /^\/map\?sel=[^&]+&brand=guinness&log=1$/,
  );
  await expectTouchTarget(
    primaryAction,
    "Find on the map action",
  );
  await expectTouchTarget(
    secondaryAction,
    "Log pint price action",
  );
  await expect
    .poll(async () => primaryAction.evaluate((node) => getComputedStyle(node).textAlign))
    .toBe("center");

  const areaNav = page.getByRole("navigation", { name: `${BRAND} in other areas` });
  await expect(areaNav).toBeVisible();
  const areaLinks = areaNav.getByRole("link");
  expect(await areaLinks.count()).toBeGreaterThan(0);
  await expect(areaLinks.first()).toHaveAttribute("href", /\/area\/[^/]+\/drink\/guinness$/);

  const rows = page.locator(".drinkBrandDirectory__row");
  await expect(rows).toHaveCount(20);
  // The borough is its own cell, so a generated trailing separator would hang
  // with nothing after it.
  await expect
    .poll(async () =>
      rows
        .first()
        .locator(".drinkBrandDirectory__borough")
        .evaluate((node) => getComputedStyle(node, "::after").content),
    )
    .toBe("none");
  await expect(rows.first()).toContainText("J.J. Moon's - JD Wetherspoon");
  await expect(rows.first()).toContainText("£3.09");
  // One publisher block per price: the hero states the "From" figure's, and
  // every row states its own beside its own figure, rank 1 included
  // (docs/VOICE.md).
  await expect(page.locator(".drinkBrandDirectory__fromPublisher")).toHaveCount(1);
  await expect(page.locator(".drinkBrandDirectory__publisher")).toHaveCount(20);
  await expect(rows.first().locator(".drinkBrandDirectory__publisher")).toHaveCount(1);
  await expect(page.locator(".drinkBrandDirectory__venue")).toHaveCount(20);

  for (let index = 0; index < 20; index += 1) {
    const row = rows.nth(index);
    const rank = row.locator(".drinkBrandDirectory__rank");
    const price = row.locator(".drinkBrandDirectory__price");
    await expect(row.locator(".drinkBrandDirectory__venue")).toHaveCount(1);
    await expect(row.locator(".drinkBrandDirectory__publisher")).toHaveCount(1);
    await expectHorizontallyInsideViewport(page, rank, `row ${index + 1} rank`);
    await expectHorizontallyInsideViewport(page, price, `row ${index + 1} price`);
    await expectTouchTarget(row.locator(".drinkBrandDirectory__venue"), `row ${index + 1} Ledger link`);
    const publisherLink = row.locator(".drinkBrandDirectory__publisher a");
    if (await publisherLink.count()) {
      await expectTouchTarget(publisherLink, `row ${index + 1} publisher link`);
    }
  }

  await expectVisibleFocus(primaryAction, "Find on the map action");
  await expectVisibleFocus(secondaryAction, "Log pint price action");
  await expectVisibleFocus(rows.first().locator(".drinkBrandDirectory__venue"), "Ledger row link");
  await expectVisibleFocus(
    page.locator(".drinkBrandDirectory__fromPublisher a"),
    "hero publisher link",
  );
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
}

for (const viewport of MOBILE_VIEWPORTS) {
  test.describe(`governed Guinness landing at ${viewport.width}px`, () => {
    test.use({
      viewport,
      deviceScaleFactor: 1,
      hasTouch: true,
      isMobile: true,
    });

    test(`answers above the fold with touch-safe rows`, async ({ page }, testInfo) => {
      test.setTimeout(90_000);
      const errors = watchBrowserErrors(page);
      await setLandingState(page);
      expect(await page.evaluate(() => navigator.maxTouchPoints)).toBeGreaterThan(0);

      await assertLandingContract(page);

      if (viewport.width === 390) {
        expect(
          drinkBrandProofScreenshotPath(testInfo, "guinness-390-light.png", false),
          "normal validation should use Playwright output",
        ).toBe(testInfo.outputPath("guinness-390-light.png"));
        expect(
          drinkBrandProofScreenshotPath(testInfo, "guinness-390-light.png", true),
          "explicit proof refresh should use the tracked evidence path",
        ).toBe(`${TRACKED_PROOF_DIR}/guinness-390-light.png`);
        await page.screenshot({
          path: drinkBrandProofScreenshotPath(testInfo, "guinness-390-light.png"),
        });
        await page.evaluate(() => localStorage.setItem("pubmax-theme", "dark"));
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(
          page.getByRole("heading", { level: 1, name: `Cheapest ${BRAND} pints in London`, exact: true }),
        ).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
        await expectHeroPublisherLink(page);
        await expectNoHorizontalOverflow(page);
        await page.screenshot({
          path: drinkBrandProofScreenshotPath(testInfo, "guinness-390-dark.png"),
        });
      }

      expect(errors, "landing should not emit page or console errors").toEqual([]);
    });
  });
}

test.describe("Guinness landing cross-surface journey", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    hasTouch: true,
    isMobile: true,
  });

  test("keeps brand Map state, restores Back, and arms the explicit log picker", async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchBrowserErrors(page);
    await setLandingState(page);
    await assertLandingContract(page);

    await page.getByRole("link", { name: `Find ${BRAND} on the map`, exact: true }).click();
    await expect(page).toHaveURL(/\/map\?brand=guinness$/);
    const mapFilters = page.locator(".mobileMapFiltersButton");
    await expect(mapFilters).toBeVisible({ timeout: 45_000 });
    await mapFilters.click();
    const filtersSheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]:visible');
    await expect(filtersSheet).toBeVisible();
    await expect(
      filtersSheet.locator('select[aria-label="Favourite pint or beer brand"]'),
    ).toHaveValue(BRAND_SLUG);
    await filtersSheet.locator(".surfaceNavHome").click();
    await expect(filtersSheet).toHaveCount(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/drink\/guinness$/);
    await expect(
      page.getByRole("heading", { level: 1, name: `Cheapest ${BRAND} pints in London`, exact: true }),
    ).toBeVisible();

    const logLink = page.getByRole("link", {
      name: `Log a ${BRAND} pint price`,
      exact: true,
    });
    const logHref = await logLink.getAttribute("href");
    const namedVenueId = new URL(logHref ?? "", page.url()).searchParams.get("sel");
    // The page names a pub only when the map's eager shard carries it, so this
    // arrival RESOLVES: the pub's own sheet opens with the composer armed.
    expect(namedVenueId).not.toBeNull();

    await logLink.click();
    await expect(page).toHaveURL(/\/map\?sel=[^&]+&brand=guinness&log=1$/);
    const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    await expect(venueSheet.locator(".mobileSharedSheet")).toHaveClass(/open/, {
      timeout: 45_000,
    });
    await expect(page.locator("form.dropComposer")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator(".logIntentFallback")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("sel")).toBe(namedVenueId);

    expect(errors, "journey should not emit page or console errors").toEqual([]);
  });
});

test.describe("Guinness landing desktop proof", () => {
  test.use({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  });

  test("keeps the ranked answer readable at 1440px", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const errors = watchBrowserErrors(page);
    await setLandingState(page);
    await assertLandingContract(page);
    await expectVisibleFocus(
      page.getByRole("link", { name: `Find ${BRAND} on the map`, exact: true }),
      "desktop Find on the map action",
    );
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: drinkBrandProofScreenshotPath(testInfo, "guinness-1440-light.png"),
    });
    expect(errors, "desktop landing should not emit page or console errors").toEqual([]);
  });
});

test("unsupported drink brands return a 404", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // Chromium reports the expected document 404 as a resource error. Keep
    // every other console error visible to this contract.
    if (message.text() !== "Failed to load resource: the server responded with a status of 404 (Not Found)") {
      consoleErrors.push(message.text());
    }
  });
  const response = await page.goto("/drink/not-real", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(404);
  expect(pageErrors, "404 should not emit runtime page errors").toEqual([]);
  expect(consoleErrors, "404 should not emit unexpected console errors").toEqual([]);
});
