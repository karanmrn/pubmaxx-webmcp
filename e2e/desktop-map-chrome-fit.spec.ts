import { expect, test, type Locator, type Page } from "@playwright/test";

const DESKTOP = { width: 1440, height: 900 };
const DESKTOP_WIDTHS = [1024, 1280, 1440, 1600] as const;
const FIRST_RUN_BANNER_WIDTHS = [641, 800, 1023, ...DESKTOP_WIDTHS] as const;
const EXPECTED_PLANNER_RAIL_WIDTHS: Record<
  (typeof DESKTOP_WIDTHS)[number],
  number
> = {
  1024: 376,
  1280: 376,
  1440: 376,
  1600: 376,
};
const EDGE_GUTTER = 16;
const SUBPIXEL_TOLERANCE = 0.5;
const CAPTURE_DRAWER_EXCHANGE =
  process.env.PUBMAX_CAPTURE_DESKTOP_EXCHANGE === "1";

test.use({ storageState: { cookies: [], origins: [] } });

async function renderedBox(locator: Locator, label: string) {
  const box = await locator.boundingBox();
  expect(box, `${label} has a rendered box`).not.toBeNull();
  if (!box) throw new Error(`${label} has no rendered box`);
  return box;
}

async function prepareDesktopMap(page: Page, width = DESKTOP.width) {
  await page.setViewportSize({ width, height: DESKTOP.height });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem(
      "pubmaxx:analytics-consent:v1",
      "denied",
    );
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

async function stubCityStatus(page: Page) {
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
}

async function toolbarPubOption(page: Page, query: string, name: RegExp) {
  const search = page
    .locator(".mapToolbar")
    .getByRole("combobox", { name: "Search pubs" });
  await search.fill(query);
  const option = page.getByRole("option", { name }).first();
  await expect(option).toBeVisible({ timeout: 20_000 });
  return option;
}

async function selectToolbarPub(page: Page, query: string, name: RegExp) {
  const option = await toolbarPubOption(page, query, name);
  await option.click();
}

async function indexedToolbarPubOption(
  page: Page,
  query: string,
  index: number,
) {
  const search = page
    .locator(".mapToolbar")
    .getByRole("combobox", { name: "Search pubs" });
  await search.fill(query);
  await search.focus();
  const option = page
    .getByRole("group", { name: "Venues" })
    .getByRole("option")
    .nth(index);
  await expect(option).toBeVisible({ timeout: 20_000 });
  return option;
}

async function captureDrawerExchange(page: Page, name: string) {
  if (!CAPTURE_DRAWER_EXCHANGE) return;
  await page.screenshot({
    path: `docs/evidence/desktop-rail-and-banners/drawer-exchange-${name}-firefox-1440.png`,
    animations: "allow",
  });
}

async function firstDrawerOwnershipCommit(trigger: Locator) {
  return trigger.evaluate((button) => {
    const planner = document.querySelector<HTMLElement>(
      ".mapDrawer.left.springDrawer",
    );
    const venue = document.querySelector<HTMLElement>(
      ".mapDrawer.right.springDrawer",
    );
    if (!planner || !venue) throw new Error("desktop drawers are missing");

    return new Promise<{
      plannerHidden: string | null;
      venueHidden: string | null;
    }>((resolve) => {
      const observer = new MutationObserver(() => {
        observer.disconnect();
        resolve({
          plannerHidden: planner.getAttribute("aria-hidden"),
          venueHidden: venue.getAttribute("aria-hidden"),
        });
      });
      for (const drawer of [planner, venue]) {
        observer.observe(drawer, {
          attributes: true,
          attributeFilter: ["aria-hidden"],
        });
      }
      (button as HTMLElement).click();
    });
  });
}

async function installFirstPlannerFrameProbe(
  page: Page,
  expectedSearch: string,
) {
  await page.addInitScript((search) => {
    if (window.location.search !== search) return;

    const measure = () => {
      const shell = document.querySelector(".appShell.planning-open");
      const toolbar = shell?.querySelector<HTMLElement>(".mapToolbar");
      const rail = shell?.querySelector<HTMLElement>(".mapDrawer.left.open");
      if (!toolbar || !rail || !toolbar.style.transform) {
        window.requestAnimationFrame(measure);
        return;
      }

      const toolbarBox = toolbar.getBoundingClientRect();
      const railBox = rail.getBoundingClientRect();
      Object.assign(window, {
        __pubmaxFirstPlannerFrame: {
          toolbarLeft: toolbarBox.left,
          railRight: railBox.right,
        },
      });
    };

    window.requestAnimationFrame(measure);
  }, expectedSearch);
}

async function firstPlannerFrame(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (
            window as typeof window & {
              __pubmaxFirstPlannerFrame?: {
                toolbarLeft: number;
                railRight: number;
              };
            }
          ).__pubmaxFirstPlannerFrame ?? null,
      ),
    )
    .not.toBeNull();
  return page.evaluate(
    () =>
      (
        window as typeof window & {
          __pubmaxFirstPlannerFrame: {
            toolbarLeft: number;
            railRight: number;
          };
        }
      ).__pubmaxFirstPlannerFrame,
  );
}

test("1280px plan deep link clears the planner rail on its first spring-owned frame", async ({
  page,
}) => {
  await prepareDesktopMap(page, 1280);
  await stubCityStatus(page);
  await installFirstPlannerFrameProbe(page, "?plan=1");

  const response = await page.goto("/map?plan=1", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  const frame = await firstPlannerFrame(page);
  expect(frame.toolbarLeft).toBeGreaterThanOrEqual(
    frame.railRight + EDGE_GUTTER,
  );
});

test("1280px restored planner clears the rail on its first spring-owned frame", async ({
  page,
}) => {
  await prepareDesktopMap(page, 1280);
  await stubCityStatus(page);
  const setup = await page.goto("/map?plan=1", {
    waitUntil: "domcontentloaded",
  });
  expect(setup?.status()).toBe(200);
  await expect(page.locator(".mapDrawer.left.open")).toBeVisible({
    timeout: 20_000,
  });
  await expect
    .poll(() =>
      page.evaluate(() => {
        const value = window.localStorage.getItem(
          "pubmaxx.mobile-map-session.v1",
        );
        return value ? JSON.parse(value).openSheet : null;
      }),
    )
    .toBe("planner");

  await installFirstPlannerFrameProbe(page, "");
  const response = await page.goto("/map", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);

  const frame = await firstPlannerFrame(page);
  expect(frame.toolbarLeft).toBeGreaterThanOrEqual(
    frame.railRight + EDGE_GUTTER,
  );
});

for (const width of DESKTOP_WIDTHS) {
  test(`${width}px open planner keeps toolbar search and Clear search beyond the rail edge`, async ({
    page,
  }) => {
    await prepareDesktopMap(page, width);
    await stubCityStatus(page);

    const response = await page.goto(`/map?desktop-rail-fit=${width}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    const toolbar = page.locator(".mapToolbar");
    await expect(toolbar).toBeVisible({ timeout: 20_000 });
    const search = toolbar.getByRole("combobox", { name: "Search pubs" });
    await search.fill("Shoreditch");
    await toolbar.getByRole("button", { name: "Plan an outing" }).click();

    const rail = page.locator(".mapDrawer.left.open");
    const searchCell = toolbar.locator(".mapToolbarSearch");
    const clearSearch = toolbar.getByRole("button", { name: "Clear search" });
    await expect(rail).toBeVisible({ timeout: 20_000 });
    await expect(clearSearch).toBeVisible();
    await expect
      .poll(async () => Math.abs((await rail.boundingBox())?.x ?? -1000), {
        message: "planner rail has finished its slide to the viewport edge",
      })
      .toBeLessThanOrEqual(1);

    const [railBox, toolbarBox, searchBox, clearBox] = await Promise.all([
      renderedBox(rail, "planner rail"),
      renderedBox(toolbar, "desktop toolbar"),
      renderedBox(searchCell, "toolbar search cell"),
      renderedBox(clearSearch, "Clear search"),
    ]);
    const railRight = railBox.x + railBox.width;
    const publishedRailWidth = await rail.evaluate((node) =>
      Number.parseFloat(
        getComputedStyle(node.closest(".appShell")!).getPropertyValue(
          "--desktop-planner-rail-width",
        ),
      ),
    );

    expect(
      railBox.width,
      `${width}px planner rail matches measured Firefox contract`,
    ).toBeCloseTo(EXPECTED_PLANNER_RAIL_WIDTHS[width], 2);
    expect(
      publishedRailWidth,
      `${width}px planner rail publishes measured Firefox contract`,
    ).toBe(EXPECTED_PLANNER_RAIL_WIDTHS[width]);

    expect(
      toolbarBox.x,
      "desktop toolbar clears planner rail",
    ).toBeGreaterThanOrEqual(railRight + EDGE_GUTTER);
    expect(
      searchBox.x,
      "search cell clears planner rail",
    ).toBeGreaterThanOrEqual(railRight + EDGE_GUTTER);
    expect(
      clearBox.x,
      "Clear search clears planner rail",
    ).toBeGreaterThanOrEqual(railRight + EDGE_GUTTER);
    expect(
      toolbarBox.x + toolbarBox.width,
      "desktop toolbar remains inside viewport",
    ).toBeLessThanOrEqual(width - EDGE_GUTTER);
  });
}

test("1440px planner hands ownership to venue and Back restores composed state", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await prepareDesktopMap(page);
  await stubCityStatus(page);

  const response = await page.goto("/map?desktop-drawer-exchange=1440", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  const toolbar = page.locator(".mapToolbar");
  await expect(toolbar).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: /Map layers:/ }).click();
  await page.getByRole("button", { name: "List view" }).click();
  const retargetVenue = page
    .locator(".mapVenueListItem")
    .filter({ hasNotText: "Three Sheets Soho" })
    .first();
  await expect(retargetVenue).toHaveCount(1, { timeout: 20_000 });
  await toolbar
    .getByRole("button", { name: "Plan an outing" })
    .evaluate((button) => (button as HTMLElement).click());

  const planner = page.locator(".mapDrawer.left.springDrawer");
  const venue = page.locator(".mapDrawer.right.springDrawer");
  const mapStage = page.locator(".mapStage");
  await expect(planner).toHaveAttribute("aria-hidden", "false");
  await expect(planner.locator("#railSearchInput")).toBeVisible();
  await expect
    .poll(async () => (await renderedBox(planner, "planner rail")).x)
    .toBeCloseTo(0, 0);

  const mapBefore = await renderedBox(mapStage, "map stage before exchange");

  const firstVenueOption = await indexedToolbarPubOption(page, "Soho", 0);
  const toolbarBeforeOwnershipChange = await renderedBox(
    toolbar,
    "toolbar before ownership change",
  );
  await captureDrawerExchange(page, "planner-open");
  const ownershipChange = await firstVenueOption.evaluate((option) => {
    const toolbar = document.querySelector<HTMLElement>(".mapToolbar");
    if (!toolbar) throw new Error("desktop toolbar is missing");
    const before = toolbar.getBoundingClientRect().x;
    (option as HTMLElement).click();
    return {
      before,
      after: toolbar.getBoundingClientRect().x,
    };
  });
  expect(
    Math.abs(ownershipChange.after - ownershipChange.before),
  ).toBeLessThan(16);

  await expect
    .poll(async () => (await renderedBox(planner, "moving planner")).x, {
      intervals: [16, 16, 16, 16],
      timeout: 5_000,
    })
    .toBeLessThan(-1);
  const [plannerMid, venueMid, toolbarMid] = await Promise.all([
    renderedBox(planner, "planner during exchange"),
    renderedBox(venue, "venue during exchange"),
    renderedBox(toolbar, "toolbar during exchange"),
  ]);
  expect(plannerMid.x).toBeLessThan(0);
  expect(plannerMid.x).toBeGreaterThan(-plannerMid.width);
  expect(venueMid.x).toBeGreaterThan(800);
  expect(venueMid.x).toBeLessThan(DESKTOP.width);
  await captureDrawerExchange(page, "mid-exchange");

  await expect(planner).toHaveAttribute("aria-hidden", "true");
  await expect(venue).toHaveAttribute("aria-hidden", "false");

  const venueBeforeRetarget = await renderedBox(
    venue,
    "venue before mid-spring retarget",
  );
  const retargetVenueName = await retargetVenue.evaluate((button) => {
    const name = button
      .querySelector<HTMLElement>(".mapVenueListItemName")
      ?.innerText.trim();
    if (!name) throw new Error("retarget venue name is missing");
    (button as HTMLElement).click();
    return name;
  });
  await page.waitForTimeout(16);
  const venueAfterRetarget = await renderedBox(
    venue,
    "venue after mid-spring retarget",
  );
  expect(venueAfterRetarget.x).toBeLessThanOrEqual(
    venueBeforeRetarget.x + 10,
  );

  await expect
    .poll(() => page.locator(".mapDrawer.springDrawer.open").count(), {
      message: "one desktop drawer owns the surface after exchange",
    })
    .toBe(1);
  await expect(
    venue.getByRole("heading", { name: retargetVenueName }).first(),
  ).toBeVisible({ timeout: 20_000 });

  const [mapAfter, venueOpen, toolbarOpen] = await Promise.all([
    renderedBox(mapStage, "map stage after exchange"),
    renderedBox(venue, "open venue drawer"),
    renderedBox(toolbar, "toolbar beside venue"),
  ]);
  expect(venueOpen.x).toBeCloseTo(800, 0);
  expect(toolbarOpen.x + toolbarOpen.width).toBeLessThanOrEqual(
    venueOpen.x - EDGE_GUTTER + SUBPIXEL_TOLERANCE,
  );
  expect(toolbarMid.x).toBeLessThan(toolbarBeforeOwnershipChange.x);
  expect(toolbarMid.x).toBeGreaterThan(toolbarOpen.x);
  expect(mapAfter).toEqual(mapBefore);
  await captureDrawerExchange(page, "venue-open");
  await expect(
    venue.getByRole("button", { name: "Back to Plan an outing" }),
  ).toBeVisible();
  await expect(
    venue.getByRole("button", { name: "Close and return to the London map" }),
  ).toBeVisible();

  await venue
    .getByRole("button", { name: "Back to Plan an outing" })
    .click();
  await expect(planner).toHaveAttribute("aria-hidden", "false");
  await expect(planner.locator("#railSearchInput")).toHaveValue(
    "Soho",
  );
  await expect
    .poll(() => page.locator(".mapDrawer.springDrawer.open").count(), {
      message: "Back restores planner as sole desktop drawer",
    })
    .toBe(1);
  await expect
    .poll(async () => (await renderedBox(planner, "restored planner")).x)
    .toBeCloseTo(0, 0);
  await captureDrawerExchange(page, "back-restored-planner");
});

test("1440px Plan an outing takes ownership from an open venue", async ({
  page,
}) => {
  await prepareDesktopMap(page);
  await stubCityStatus(page);

  const response = await page.goto("/map?desktop-drawer-owner=planner", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  const toolbar = page.locator(".mapToolbar");
  const venue = page.locator(".mapDrawer.right.springDrawer");
  await expect(toolbar).toBeVisible({ timeout: 20_000 });
  await selectToolbarPub(page, "The French House", /The French House/);
  await expect(venue).toHaveAttribute("aria-hidden", "false");

  // This branch owns only the captain's synchronous drawer decision. Selection
  // and surface history remain separate owners, and the later traversal race is
  // deliberately handed off in data/nomistakes-land-two-fixes. Capture the
  // first React commit so this regression cannot accidentally wait for, or
  // claim to reconcile, that deferred history work.
  const ownership = await firstDrawerOwnershipCommit(
    toolbar.getByRole("button", { name: "Plan an outing" }),
  );
  expect(ownership).toEqual({
    plannerHidden: "false",
    venueHidden: "true",
  });
});

test("1440px loaded route opens its first venue without a deferred planner handoff", async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP);
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem(
      "pubmaxx:analytics-consent:v1",
      "denied",
    );
    window.sessionStorage.setItem("pubmax:citySuggestDismiss:v1", "1");
  });
  await stubCityStatus(page);
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

  const response = await page.goto("/map?desktop-loaded-route=1440", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  const onboarding = page.getByRole("dialog", { name: "Start with a story" });
  await expect(onboarding).toBeVisible({ timeout: 20_000 });

  const planner = page.locator(".mapDrawer.left.springDrawer");
  const venue = page.locator(".mapDrawer.right.springDrawer");
  await page.evaluate(() => {
    const plannerDrawer = document.querySelector(
      ".mapDrawer.left.springDrawer",
    );
    if (!plannerDrawer) throw new Error("planner drawer missing");
    const transitions: string[] = [];
    new MutationObserver((records) => {
      for (const record of records) {
        if (record.type !== "attributes") continue;
        transitions.push(record.oldValue ?? "missing");
      }
    }).observe(plannerDrawer, {
      attributes: true,
      attributeFilter: ["aria-hidden"],
      attributeOldValue: true,
    });
    Object.assign(window, {
      __pubmaxPlannerAriaHiddenTransitions: transitions,
    });
  });

  await onboarding
    .getByRole("button", {
      name: "Load the Victorian Soho crawl, 5 stops",
    })
    .click();

  await expect(venue).toHaveAttribute("aria-hidden", "false");
  await expect(planner).toHaveAttribute("aria-hidden", "true");
  await expect(page.locator(".mapDrawer.springDrawer.open")).toHaveCount(1);
  const plannerTransitions = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __pubmaxPlannerAriaHiddenTransitions?: string[];
        }
      ).__pubmaxPlannerAriaHiddenTransitions ?? [],
  );
  expect(plannerTransitions).not.toContain("true");
});

test("1440px reduced motion swaps desktop drawer ownership immediately", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await prepareDesktopMap(page);
  await stubCityStatus(page);

  const response = await page.goto("/map?desktop-drawer-exchange=reduced", {
    waitUntil: "domcontentloaded",
  });
  expect(response?.status()).toBe(200);

  const toolbar = page.locator(".mapToolbar");
  await expect(toolbar).toBeVisible({ timeout: 20_000 });
  await toolbar.getByRole("button", { name: "Plan an outing" }).click();

  const planner = page.locator(".mapDrawer.left.springDrawer");
  const venue = page.locator(".mapDrawer.right.springDrawer");
  await expect(planner).toHaveAttribute("aria-hidden", "false");
  await selectToolbarPub(page, "The French House", /The French House/);

  await expect(planner).toHaveAttribute("aria-hidden", "true");
  await expect(venue).toHaveAttribute("aria-hidden", "false");
  await expect(page.locator(".mapDrawer.springDrawer.open")).toHaveCount(1);

  const [plannerBox, venueBox] = await Promise.all([
    renderedBox(planner, "reduced-motion planner"),
    renderedBox(venue, "reduced-motion venue"),
  ]);
  expect(plannerBox.x).toBeCloseTo(-EXPECTED_PLANNER_RAIL_WIDTHS[1440], 0);
  expect(venueBox.x).toBeCloseTo(800, 0);
});

for (const width of FIRST_RUN_BANNER_WIDTHS) {
  test(`${width}px first-run location prompt owns centre while status yields to its left`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: DESKTOP.height });
    await page.addInitScript(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.localStorage.setItem(
        "pubmaxx:analytics-consent:v1",
        "denied",
      );
    });
    await page.route("**/api/citymcp/status**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          asOf: "2026-08-03T08:00:00.000Z",
          weather: null,
          tubeLines: [{ line: "Central", status: "Severe delays" }],
          signals: [],
        }),
      }),
    );

    const response = await page.goto(`/map?desktop-first-run-banners=${width}`, {
      waitUntil: "domcontentloaded",
    });
    expect(response?.status()).toBe(200);

    const locationPrompt = page.locator(".citySuggestBanner");
    const status = page.locator(".cityStatusStack");
    await expect(locationPrompt).toBeVisible({ timeout: 20_000 });
    await expect(status).toBeVisible({ timeout: 20_000 });

    const [locationBox, statusBox] = await Promise.all([
      renderedBox(locationPrompt, "first-run location prompt"),
      renderedBox(status, "city status"),
    ]);
    const locationCentre = locationBox.x + locationBox.width / 2;
    const statusRight = statusBox.x + statusBox.width;

    expect(
      Math.abs(locationCentre - width / 2),
      "location prompt owns map centre",
    ).toBeLessThanOrEqual(1);
    expect(statusBox.x, "status uses left map gutter").toBeCloseTo(
      EDGE_GUTTER,
      0,
    );
    expect(
      statusRight + EDGE_GUTTER,
      "status yields before location prompt's left edge",
    ).toBeLessThanOrEqual(locationBox.x);
  });
}
