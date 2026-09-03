import { test, expect, type Page } from "@playwright/test";

// P3.11 smoke suite. High-signal, non-flaky, WebGL-agnostic: nothing here asserts
// that the MapLibre canvas actually paints (headless boxes have no GPU), only
// that the observable app scaffolding mounts and the honesty/theme guarantees hold.

// Collect uncaught page errors so a single console-fatal fails the run loudly.
function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function dismissMapFirstRunTour(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

test.beforeEach(async ({ page }) => {
  await dismissMapFirstRunTour(page);
});

test("landing / serves, shows hero + Demo honesty label + a working city-first map CTA", async ({
  page,
}) => {
  const errors = watchPageErrors(page);

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  // Hero headline (stable id in components/landing/LandingPage.tsx). Assert the
  // current product promise rather than retired campaign copy.
  await expect(page.locator("#hero-title")).toContainText(
    "London pints can cost eight quid.",
  );

  // Honesty guarantee: seeded demo cards are labelled "Demo" (P4 unified
  // provenance vocabulary — see lib/provenanceLabels.ts).
  await expect(page.getByText("Demo").first()).toBeVisible();

  // First entry is city-first so the app never assumes location or silently
  // chooses a city. Choose London explicitly, then verify the canonical map.
  const cta = page.getByRole("link", { name: /open the map/i }).first();
  await expect(cta).toHaveAttribute("href", "/choose-city");
  await cta.click();
  await expect(page).toHaveURL(/\/choose-city$/);
  await page.getByRole("link", { name: /^London:.*Open map\.$/i }).click();
  await expect(page).toHaveURL(/\/map/);

  expect(errors).toEqual([]);
});

test("landing hero headline renders the display face at a deliberate (>=600) weight", async ({
  page,
}) => {
  // Regression guard for the "font looks thin" defect: Space Grotesk is a
  // variable font, so a heading with no explicit font-weight falls to the 400
  // default and reads thin. The base h1/h2/h3 rules in globals.css set 600 —
  // assert the computed weight so a future revert (e.g. a co-dev overwrite)
  // fails loudly. Also assert the display face is actually wired: the computed
  // family must name Space Grotesk (guards against --font-display losing its
  // next/font wiring or --serif being repointed at a fallback stack).
  await page.goto("/");
  const hero = page.locator("#hero-title");
  await expect(hero).toBeVisible();
  await page.evaluate(() => (document as unknown as { fonts: FontFaceSet }).fonts.ready);
  const { weight, family } = await hero.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { weight: parseInt(cs.fontWeight, 10), family: cs.fontFamily };
  });
  expect(weight).toBeGreaterThanOrEqual(600);
  expect(family).toMatch(/Space Grotesk/i);
});

test("/map mounts the map region (canvas OR fallback)", async ({ page }) => {
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // The map is a dynamic import (ssr:false) behind a loading shell, slow to
  // hydrate under 4-worker parallel load — give it room so this doesn't flake.
  // The wrapper always renders once PubMap mounts; inside it is EITHER the
  // maplibre container (GPU present) OR the "Map renderer unavailable" fallback
  // (headless/no-WebGL). Pass on either so it stays green regardless of GPU.
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20000 });
  const canvasOrFallback = page.locator(".maplibreMap, .mapFallback").first();
  await expect(canvasOrFallback).toBeVisible({ timeout: 20000 });

  // ponytail: no pageerror assertion here. MapLibre GL emits async teardown
  // errors under headless timing (getLayer on a torn-down style) that are not
  // caused by app logic under test; the landing-page test above owns the
  // no-uncaught-errors guarantee on a deterministic surface.
});

test("/feed mounts the social feed scaffold without uncaught errors", async ({ page }) => {
  const errors = watchPageErrors(page);
  const response = await page.goto("/feed");
  expect(response?.status()).toBe(200);
  // The feed fetches /api/pint-drops and degrades to a social empty state on
  // failure, so we assert the always-present scaffold (site nav), not content.
  await expect(page.getByRole("link", { name: "Map", exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("/feed redirects to Social and renders its reachable boundary state (issue #36)", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await dismissMapFirstRunTour(page);
  const response = await page.goto("/feed");
  expect(response?.status()).toBe(200);

  // PR #765 (5adfb689) retired /feed's London-tab + Feed-lanes filter group
  // in favour of the unified Social shell. /feed now redirects to /social.
  // Default Chromium has no signed-in account. The exact launch copy can move,
  // but the reachable boundary must remain honest and actionable.
  await expect(
    page.getByRole("heading", { name: "Social", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Sign in to use Social.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("/bar-tab/[id] renders the venue Bar Tab for a real venue id (issue #36)", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  // Deep-link straight to a known seed pub's Bar Tab via the same stable FNV-1a
  // id helper the venue-sheet test uses — no canvas pin click needed.
  const response = await page.goto(`/bar-tab/${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);
  // The header eyebrow is app-owned + stable ("The Bar Tab"); the venue name and
  // "Open on the map" cross-link always render for a resolvable id.
  await expect(page.getByText("The Bar Tab", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /open on the map/i }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("/discover renders the cheap-pint leaderboard section", async ({ page }) => {
  const errors = watchPageErrors(page);
  const response = await page.goto("/discover");
  expect(response?.status()).toBe(200);
  // Stable, app-owned heading (id in app/discover/page.tsx).
  await expect(page.locator("#cheap-title").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("/pubs lists scraped pubs with drink card art", async ({ page }) => {
  const errors = watchPageErrors(page);
  const response = await page.goto("/pubs");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { level: 1, name: /Chains/i })).toBeVisible();
  await expect(page.locator(".pubsCard").first()).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Site navigation" }).getByRole("link", { name: "Social" }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Now" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("/u/[handle] renders a public profile for any handle without crashing", async ({ page }) => {
  const errors = watchPageErrors(page);
  const response = await page.goto("/u/testdrinker");
  expect(response?.status()).toBe(200);
  // Dynamic route: the scaffold always mounts even for an unknown handle
  // (friendly empty state), so assert the site nav is present.
  await expect(page.getByLabel("Open PUBMAXX landing page").first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("nav does not overflow at 390px — sign-in button never clips (GH #18)", async ({
  page,
}) => {
  // iPhone 12/13/14-class width, the narrowest common phone viewport and the
  // one the bug report was filed against.
  await page.setViewportSize({ width: 390, height: 844 });

  const response = await page.goto("/feed");
  expect(response?.status()).toBe(200);

  const nav = page.locator(".siteNavBar").first();
  await expect(nav).toBeVisible();

  const viewportWidth = 390;
  const navBox = await nav.boundingBox();
  expect(navBox).not.toBeNull();
  if (navBox) {
    // The bar itself must stay within the viewport (no horizontal overflow).
    expect(navBox.x).toBeGreaterThanOrEqual(0);
    expect(navBox.x + navBox.width).toBeLessThanOrEqual(viewportWidth + 1); // +1px rounding
  }

  // Sign-in controls (present when browser auth is configured) must also
  // stay fully inside the viewport — this is the exact element the bug named.
  // Google + Microsoft both use .authSignIn; check every visible button.
  const signIn = page.locator(".authSignIn");
  const signInCount = await signIn.count();
  for (let i = 0; i < signInCount; i++) {
    const box = await signIn.nth(i).boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewportWidth + 1);
    }
  }
});

test("mobile map shell controls stay inside the coordinated chrome at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await dismissMapFirstRunTour(page);

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  await expect(page.locator(".mobileMapTopbar")).toBeVisible({ timeout: 20_000 });
  // The phone map chrome is ONE bar (design judgement 2026-08-01, finding 2.3).
  await expect(page.locator(".mobileMapRail")).toHaveCount(0);

  for (const selector of [".mobileMapTopbar"]) {
    const control = page.locator(selector);
    await expect(control).toBeVisible();
    const box = await control.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, width: rect.width };
    });
    expect(box.x, `${selector} left edge`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `${selector} right edge`).toBeLessThanOrEqual(
      391,
    );
  }

  // B1 consolidated separate Drinks/Price controls into one Filters sheet.
  const filters = page
    .locator(".mobileMapTopbar")
    .getByRole("button", { name: /^Filters/ });
  await expect(filters).toBeVisible();
  await filters.click();
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]:visible');
  await expect(sheet).toHaveCount(1);
  // PR #695 (9b588362) renamed the filters sheet heading from "Drinks and
  // price" to "Prices and places" (see lib/mobileShell.ts).
  await expect(sheet.getByRole("heading", { name: "Prices and places" })).toBeVisible();
});

// Mirrors lib/venues.ts venueGroupingKey + stableVenueIdFromKey exactly (a
// tiny, stable, public hash) so this test can deep-link straight to a known
// seed pub's detail sheet without depending on canvas pin clicks — headless
// Chromium has no WebGL/GPU, so the MapLibre canvas doesn't reliably paint
// clickable pins (see the WebGL-agnostic note at the top of this file).
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
// Arms") — stable dataset, so this id doesn't drift.
const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);

test("mobile venue sheet (GH #17): opens at the peek snap with the grab handle visible at 390px", async ({
  page,
}) => {
  // iPhone-class width — the same viewport the nav-overflow test above uses,
  // and the width the drag bottom-sheet gesture is scoped to (≤640px).
  await page.setViewportSize({ width: 390, height: 844 });
  await dismissMapFirstRunTour(page);

  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);

  // The right drawer is the mobile bottom sheet (components/PubMap.tsx +
  // venueSheet.css). A `sel=` deep link opens it immediately at the "half"
  // snap (PubMap.tsx's selectVenue default) — asserting `.open` rather than a
  // specific `.sheet-*` class keeps this robust to the exact snap default
  // while still proving the sheet-open contract that peek/half/full build on.
  const sheet = page.locator(".mapDrawer.right");
  await expect(sheet).toHaveClass(/open/);
  await expect(page.locator(".mapDrawer.left")).toHaveCount(0);

  // The grab handle (the drag affordance itself) is visible and — even
  // without simulating a real pointer-drag — present in the DOM as the
  // documented gesture surface (components/map/VenueInspector.tsx).
  await expect(sheet.locator(".mobileSharedSheetGrab")).toBeVisible();

  // The sheet stays fully usable with no gesture at all: the close button and
  // tabs are reachable and functional (a11y contract from the spec).
  const closeButton = page.getByRole("button", { name: "Close pub detail" });
  await expect(closeButton).toBeVisible();
  const tabs = page.getByRole("tab");
  await expect(tabs.first()).toBeVisible();

  const mobileNav = page.locator(".mobileTabBar");
  const tablist = page.getByRole("tablist", { name: "Venue detail sections" });
  const goldenThreadPrice = page.locator(".vpsPriceValue").first();
  await expect(mobileNav).toBeVisible();
  await expect(tablist).toBeVisible();
  await expect(goldenThreadPrice).toHaveText("£5.50");

  const [navBox, closeBox, tabsBox, horizontalOverflow, goldenThreadPriceStyle] = await Promise.all([
    mobileNav.boundingBox(),
    closeButton.boundingBox(),
    tablist.boundingBox(),
    page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth),
    goldenThreadPrice.evaluate((node) => {
      const style = window.getComputedStyle(node);
      return {
        fontFamily: style.fontFamily,
        letterSpacing: style.letterSpacing,
      };
    }),
  ]);
  expect(navBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  expect(tabsBox).not.toBeNull();
  expect(goldenThreadPriceStyle.fontFamily).toContain("Inter");
  expect(goldenThreadPriceStyle.letterSpacing).not.toBe("normal");
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  expect(navBox!.x).toBeGreaterThanOrEqual(0);
  expect(navBox!.x + navBox!.width).toBeLessThanOrEqual(390);
  expect(closeBox!.y + closeBox!.height).toBeLessThan(navBox!.y);
  expect(tabsBox!.y + tabsBox!.height).toBeLessThan(navBox!.y);

  await closeButton.click();
  await expect(sheet).toHaveCount(0);
});

test("mobile venue sheet sticky actions switch to Train and price sign-in gate", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });

  const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  expect(response?.status()).toBe(200);

  const sheet = page.locator(".mapDrawer.right");
  await expect(sheet).toHaveClass(/open/);
  await page.getByRole("tab", { name: "Stories", exact: true }).click();
  await expect(sheet).toHaveClass(/sheet-full/);

  // Wait for the command bar to finish portaling into the sheet footer. The
  // footer is outside the scroll body, so actions remain reachable at full snap.
  const sheetFooter = sheet.locator(".mobileSharedSheetFooter");
  const stickyActions = sheetFooter.getByRole("toolbar", { name: "Venue actions" });
  await expect(stickyActions).toBeVisible();

  // The tab row is the single Train entry point (the sticky strip holds
  // actions, not navigation — owner-reported duplicate removed).
  const gettingHomeTab = page.getByRole("tab", { name: "Last train", exact: true });
  await gettingHomeTab.click();
  await expect(gettingHomeTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#venuePanel-getting-home")).toBeVisible();

  // Full snap prioritises the scroll body. Collapse through the real detent
  // control before using the footer command bar, proving the mobile action is
  // reachable through supported sheet interaction rather than forced scrolling.
  await sheet.getByRole("button", { name: "Collapse sheet" }).click();
  await expect(sheet).toHaveClass(/sheet-half/);
  await expect(stickyActions).toBeInViewport();

  // Anonymous sessions have always been routed to sign-in before the price
  // form (runPriceContributionRequest in lib/priceContributionIntent.ts,
  // unchanged since PR #675 — not a tonight regression). The default e2e
  // chromium project injects a configured-but-fake Supabase URL/key
  // (playwright.config.ts), so authConfigured is true and an anonymous click
  // always shows the sign-in gate, never the price textbox directly.
  await stickyActions.getByRole("button", { name: /add a price/i }).click();
  const overviewTab = page.getByRole("tab", { name: "Overview", exact: true });
  await expect(overviewTab).toHaveAttribute("aria-selected", "true");
  await expect(page.locator("#venuePanel-overview")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign in to add a price" }).first(),
  ).toBeVisible();
});

test("theme toggle flips html[data-theme], persists to localStorage, survives reload", async ({
  page,
}) => {
  // The floating ThemeToggle lives on /map. The no-flash inline script sets
  // data-theme before hydration, so an initial value always exists.
  await page.setViewportSize({ width: 390, height: 844 });
  await dismissMapFirstRunTour(page);
  await page.goto("/map");
  await page.getByRole("button", { name: "More map controls" }).click();
  // PR #677 (3740a132, accessible context-aware map key) added the "Key" tab
  // and made it the default, pushing the ThemeToggle behind the "Layers" tab
  // (components/PubMap.tsx, mobileLayersTab).
  await page.getByRole("tab", { name: "Layers", exact: true }).click();

  const html = page.locator("html");
  const before = await html.getAttribute("data-theme");
  expect(before === "light" || before === "dark").toBe(true);

  await page
    .getByRole("button", { name: /switch to (dark|light) theme/i })
    .click();

  const after = await html.getAttribute("data-theme");
  expect(after).not.toBe(before);
  expect(after === "light" || after === "dark").toBe(true);

  // Persisted under the app's storage key, and the choice survives a reload.
  const stored = await page.evaluate(() => localStorage.getItem("pubmax-theme"));
  expect(stored).toBe(after);

  await page.reload();
  const storedAfterReload = await page.evaluate(() =>
    localStorage.getItem("pubmax-theme"),
  );
  expect(storedAfterReload).toBe(after);
  // The chosen theme is re-applied to <html data-theme> after reload — the
  // ThemeToggle mount effect re-asserts it (React 19 hydration can drop the
  // attribute the no-flash script set). Guards that fix.
  await expect(html).toHaveAttribute("data-theme", after);
});
