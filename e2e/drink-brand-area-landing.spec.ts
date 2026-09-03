import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";

const AREA_SLUG = "victoria";
const AREA_NAME = "Victoria";
const BRAND_SLUG = "guinness";
const BRAND_LABEL = "Guinness";
const LANDING_PATH = `/area/${AREA_SLUG}/drink/${BRAND_SLUG}`;
const TRACKED_PROOF_DIR = "docs/proof/drink-brand-area-landing";
// Checked browser fixture for Victoria and Guinness on 3 July 2026. Unit
// tests own policy and dataset derivation; this proof owns rendered URLs.
const CHECKED_VICTORIA_GUINNESS_FIXTURE = {
  totalPricedVenues: 17,
  collectionDate: "3 July 2026",
  firstRow: {
    venueId: "venue-1duinu2",
    venueName: "Alma",
    priceLabel: "£5.50",
    publisherStatus: "Publisher: Pint Prices",
  },
  orderedVenueIds: [
    "venue-1duinu2",
    "venue-s4j91a",
    "venue-ra82d1",
    "venue-pelryu",
    "venue-18vbvjc",
    "venue-brpr9s",
    "venue-1rvq067",
    "venue-vpuut8",
    "venue-1gefp76",
    "venue-1rrqimj",
    "venue-14xhi57",
    "venue-f7pmqo",
    "venue-i9us8j",
    "venue-1a6n6da",
    "venue-gugv4t",
    "venue-iec6ez",
    "venue-ukflm",
  ],
} as const;
const MOBILE_VIEWPORTS = [
  { name: "320", width: 320, height: 844, hasTouch: true, isMobile: true },
  { name: "390", width: 390, height: 844, hasTouch: true, isMobile: true },
  { name: "430", width: 430, height: 932, hasTouch: true, isMobile: true },
] as const;
const DESKTOP_VIEWPORT = {
  name: "1440",
  width: 1440,
  height: 900,
  hasTouch: false,
  isMobile: false,
} as const;
const THEMES = ["light", "dark"] as const;

type Theme = (typeof THEMES)[number];

function proofScreenshotPath(
  testInfo: TestInfo,
  fileName: string,
  updateProof = process.env.PUBMAX_UPDATE_DRINK_BRAND_AREA_PROOF === "1",
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

async function setLandingState(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
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
  await page.addInitScript((nextTheme) => {
    localStorage.setItem("pubmax-theme", nextTheme);
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  }, theme);
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

async function expectVisibleFocus(locator: Locator, label: string): Promise<void> {
  await locator.focus();
  await expect(locator, `${label} should receive keyboard focus`).toBeFocused();
  const focusStyle = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      matchesFocusVisible: element.matches(":focus-visible"),
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  expect(focusStyle.matchesFocusVisible, `${label} should match :focus-visible`).toBe(true);
  expect(focusStyle.outlineStyle, `${label} should show a focus outline`).not.toBe("none");
  expect(focusStyle.outlineWidth, `${label} should show a visible focus outline`).not.toBe("0px");
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

async function expectGlobalNavigationInViewport(page: Page): Promise<void> {
  const geometry = await page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".siteNavBar");
    if (!nav) return { missing: true } as const;

    const viewportWidth = window.innerWidth;
    const navRect = nav.getBoundingClientRect();
    const visibleControls = Array.from(nav.querySelectorAll<HTMLElement>("a, button")).filter(
      (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      },
    );
    const outOfViewport = visibleControls.filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > viewportWidth + 1;
    }).length;
    const clippingAncestors: string[] = [];
    for (let ancestor = nav.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const clipsX = ["hidden", "clip", "scroll", "auto"].includes(style.overflowX);
      if (!clipsX) continue;
      const rect = ancestor.getBoundingClientRect();
      if (navRect.left < rect.left - 1 || navRect.right > rect.right + 1) {
        clippingAncestors.push(ancestor.className || ancestor.tagName);
      }
    }
    return {
      missing: false,
      nav: { left: navRect.left, right: navRect.right },
      viewportWidth,
      visibleControlCount: visibleControls.length,
      outOfViewport,
      clippingAncestors,
    } as const;
  });

  expect(geometry.missing, "global SiteNav should render").toBe(false);
  if (geometry.missing) return;
  expect(geometry.nav.left, "global SiteNav should start inside viewport").toBeGreaterThanOrEqual(0);
  expect(geometry.nav.right, "global SiteNav should end inside viewport").toBeLessThanOrEqual(
    geometry.viewportWidth + 1,
  );
  expect(geometry.visibleControlCount, "global SiteNav should expose visible controls").toBeGreaterThan(0);
  expect(geometry.outOfViewport, "global SiteNav controls should stay inside viewport").toBe(0);
  expect(geometry.clippingAncestors, "global SiteNav should not be clipped by its route shell").toEqual([]);
}

async function expectDesktopRowGeometry(page: Page, rows: Locator): Promise<void> {
  if ((page.viewportSize()?.width ?? 0) <= 560) return;

  const geometry = await rows.evaluateAll((elements) =>
    elements.map((element) => {
      const row = element as HTMLElement;
      const details = row.querySelector<HTMLElement>(".drinkBrandDirectory__details");
      const action = row.querySelector<HTMLElement>(".drinkBrandDirectory__contribution");
      return {
        rowHeight: row.getBoundingClientRect().height,
        detailsColumns: details ? getComputedStyle(details).gridTemplateColumns : "",
        actionColumnStart: action ? getComputedStyle(action).gridColumnStart : null,
      };
    }),
  );
  expect(
    geometry.every(({ rowHeight }) => rowHeight >= 56),
    "desktop rows should retain touch-safe density",
  ).toBe(true);
  expect(
    geometry.every(({ rowHeight }) => rowHeight <= 96),
    "desktop rows should use compact density",
  ).toBe(true);
  expect(
    geometry.every(({ detailsColumns }) => detailsColumns.split(" ").length === 5),
    "desktop row details should use five horizontal information tracks",
  ).toBe(true);
  // The action owns the last track by name, so a row whose details ever come
  // back short cannot slide it into a sibling's column. The CSS states the
  // rule as a track, so the track is what is asserted: a rendered edge would
  // also move with the action's own label width, and the label differs by
  // whether the row's pub is one the map can open.
  const actionColumnStarts = geometry
    .map(({ actionColumnStart }) => actionColumnStart)
    .filter((start): start is string => start !== null);
  expect(actionColumnStarts.length, "every desktop row should carry a log action").toBe(
    geometry.length,
  );
  expect(
    actionColumnStarts.every((start) => start === "5"),
    `every row's log action should sit in the last track, saw ${[...new Set(actionColumnStarts)].join(", ")}`,
  ).toBe(true);
}

// Never ?q=<area name>: `q` is a free-text VENUE filter, so an area name
// narrows the map to whatever pubs happen to carry those words. The arrival is
// a pub. `?brand=` alone: decodeDrinkLens fills the category from the brand,
// and PubMap excludes beer from the selected lens.
function expectedMapHref(venueId: string): string {
  const params = new URLSearchParams({ sel: venueId, brand: BRAND_SLUG });
  return `/map?${params.toString()}`;
}

function expectedContributionHref(venueId: string): string {
  return `${expectedMapHref(venueId)}&log=1`;
}

async function assertLandingContract(
  page: Page,
  theme: Theme,
  viewportName: string,
): Promise<void> {
  const response = await page.goto(LANDING_PATH, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

  const heading = page.getByRole("heading", {
    level: 1,
    name: `Cheapest ${BRAND_LABEL} pints in ${AREA_NAME}`,
    exact: true,
  });
  const fromPrice = page.locator(".drinkBrandDirectory__from strong");
  const heroPublisher = page.locator(".drinkBrandDirectory__fromPublisher");
  const summary = page.locator(".drinkBrandDirectory__summary");
  const primaryAction = page.getByRole("link", {
    name: `Open the cheapest ${AREA_NAME} pint on the map`,
    exact: true,
  });

  await expectAboveFold(page, heading, `${viewportName}px ${theme} H1`);
  await expectAboveFold(page, fromPrice, `${viewportName}px ${theme} cheapest answer`);
  await expectAboveFold(page, heroPublisher, `${viewportName}px ${theme} publisher status`);
  await expectAboveFold(page, summary, `${viewportName}px ${theme} collection summary`);
  await expectAboveFold(page, primaryAction, `${viewportName}px ${theme} primary action`);
  await expect(fromPrice).toHaveText(`From ${CHECKED_VICTORIA_GUINNESS_FIXTURE.firstRow.priceLabel}`);
  await expect(heroPublisher).toHaveText(CHECKED_VICTORIA_GUINNESS_FIXTURE.firstRow.publisherStatus);
  await expect(summary).toHaveText(
    `${CHECKED_VICTORIA_GUINNESS_FIXTURE.totalPricedVenues} pubs with listed ${BRAND_LABEL} pints. Collected ${CHECKED_VICTORIA_GUINNESS_FIXTURE.collectionDate}.`,
  );
  await expect(primaryAction).toHaveAttribute(
    "href",
    expectedMapHref(CHECKED_VICTORIA_GUINNESS_FIXTURE.firstRow.venueId),
  );
  await expectTouchTarget(primaryAction, `${viewportName}px ${theme} primary action`);
  await expect
    .poll(async () => primaryAction.evaluate((node) => getComputedStyle(node).textAlign))
    .toBe("center");
  await expectVisibleFocus(primaryAction, `${viewportName}px ${theme} primary action`);
  await expectVisibleFocus(
    heroPublisher.getByRole("link", {
      name: CHECKED_VICTORIA_GUINNESS_FIXTURE.firstRow.publisherStatus,
      exact: true,
    }),
    `${viewportName}px ${theme} hero publisher link`,
  );
  await expectGlobalNavigationInViewport(page);

  const rows = page.locator(".drinkBrandDirectory__row");
  await expect(rows).toHaveCount(CHECKED_VICTORIA_GUINNESS_FIXTURE.orderedVenueIds.length);
  expect(
    await rows.count(),
    "rendered row count should match the checked Victoria/Guinness pub ids",
  ).toBe(CHECKED_VICTORIA_GUINNESS_FIXTURE.orderedVenueIds.length);
  const summaryVenueCount = Number((await summary.innerText()).match(/^\d+/)?.[0]);
  expect(summaryVenueCount, "collection summary count should be numeric").toBe(
    CHECKED_VICTORIA_GUINNESS_FIXTURE.totalPricedVenues,
  );
  expect(
    summaryVenueCount,
    "collection summary should include every rendered Ledger row within its row cap",
  ).toBeGreaterThanOrEqual(await rows.count());
  expect(
    CHECKED_VICTORIA_GUINNESS_FIXTURE.totalPricedVenues,
    "governed total should include every rendered Ledger row within its row cap",
  ).toBeGreaterThanOrEqual(CHECKED_VICTORIA_GUINNESS_FIXTURE.orderedVenueIds.length);
  expect(CHECKED_VICTORIA_GUINNESS_FIXTURE.orderedVenueIds[0]).toBe(
    CHECKED_VICTORIA_GUINNESS_FIXTURE.firstRow.venueId,
  );
  const priceTexts = await rows.locator(".drinkBrandDirectory__price").allTextContents();
  const prices = priceTexts.map((text) => Number(text.replace(/[^\d.]/g, "")));
  expect(prices.every(Number.isFinite), "every ranked price should be numeric").toBe(true);
  for (let index = 1; index < prices.length; index += 1) {
    expect(
      prices[index],
      `row ${index + 1} price should not be below row ${index} price`,
    ).toBeGreaterThanOrEqual(prices[index - 1]!);
  }
  await expect(fromPrice).toHaveText(`From ${CHECKED_VICTORIA_GUINNESS_FIXTURE.firstRow.priceLabel}`);

  const firstRow = rows.first();
  const firstVenue = firstRow.locator(".drinkBrandDirectory__venue");
  const firstContribution = firstRow.getByRole("link", { name: "Log this price", exact: true });
  // Every rank states its own publisher beside its own figure, rank 1
  // included: the hero's copy sits above the h1 (docs/VOICE.md).
  await expect(firstRow.locator(".drinkBrandDirectory__publisher")).toHaveCount(1);
  const firstLedgerHref = `/ledger/${encodeURIComponent(CHECKED_VICTORIA_GUINNESS_FIXTURE.firstRow.venueId)}`;
  const firstContributionHref = expectedContributionHref(
    CHECKED_VICTORIA_GUINNESS_FIXTURE.firstRow.venueId,
  );
  await expect(firstVenue).toHaveText(CHECKED_VICTORIA_GUINNESS_FIXTURE.firstRow.venueName);
  await expect(firstVenue).toHaveAttribute("href", firstLedgerHref);
  await expect(firstRow.locator(".drinkBrandDirectory__price")).toHaveText(
    CHECKED_VICTORIA_GUINNESS_FIXTURE.firstRow.priceLabel,
  );
  await expect(firstContribution).toHaveAttribute("href", firstContributionHref);

  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    const venue = row.locator(".drinkBrandDirectory__venue");
    const pint = row.locator(".drinkBrandDirectory__pint");
    const publisher = row.locator(".drinkBrandDirectory__publisher");
    const contribution = row.getByRole("link", { name: "Log this price", exact: true });
    const price = row.locator(".drinkBrandDirectory__price");

    await expect(venue, `row ${index + 1} pub should be visible`).toBeVisible();
    await expect(pint, `row ${index + 1} pint should be visible`).toBeVisible();
    await expect(
      publisher,
      `row ${index + 1} publisher should state its own record`,
    ).toHaveCount(1);
    await expect(contribution, `row ${index + 1} log action should be visible`).toBeVisible();
    await expect(price, `row ${index + 1} price should be visible`).toBeVisible();
    await expectTouchTarget(venue, `row ${index + 1} pub`);
    await expectTouchTarget(contribution, `row ${index + 1} log action`);
    await expectHorizontallyInsideViewport(page, venue, `row ${index + 1} pub`);
    await expectHorizontallyInsideViewport(page, pint, `row ${index + 1} pint`);
    await expectHorizontallyInsideViewport(page, contribution, `row ${index + 1} log action`);
    await expectHorizontallyInsideViewport(page, price, `row ${index + 1} price`);
    await expect(publisher, `row ${index + 1} publisher should be visible`).toBeVisible();
    await expectHorizontallyInsideViewport(page, publisher, `row ${index + 1} publisher`);

    const expectedVenueId = CHECKED_VICTORIA_GUINNESS_FIXTURE.orderedVenueIds[index];
    expect(expectedVenueId, `row ${index + 1} should have a checked fixture identity`).toBeDefined();
    if (!expectedVenueId) continue;
    const expectedLedgerHref = `/ledger/${encodeURIComponent(expectedVenueId)}`;
    const contributionHref = expectedContributionHref(expectedVenueId);
    await expect(venue, `row ${index + 1} pub should match governed fixture order`).toHaveAttribute(
      "href",
      expectedLedgerHref,
    );
    await expect(contribution).toHaveAttribute("href", contributionHref);

    const publisherLink = publisher.getByRole("link");
    if (await publisherLink.count()) {
      await expectTouchTarget(publisherLink, `row ${index + 1} publisher link`);
      await expectVisibleFocus(publisherLink, `${viewportName}px ${theme} row ${index + 1} publisher link`);
    }
    await expectVisibleFocus(venue, `${viewportName}px ${theme} row ${index + 1} pub link`);
    await expectVisibleFocus(contribution, `${viewportName}px ${theme} row ${index + 1} log action`);
  }

  await expectDesktopRowGeometry(page, rows);
  await expectNoHorizontalOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function assertExactMapJourneys(page: Page): Promise<void> {
  const expectedPrimaryPath = expectedMapHref(
    CHECKED_VICTORIA_GUINNESS_FIXTURE.firstRow.venueId,
  );
  const expectedRowPath = expectedContributionHref(
    CHECKED_VICTORIA_GUINNESS_FIXTURE.firstRow.venueId,
  );
  const assertPath = (expected: string) => {
    const current = new URL(page.url());
    expect(`${current.pathname}${current.search}`).toBe(expected);
  };

  const primaryAction = page.getByRole("link", {
    name: `Open the cheapest ${AREA_NAME} pint on the map`,
    exact: true,
  });
  await Promise.all([
    page.waitForURL(
      (url) => `${url.pathname}${url.search}` === expectedPrimaryPath,
      { waitUntil: "commit" },
    ),
    primaryAction.click(),
  ]);
  assertPath(expectedPrimaryPath);

  await page.goto(LANDING_PATH, { waitUntil: "domcontentloaded" });
  const firstContribution = page
    .locator(".drinkBrandDirectory__row")
    .first()
    .getByRole("link", { name: "Log this price", exact: true });
  await Promise.all([
    page.waitForURL(
      (url) => `${url.pathname}${url.search}` === expectedRowPath,
      { waitUntil: "commit" },
    ),
    firstContribution.click(),
  ]);
  assertPath(expectedRowPath);
}

for (const viewport of [...MOBILE_VIEWPORTS, DESKTOP_VIEWPORT]) {
  for (const theme of THEMES) {
    test.describe(`${viewport.name}px ${theme} governed brand area landing`, () => {
      test.use({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        hasTouch: viewport.hasTouch,
        isMobile: viewport.isMobile,
      });

      test("answers above fold with exact touch-safe actions", async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        const errors = watchBrowserErrors(page);
        await setLandingState(page, theme);
        await assertLandingContract(page, theme, viewport.name);
        await page.screenshot({
          path: proofScreenshotPath(
            testInfo,
            `victoria-guinness-${viewport.name}-${theme}.png`,
          ),
          fullPage: false,
        });
        if (viewport.name === "390" && theme === "light") {
          // URL-only journey proof intentionally stops at Map. It does not wait
          // on private auth, a venue picker, or contribution submission.
          await assertExactMapJourneys(page);
        }
        expect(errors, `${viewport.name}px ${theme} landing should not emit browser errors`).toEqual([]);
      });
    });
  }
}

for (const viewport of MOBILE_VIEWPORTS) {
  test.describe(`${viewport.name}px capped Clapham Guinness Ledger count`, () => {
    test.use({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      hasTouch: viewport.hasTouch,
      isMobile: viewport.isMobile,
    });

    test("keeps full capped count visible without clipping", async ({ page }) => {
      test.setTimeout(90_000);
      await setLandingState(page, "light");
      const response = await page.goto(
        "/area/clapham/drink/guinness",
        { waitUntil: "domcontentloaded" },
      );
      expect(response?.status()).toBe(200);

      const count = page.locator(".drinkBrandDirectory__sectionCount");
      await expect(count).toHaveText(/^Showing 20 of \d+ pubs$/);
      await expect(count).toBeVisible();

      const geometry = await count.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          width: rect.width,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          clientHeight: element.clientHeight,
          scrollHeight: element.scrollHeight,
        };
      });
      expect(geometry.width, "capped count should have a layout box").toBeGreaterThan(0);
      expect(geometry.left, "capped count should start inside viewport").toBeGreaterThanOrEqual(0);
      expect(
        geometry.right,
        "capped count should end inside viewport",
      ).toBeLessThanOrEqual(viewport.width + 1);
      expect(
        geometry.scrollWidth,
        "capped count text should not overflow its box",
      ).toBeLessThanOrEqual(geometry.clientWidth + 1);
      expect(
        geometry.scrollHeight,
        "capped count text should not overflow its box vertically",
      ).toBeLessThanOrEqual(geometry.clientHeight + 1);
      await expectNoHorizontalOverflow(page);
    });
  });
}
