import { test, expect, type Page } from "@playwright/test";

// The two activation doors (report D2 + D3), measured at 390x844.
//
// D3: a chip tap on /plan generates a route, but the preview used to land
// below the fold (#plan-route-status at y 1548 on an 844px viewport, scrollY
// 0, focus on body). The door is only open if the route is SEEN: after
// generation the viewport moves to the route status and focus lands on it.
//
// D2: the first Pint Drop used to sit behind the whole Stories composer. The
// door is only open if a price is enterable within two taps of the venue
// surface: the composer opens on the price step and one chip tap enters a
// figure.

const MOBILE_VIEWPORT = { width: 390, height: 844 };

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

// Mirrors lib/venues.ts venueGroupingKey + stableVenueIdFromKey (the same tiny,
// stable, public hash e2e/spill-composer.spec.ts uses) so we can deep-link
// straight to a known seed pub's detail sheet without a canvas click.
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

const ARNOS_ARMS_ID = stableVenueIdFromKey(
  [
    normaliseVenueKeyPart("Arnos Arms"),
    normaliseVenueKeyPart("338 Bowes Road, Arnos Grove, London, N11 1AN"),
    (51.6162).toFixed(5),
    (-0.132117).toFixed(5),
  ].join("|"),
);

test.describe("activation doors at 390x844", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    // Reduced motion keeps the reveal a deterministic jump for the assertions;
    // the reveal itself must still move the viewport.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      // A prior run's plan drafts silently leak constraints into the next
      // generation; the spec always starts from a fresh describe-first entry.
      window.localStorage.removeItem("pubmax:plan-intake:v1");
      window.localStorage.removeItem("pubmaxx:plan-route-draft:v1");
    });
  });

  test("a chip tap lands the route in the viewport with focus on the status", async ({ page }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/plan");
    expect(response?.status()).toBe(200);

    // The describe-first entry surface is the default. One chip tap generates.
    await page.getByRole("button", { name: "Quiet in Clapham for 4, not pricey" }).click();

    const status = page.locator("#plan-route-status");
    await expect(status).toContainText("Route refreshed", { timeout: 20_000 });

    // The route is IN the viewport without a manual scroll: the page moved and
    // the status sits inside the 844px fold.
    await expect
      .poll(async () => {
        const box = await status.boundingBox();
        if (!box) return null;
        return box.y >= 0 && box.y < MOBILE_VIEWPORT.height;
      })
      .toBe(true);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

    // Focus follows, so the result is announced and the next key press starts
    // at the route rather than at the top of the form.
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ""))
      .toBe("plan-route-status");

    // The three-stop preview itself is reachable right below the status.
    await expect(page.locator(".planComposer__stops")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("a venue price door makes a price enterable within two taps", async ({ page }) => {
    const errors = watchPageErrors(page);

    // The venue's log door (the `Log a ... pint price` links land here with
    // ?log=1): the composer opens already on the price step. That is the one
    // tap the reader spent on the link; the second tap is the price itself.
    const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}&log=1`);
    expect(response?.status()).toBe(200);

    const form = page.locator("form.dropComposer");
    await expect(form).toBeVisible({ timeout: 15_000 });

    // Price first: the price step is on screen, the camera is not.
    const priceStep = form.locator('[data-testid="spill-price-step"]');
    await expect(priceStep).toBeVisible();
    await expect(form.locator('[data-testid="spill-camera-step"]')).toHaveCount(0);

    // One tap on a chip enters a figure.
    const chips = form.getByRole("group", { name: /quick-add price/i });
    await chips.getByRole("button").first().click();
    await expect(priceStep.locator('input[inputmode="decimal"]')).toHaveValue(/\d/);

    // The submit action sits right there in the compact door. On an
    // auth-shaped build a signed-out reader meets the sign-in gate in the same
    // slot; on a keyless build it is the Log it button. Either way the door's
    // action is beside the price, never below a photo step.
    await expect(
      form.locator('button[type="submit"], a.spillSubmitLink').first(),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });
});
