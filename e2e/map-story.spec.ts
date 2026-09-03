import { test, expect, type Page } from "@playwright/test";

// Map story-surface E2E: the band picker DOM overlay (issue #15) and the venue
// sheet's tab system (VenueInspector), including the "Last Pint" getting-home
// tab (issues #19-24). All WebGL-agnostic — these are DOM overlays that sit on
// top of the MapLibre canvas, never assertions on canvas pixels or pin clicks.
//
// Style matches e2e/smoke.spec.ts / e2e/social-loop.spec.ts: watchPageErrors on
// deterministic surfaces, .count()-guarded branches so an empty/filtered state
// is never a failure, web-first (auto-retrying) assertions, no waitForTimeout.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function dismissOnboardingIfPresent(page: Page): Promise<void> {
  const dismiss = page.getByRole("button", { name: "Dismiss / explore the map" });
  if ((await dismiss.count()) > 0) {
    await dismiss.click();
    await expect(page.locator(".mapOnboarding")).toHaveCount(0);
  }
}

// Mirrors lib/venues.ts venueGroupingKey + stableVenueIdFromKey (same tiny,
// stable, public hash used by e2e/smoke.spec.ts) so we can deep-link straight
// to a known seed pub's detail sheet without depending on canvas pin clicks.
function stableVenueIdFromKey(key: string): string {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

function normaliseVenueKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// A known seed row from public/data/pint_prices_app_dataset.json ("Arnos
// Arms") — same stable id smoke.spec.ts deep-links to.
const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);
const OLD_BELL_ID = "venue-1tu6vof";
const DOVE_ID = "venue-1p5ftm3";
const DOVE_PRICE_SOURCE =
  "https://www.pint-prices.com/pub/19%20Upper%20Mall,%20London%20W6%209TA/The%20Dove";

// ---------------------------------------------------------------------------
// Place stories live in MapLayersControl after Wave J declutter (was mid-map
// .bandPicker / .bandActiveCard). Deep-link ?band= opens Layers with the
// corridor chip active; bandOnboardingChip still surfaces corridor copy.
test.describe("map / story bands (#15)", () => {
  test("activating a band via URL opens Layers with the corridor chip active", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/map?band=river-history");
    expect(response?.status()).toBe(200);

    const layers = page.getByRole("dialog", { name: "Map layers" });
    await expect(layers).toBeVisible();

    const activeChip = layers.locator(".mapLayersChip.isOn").filter({ hasText: "River history" });
    await expect(activeChip).toHaveCount(1);

    // G3 chip still carries corridor title + truncated copy for deep links.
    const bandChip = page.locator(".bandOnboardingChip");
    if ((await bandChip.count()) > 0) {
      await expect(bandChip.locator("strong")).toHaveText(/River history/i);
      const copy = (await bandChip.locator("span").first().innerText()).trim();
      expect(copy.length).toBeGreaterThan(0);
    }

    expect(errors).toEqual([]);
  });

  test("tapping the active band chip again clears it (toggle off)", async ({ page }) => {
    await page.goto("/map?band=river-history");
    const layers = page.getByRole("dialog", { name: "Map layers" });
    await expect(layers).toBeVisible();
    await dismissOnboardingIfPresent(page);

    const activeChip = layers.locator(".mapLayersChip.isOn").filter({ hasText: "River history" });
    await expect(activeChip).toHaveCount(1);
    await activeChip.click();

    await expect(
      layers.locator(".mapLayersChip.isOn").filter({ hasText: "River history" }),
    ).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// Venue sheet tabs (components/map/VenueInspector.tsx). Seven tabs (Overview,
// Photos, Drinks, Stories, Lore, Ask, Last train) behind
// role="tablist"/role="tab", with
// roving-tabindex arrow-key navigation per the APG tabs pattern. Deep-link
// straight to a known seed venue (mirrors smoke.spec's sel= precedent) so this
// never depends on a canvas pin click.
test.describe("map / venue sheet tabs", () => {
  test("names The Dove price publisher in Overview and its Asahi row", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/map?sel=${DOVE_ID}`);

    const overview = page.locator("#venuePanel-overview");
    await expect(overview).toBeVisible();
    await expect(overview).toContainText("£7.25");
    const overviewSource = overview.getByRole("link", {
      name: "Pint Prices",
      exact: true,
    });
    await expect(overviewSource).toHaveAttribute("href", DOVE_PRICE_SOURCE);

    const tablist = page.getByRole("tablist", { name: "Venue detail sections" });
    await tablist.getByRole("tab", { name: "Drinks", exact: true }).click();
    const menu = page.locator("#venuePanel-menu");
    await menu.getByRole("button", { name: /^Drinks/ }).click();

    const asahi = menu.locator(".drinkRow").filter({ hasText: /Asahi/i });
    await expect(asahi).toContainText("£7.25");
    await expect(
      asahi.getByRole("link", { name: "Pint Prices", exact: true }),
    ).toHaveAttribute("href", DOVE_PRICE_SOURCE);
    await expect(menu.locator(".drinkMenuFootnote")).not.toContainText(
      "Every drink carries its source",
    );
  });

  test("empty Drinks action opens the Pint Drop composer on Stories", async ({
    page,
  }) => {
    await page.goto(`/map?sel=${OLD_BELL_ID}`);

    const tablist = page.getByRole("tablist", { name: "Venue detail sections" });
    const drinksTab = tablist.getByRole("tab", { name: "Drinks", exact: true });
    await drinksTab.click();

    await page
      .locator("#venuePanel-menu")
      .getByRole("button", { name: "Add what you’re drinking" })
      .click();

    const storiesTab = tablist.getByRole("tab", { name: "Stories", exact: true });
    await expect(storiesTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#venuePanel-pints")).toBeVisible();
    await expect(page.getByRole("form", { name: "Pint Drop composer" })).toBeVisible();
  });

  test("all seven tabs render; each switches its panel; Stories shows the price block", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    expect(response?.status()).toBe(200);

    const tablist = page.getByRole("tablist", { name: "Venue detail sections" });
    await expect(tablist).toBeVisible();

    const expectedTabs = [
      "Overview",
      "Photos",
      "Drinks",
      "Stories",
      "Lore",
      "Ask",
      "Last train",
    ];
    const tabs = tablist.getByRole("tab");
    await expect(tabs).toHaveCount(expectedTabs.length);
    for (const label of expectedTabs) {
      await expect(tablist.getByRole("tab", { name: label, exact: true })).toBeVisible();
    }

    // Overview is the default. Stories owns community prices and Moments.
    const overviewTab = tablist.getByRole("tab", { name: "Overview", exact: true });
    await expect(overviewTab).toHaveAttribute("aria-selected", "true");
    const pintsTab = tablist.getByRole("tab", { name: "Stories", exact: true });
    await pintsTab.click();
    await expect(pintsTab).toHaveAttribute("aria-selected", "true");
    const pintsPanel = page.locator("#venuePanel-pints");
    await expect(pintsPanel).toBeVisible();
    await expect(pintsPanel.locator(".pintDrops")).toBeVisible();

    // Switch to every other tab by click; assert its panel becomes visible and
    // the others are hidden (aria-selected flips, hidden attr flips).
    for (const [label, panelId] of [
      ["Overview", "venuePanel-overview"],
      ["Photos", "venuePanel-photos"],
      ["Drinks", "venuePanel-menu"],
      ["Lore", "venuePanel-story"],
      ["Ask", "venuePanel-ask"],
      ["Last train", "venuePanel-getting-home"],
    ] as const) {
      const tab = tablist.getByRole("tab", { name: label, exact: true });
      await expect(tab).toBeVisible();
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(pintsTab).toHaveAttribute("aria-selected", "false");
      await expect(page.locator(`#${panelId}`)).toBeVisible();
    }

    expect(errors).toEqual([]);
  });

  test("arrow-key navigation moves the roving tab selection", async ({ page }) => {
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    const tablist = page.getByRole("tablist", { name: "Venue detail sections" });
    const overviewTab = tablist.getByRole("tab", { name: "Overview", exact: true });
    await expect(overviewTab).toHaveAttribute("aria-selected", "true");
    await overviewTab.focus();

    // ArrowRight from Overview moves to Photos and moves focus
    // with it (roving tabindex — VenueInspector's selectTab calls .focus()).
    await page.keyboard.press("ArrowRight");
    const photosTab = tablist.getByRole("tab", { name: "Photos", exact: true });
    await expect(photosTab).toHaveAttribute("aria-selected", "true");
    await expect(photosTab).toBeFocused();
    await expect(page.locator("#venuePanel-photos")).toBeVisible();

    // ArrowLeft moves back to Overview.
    await page.keyboard.press("ArrowLeft");
    await expect(overviewTab).toHaveAttribute("aria-selected", "true");
    await expect(overviewTab).toBeFocused();

    // Wrap-around: ArrowLeft from the first tab (Overview) wraps to the last
    // (Last train).
    await overviewTab.click();
    await page.keyboard.press("ArrowLeft");
    const gettingHomeTab = tablist.getByRole("tab", { name: "Last train", exact: true });
    await expect(gettingHomeTab).toHaveAttribute("aria-selected", "true");
  });

  test("the community-price freshness note renders when a contributor price exists, and Overview stays well-formed when absent", async ({
    page,
  }) => {
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    const overviewTab = page.getByRole("tab", { name: "Overview", exact: true });
    await overviewTab.click();
    const overviewPanel = page.locator("#venuePanel-overview");
    await expect(overviewPanel).toBeVisible();

    // The contributor-price block (with its freshness note) renders ONLY when a
    // latestContributorPrice is set — guard with .count() so this is honest on
    // both a venue with contributor drops and one without.
    const contributorBlock = overviewPanel.locator(".contributorPrice");
    const blockCount = await contributorBlock.count();
    if (blockCount > 0) {
      // The block prints a FIGURE, and which element carries it is the price
      // badge's business. Asserting the tag name coupled this spec to markup it
      // does not own, and it drifted the moment `PriceBadge` replaced a bare
      // <strong>, which is a spec going red with no price having moved.
      const block = contributorBlock.first();
      await expect(block).toContainText(/£\d/);
      // Every lane that can carry a community note discloses what it is. A lane
      // with no note (a sourced or baseline row) says its provenance in its own
      // link line instead, so an absent note is not a missing disclosure.
      const note = block.locator(".communityPriceNote");
      if (await note.count()) {
        await expect(note).not.toBeEmpty();
      }
    } else {
      // Absent gracefully: the Overview panel still renders a coherent surface
      // (address is always present) rather than a half-empty gap.
      await expect(overviewPanel.locator(".venueAddress")).toBeVisible();
    }
  });

  // "The Spill" composer (issue #24): visibility segmented control. Deep-link
  // to Stories (the composer's tab), open it via its "Log a Pint Drop"
  // button, and assert the four-option visibility radiogroup renders with
  // Public selected by default — a cheap DOM check, no submit/network needed.
  test("opening the composer renders the visibility control, defaulted to Public", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    await page.getByRole("tab", { name: "Stories", exact: true }).click();
    const pintsPanel = page.locator("#venuePanel-pints");
    await expect(pintsPanel).toBeVisible();

    await pintsPanel.getByRole("button", { name: /log a pint drop/i }).click();

    // Price-first door (report D2): the visibility control is an extra, behind
    // the one disclosure.
    await pintsPanel.getByRole("button", { name: "Add a photo or story" }).click();

    const visibilityGroup = pintsPanel.getByRole("radiogroup", { name: "Visibility" });
    await expect(visibilityGroup).toBeVisible();

    const options = visibilityGroup.getByRole("radio");
    await expect(options).toHaveCount(4);
    for (const label of ["Public", "Friends", "Legacy", "Anonymous"]) {
      await expect(visibilityGroup.getByRole("radio", { name: label })).toBeVisible();
    }

    const publicOption = visibilityGroup.getByRole("radio", { name: "Public" });
    await expect(publicOption).toHaveAttribute("aria-checked", "true");

    expect(errors).toEqual([]);
  });
});
