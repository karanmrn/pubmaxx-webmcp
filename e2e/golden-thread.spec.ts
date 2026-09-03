import { test, expect, type Page } from "@playwright/test";

// Golden Thread E2E (GH #34). A READ-ONLY check that the per-venue price-story
// block renders on the venue surface when a pub is selected via the non-canvas
// URL path (/map?sel=<venueId>) — NO WebGL interaction, NO map clicks, and no
// mutation (it never POSTs a drop). Style mirrors e2e/social-loop.spec.ts:
// watchPageErrors, status-200, a stable selector, and every content assertion
// guarded so the suite is green on BOTH a populated venue and an empty-data
// venue (the honest empty state is a valid render, never a failure).

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// A known seed venue id (lib/pintDropSeeds.ts). Seeds merge into every read
// path, so this pub carries dataset baseline prices + seeded drops on both the
// in-memory and Supabase backends — the venue detail sheet has content to show.
const SEED_VENUE_ID = "venue-16pnwmm";

test("venue price-story block renders when a pub is selected via ?sel (§34)", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  // The venue detail sheet opens once the dataset fetch resolves (independent of
  // WebGL). Wait web-first for EITHER the inspector or the map's own loaded
  // state, so we never branch on a mid-load snapshot.
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible();
  const inspector = venueSheet.locator(".venueInspector");
  const priceStory = page.locator(".venuePriceStory");

  await expect(inspector).toBeVisible();

  // The selected seed must resolve into the one coordinated venue sheet. The
  // Golden Thread block then renders its resolved story or honest empty state.
  await venueSheet.getByRole("tab", { name: "Stories", exact: true }).click();
  await expect(venueSheet.locator(".mobileSharedSheet")).toHaveClass(/sheet-full/);
  await expect(priceStory).toHaveCount(1);

  // The section is always titled, populated or empty.
  await expect(priceStory.getByText("The Golden Thread")).toBeVisible();

  // If a baseline/community price resolved, the footnote provenance legend is
  // shown; if the venue is truly empty, the honest empty note is shown. One of
  // the two always holds — assert their union so both states pass.
  const footnote = priceStory.locator(".vpsFootnote");
  const emptyNote = priceStory.locator("p.muted");
  await expect
    .poll(async () => (await footnote.count()) + (await emptyNote.count()))
    .toBeGreaterThan(0);

  // No uncaught page errors on the read-only journey.
  expect(errors).toEqual([]);
});
