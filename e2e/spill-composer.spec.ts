import { test, expect, type Page } from "@playwright/test";

// Price-first Spill composer E2E (activation report D2). WebGL-agnostic:
// the composer is a DOM panel inside VenueInspector, opened by deep-linking to a
// seed pub's detail sheet (?sel=<id>) and clicking the Stories panel's
// "Log a Pint Drop" button - never a canvas pin click. The door opens on the
// price step; the photo, story, vibes and visibility wait behind the one
// "Add a photo or story" disclosure. Mirrors e2e/social-loop.spec.ts / e2e/
// map-story.spec.ts: watchPageErrors, web-first assertions, .count()-guards so an
// empty/altered seed is never a hard failure, no waitForTimeout.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// Mirrors lib/venues.ts venueGroupingKey + stableVenueIdFromKey (the same tiny,
// stable, public hash e2e/map-story.spec.ts + smoke.spec.ts use) so we can
// deep-link straight to a known seed pub's detail sheet without a canvas click.
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

// A known seed row from public/data/venues_slim.json ("Arnos Arms") — the same
// stable id smoke.spec.ts deep-links to.
const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);

// Open the composer inside the Stories panel and return the panel + form locators.
async function openComposer(page: Page) {
  await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible();
  const pintsPanel = venueSheet.locator("#venuePanel-pints");
  await venueSheet.getByRole("tab", { name: "Stories", exact: true }).click();
  await expect(venueSheet.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);
  await expect(pintsPanel).toBeVisible();
  await pintsPanel.getByRole("button", { name: /log a pint drop/i }).click();
  const form = page.locator("form.dropComposer");
  await expect(form).toBeVisible();
  return { pintsPanel, form };
}

// The one disclosure that reveals the optional half of the composer.
async function openExtras(form: ReturnType<Page["locator"]>) {
  await form.getByRole("button", { name: "Add a photo or story" }).click();
}

test.describe("price-first Spill composer", () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
  });

  test("on a 390px viewport the price step leads and the camera waits behind the disclosure", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const { form } = await openComposer(page);

    // Venue context leads, then the price step. The camera is an extra now:
    // a price intent never lands on a photo step. On an auth-shaped build the
    // signed-out door line may sit between the intro and the price step.
    await expect(form.locator(".spillComposerIntro")).toContainText("Arnos Arms");
    await expect(form.locator('[data-testid="spill-price-step"]')).toBeVisible();
    await expect(form.locator('[data-testid="spill-camera-step"]')).toHaveCount(0);

    const introLeadsStraightToPrice = await form.evaluate((el) => {
      const children = Array.from(el.children);
      const priceIndex = children.findIndex(
        (child) => child.getAttribute("data-testid") === "spill-price-step",
      );
      return (
        children[0]?.classList.contains("spillComposerIntro") === true &&
        priceIndex > 0 &&
        children
          .slice(1, priceIndex)
          .every((child) => child.classList.contains("spillSignedOutNote"))
      );
    });
    expect(introLeadsStraightToPrice).toBe(true);

    // The compact door: price chips, drink and the submit action (the Log it
    // button, or the sign-in gate in the same slot on an auth-shaped build).
    await expect(form.getByRole("group", { name: /quick-add price/i })).toBeVisible();
    await expect(form.getByLabel("Drink")).toBeVisible();
    await expect(
      form.locator('button[type="submit"], a.spillSubmitLink').first(),
    ).toBeVisible();

    // One disclosure opens the optional half.
    await openExtras(form);
    await expect(form.locator('[data-testid="spill-camera-step"]')).toBeVisible();
    await expect(
      form.getByRole("group", { name: /add this spill to/i }).getByRole("button", {
        name: "Tonight",
      }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("mobile camera actions keep rear-camera and selfie capture semantics", async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const { form } = await openComposer(page);
    await openExtras(form);

    const cameraStep = form.locator('[data-testid="spill-camera-step"]');
    await expect(cameraStep.getByText("Snap the pour")).toBeVisible();
    await expect(cameraStep.getByText("Flip: you at the bar")).toBeVisible();

    const pintCapture = cameraStep.getByLabel(/snap the pour/i);
    await expect(pintCapture).toHaveAttribute("type", "file");
    await expect(pintCapture).toHaveAttribute("accept", "image/*");
    await expect(pintCapture).toHaveAttribute("capture", "environment");

    const selfieCapture = cameraStep.getByLabel(/you at the bar/i);
    await expect(selfieCapture).toHaveAttribute("type", "file");
    await expect(selfieCapture).toHaveAttribute("accept", "image/*");
    await expect(selfieCapture).toHaveAttribute("capture", "user");

    expect(errors).toEqual([]);
  });

  test("one-tap destination + price chips render, and preview updates on price", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const { form } = await openComposer(page);
    await openExtras(form);

    // Destination chips (Tonight / My Round / Family Table / Ledger) render.
    const destinations = form.getByRole("group", { name: /add this spill to/i });
    await expect(destinations).toBeVisible();
    for (const label of ["Tonight", "My Round", "Family Table", "Ledger"]) {
      await expect(destinations.getByRole("button", { name: label })).toBeVisible();
    }
    // My Round is honestly disabled with no open Round (never faked).
    await expect(destinations.getByRole("button", { name: "My Round" })).toBeDisabled();

    // Price quick-add chips render.
    const priceChips = form.getByRole("group", { name: /quick-add price/i });
    await expect(priceChips).toBeVisible();
    await expect(priceChips.getByRole("button").first()).toBeVisible();

    // Instant preview: no price stamp yet, then a price chip tap makes one appear.
    await expect(form.locator(".spillPreviewPrice")).toHaveCount(0);
    await priceChips.getByRole("button").first().click();
    await expect(form.locator(".spillPreviewPrice")).toBeVisible();
    await expect(form.locator(".spillPreviewPrice")).toContainText(/£/);

    // A priced Spill reads as a Contributor claim in the live preview — provenance
    // surfaced, never flattened.
    await expect(form.locator(".spillPreviewProv")).toContainText(/Contributor/i);

    expect(errors).toEqual([]);
  });

  test("choosing Family Table selects the Legacy visibility lane", async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const { form } = await openComposer(page);
    await openExtras(form);

    await form.getByRole("button", { name: "Family Table" }).click();

    // The (secondary) visibility radiogroup should now have Legacy checked.
    const visibility = form.getByRole("radiogroup", { name: "Visibility" });
    await expect(visibility.getByRole("radio", { name: "Legacy" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    expect(errors).toEqual([]);
  });

  test("signed out, the same door renders with the sign-in gate at submit", async ({
    page,
  }) => {
    // The submit round trip needs a keyless build (typed handle) and lives in
    // e2e/spill-composer-keyless.spec.ts. This server is auth-shaped, so the
    // signed-out contract is the one to pin here (report D2): the same
    // price-first door, the account rule named up front, and the sign-in link
    // where submit would be. No typed handle exists on this build at all.
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const { form } = await openComposer(page);

    await expect(form.locator(".spillSignedOutNote")).toContainText(
      "Sign in to post it under your name.",
    );
    await expect(form.locator('[data-testid="spill-price-step"]')).toBeVisible();
    const gate = form.locator("a.spillSubmitLink");
    await expect(gate).toBeVisible();
    await expect(gate).toHaveAttribute("href", /\/login\?mode=signin&from=/);
    await expect(form.locator('button[type="submit"]')).toHaveCount(0);
    await expect(form.getByLabel("Handle")).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("large-text / Legacy Mode keeps the composer usable at 390px", async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    // Legacy Mode is a data attribute on <html>; set it before the composer opens.
    await page.addInitScript(() => {
      const apply = () => document.documentElement?.setAttribute("data-legacy", "1");
      if (document.documentElement) apply();
      else window.addEventListener("DOMContentLoaded", apply, { once: true });
    });

    const { form } = await openComposer(page);

    // The core controls still render and are operable under Legacy Mode.
    await expect(form.getByRole("group", { name: /quick-add price/i })).toBeVisible();
    await expect(
      form.locator('button[type="submit"], a.spillSubmitLink').first(),
    ).toBeVisible();
    await openExtras(form);
    await expect(
      form.getByRole("group", { name: /add this spill to/i }).getByRole("button", {
        name: "Tonight",
      }),
    ).toBeVisible();
    await expect(form.locator(".spillPreviewCard")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("/map?log=1 opens the safe mobile log picker without the full pint dataset", async ({ page }) => {
    const errors = watchPageErrors(page);
    const requests: string[] = [];
    page.on("request", (request) => requests.push(new URL(request.url()).pathname));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    const response = await page.goto("/map?log=1");
    expect(response?.status()).toBe(200);

    const fallback = page.locator(".logIntentFallback");
    const form = page.locator("form.dropComposer");
    await expect.poll(async () => Number(await fallback.isVisible()) + Number(await form.isVisible())).toBeGreaterThan(0);
    if (await fallback.isVisible()) {
      await expect(fallback).toContainText("Pick a pub to log a Pint Drop");
      await fallback.getByRole("button").first().click();
    }
    await expect(form).toBeVisible({ timeout: 10_000 });
    // log=1 is a PRICE intent: it opens on the price step, never the camera.
    await expect(form.locator('[data-testid="spill-price-step"]')).toBeVisible();
    await expect(form.locator('[data-testid="spill-camera-step"]')).toHaveCount(0);
    await expect(form.getByRole("group", { name: /quick-add price/i })).toBeVisible();

    await expect
      .poll(async () =>
        page.evaluate(() => performance.getEntriesByName("pubmax:composer-interactive").length),
      )
      .toBeGreaterThan(0);

    const marks = await page.evaluate(() =>
      [
        "pubmax:map-chunk-ready",
        "pubmax:slim-venues-ready",
        "pubmax:composer-mounted",
        "pubmax:composer-interactive",
      ].map((name) => ({ name, count: performance.getEntriesByName(name).length })),
    );
    expect(marks.every((mark) => mark.count > 0)).toBe(true);
    expect(requests).toContain("/data/venues_slim.core.json");
    expect(requests).not.toContain("/data/pint_prices_app_dataset.json");

    expect(errors).toEqual([]);
  });

  test("mobile Pint Drop selection returns to the visible picker when the venue closes", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    const response = await page.goto("/map?log=1");
    expect(response?.status()).toBe(200);

    const fallback = page.locator(".logIntentFallback");
    const form = page.locator("form.dropComposer");
    await expect.poll(async () => Number(await fallback.isVisible()) + Number(await form.isVisible())).toBeGreaterThan(0);
    if (await fallback.isVisible()) await fallback.getByRole("button").first().click();

    const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
    const sheet = venueSheet.locator(".mobileSharedSheet");
    await expect(sheet).toHaveClass(/open/);
    await expect(form).toBeVisible({ timeout: 10_000 });

    // The sheet opened from the log picker carries surface-nav chrome: Back
    // returns to Choose a pub; a directly opened sheet keeps its own close.
    await venueSheet
      .getByRole("button", { name: /Back to Choose a pub|Close pub detail/ })
      .first()
      .click();

    // The SURFACE holds the intent after Back, not the URL: `log=1` is an
    // owned passthrough the map takes off the history entry once handled.
    await expect(page).toHaveURL(/\/map(\?log=1)?$/);
    await expect(sheet).toHaveCount(0);
    await expect(fallback).toBeVisible();
    await expect(fallback).toContainText("Pick a pub to log a Pint Drop");
  });
});
