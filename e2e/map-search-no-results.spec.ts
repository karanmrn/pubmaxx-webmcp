import { expect, test, type Page } from "@playwright/test";

const QUERY = "Definitely no such Venue 987654";
const CONSENT_KEY = "pubmaxx:analytics-consent:v1";
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
] as const;

type CapturedEvent = {
  name?: unknown;
  props?: unknown;
  [key: string]: unknown;
};

async function preparePage(
  page: Page,
  options: { width: number; height: number; theme?: "light" | "dark"; consent?: boolean },
) {
  await page.setViewportSize({ width: options.width, height: options.height });
  await page.addInitScript(
    ({ consentKey, consent, theme }) => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      if (consent) window.localStorage.setItem(consentKey, "granted");
      if (theme) window.localStorage.setItem("pubmax-theme", theme);
    },
    { consentKey: CONSENT_KEY, consent: options.consent ?? false, theme: options.theme },
  );
  await page.route("**/api/citymcp/status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ asOf: null, weather: null, tubeLines: [], signals: [] }),
    }),
  );
}

async function openMapSearch(page: Page, width: number) {
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  // Prefer the canvas as the readiness signal — .mapLoading may never mount
  // when the map paints quickly, and the toolbar search is always in the tree.
  await expect(page.locator(".maplibreMap canvas, .mapCanvasWrap").first()).toBeVisible({
    timeout: 45_000,
  });
  await page.locator(".mapLoading").waitFor({ state: "hidden", timeout: 45_000 }).catch(() => {});
  if (width < 768) {
    const open = page.getByRole("button", { name: "Search the map" });
    if (await open.count()) await open.click();
  }
  const search = page
    .locator('#mapSearchInput, #mobileMapSearchInput, input[type="search"][aria-label="Search pubs"]')
    .first();
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.click();
  return search;
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name} miss stays visible, announces once, stays private, and keeps keyboard recovery`, async ({ page }) => {
    test.setTimeout(120_000);
    const events: CapturedEvent[] = [];
    await preparePage(page, { ...viewport, consent: true });
    await page.route("**/api/events", async (route) => {
      const raw = route.request().postData();
      if (raw) events.push(JSON.parse(raw) as CapturedEvent);
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ accepted: true }),
      });
    });

    const search = await openMapSearch(page, viewport.width);
    await page.evaluate(() => {
      const live = document.querySelector('[data-testid="map-search-no-results-live"]');
      const state = window as Window & {
        __mapSearchAnnouncements?: string[];
        __mapSearchAnnouncementObserver?: MutationObserver;
      };
      state.__mapSearchAnnouncements = [];
      state.__mapSearchAnnouncementObserver = new MutationObserver(() => {
        const text = live?.textContent?.trim() ?? "";
        if (text) state.__mapSearchAnnouncements?.push(text);
      });
      if (live) {
        state.__mapSearchAnnouncementObserver.observe(live, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      }
    });

    await search.fill(QUERY);
    const listbox = page.getByRole("listbox", { name: "Search suggestions" });
    const empty = page.getByTestId("map-search-no-results");
    const live = page.getByTestId("map-search-no-results-live");

    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option")).toHaveCount(0);
    await expect(empty).toBeVisible();
    await expect(empty).toContainText("Nothing matching that. Try a pub name or an area.");
    await expect(empty).toContainText("Soho, Willesden, or The Crown");
    await expect(search).toHaveAttribute("aria-expanded", "true");
    const emptyId = await empty.getAttribute("id");
    expect(emptyId).toBeTruthy();
    await expect(search).toHaveAttribute("aria-describedby", emptyId!);
    await expect(live).toHaveText("Nothing matching that. Try a pub name or an area.");

    await expect.poll(() => events.filter((event) => event.name === "map_search_no_results").length).toBe(1);
    await page.waitForTimeout(450);
    expect(await page.evaluate(() => (
      window as Window & { __mapSearchAnnouncements?: string[] }
    ).__mapSearchAnnouncements?.length ?? 0)).toBe(1);

    const miss = events.find((event) => event.name === "map_search_no_results");
    expect(miss?.props).toEqual({});
    expect(miss).not.toHaveProperty("query");
    expect(JSON.stringify(miss)).not.toContain(QUERY);

    await search.press("Enter");
    await expect(listbox).toBeVisible();
    await expect(search).toBeFocused();
    await page.waitForTimeout(450);
    expect(events.filter((event) => event.name === "map_search_no_results")).toHaveLength(1);

    // Scope to the combobox's own clear control — desktop MapToolbar can also
    // surface a recovery "Clear search" chip when filtered venue count is zero.
    const clear = page
      .locator(".mapSearchSuggest")
      .filter({ has: search })
      .getByRole("button", { name: "Clear search" });
    await expect(clear).toHaveCount(1);
    await clear.click();
    await expect(search).toHaveValue("");
    await expect(empty).toHaveCount(0);
    await expect(live).toHaveText("");

    await search.fill(QUERY);
    await expect(empty).toBeVisible();
    await search.press("Escape");
    if (viewport.width < 768) {
      await expect(search).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Search the map" })).toBeFocused();
    } else {
      await expect(listbox).toHaveCount(0);
      await expect(search).toBeFocused();
      await search.press("x");
      await expect(listbox).toBeVisible();
    }
  });
}

for (const viewport of VIEWPORTS) {
  for (const theme of ["light", "dark"] as const) {
    for (const reducedMotion of [false, true]) {
      test(`${viewport.name} ${theme} ${reducedMotion ? "reduced" : "normal"} miss evidence`, async ({ page }, testInfo) => {
        test.setTimeout(90_000);
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: reducedMotion ? "reduce" : "no-preference",
        });
        await preparePage(page, { ...viewport, theme });
        const search = await openMapSearch(page, viewport.width);
        await search.fill(QUERY);

        const empty = page.getByTestId("map-search-no-results");
        await expect(empty).toBeVisible();
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        const box = await empty.boundingBox();
        expect(box).not.toBeNull();
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport.width + 1);
        expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport.height + 1);

        await page.screenshot({
          path: testInfo.outputPath(`map-search-miss-${viewport.name}-${theme}-${reducedMotion ? "reduced" : "normal"}.png`),
          animations: "disabled",
        });
      });
    }
  }
}
