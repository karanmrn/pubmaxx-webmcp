import { test, expect, type Page } from "@playwright/test";

test.setTimeout(60_000);

// Permanent Near acceptance keeps browsing and accepting separate. Opening a
// card selects it on Map without writing. Only the explicit acceptance action
// persists PlanningIntent and adds the accepted-arrival URL markers.

const PLANNING_INTENT_KEY = "pubmax:planning-intent:v1";

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function captureAnalytics(page: Page): Promise<unknown[]> {
  const payloads: unknown[] = [];
  await page.route("**/api/events", async (route) => {
    const raw = route.request().postData();
    if (raw) payloads.push(JSON.parse(raw));
    await route.fulfill({ status: 204, headers: { "cache-control": "no-store" } });
  });
  return payloads;
}

test("Near separates browsing from permanent Venue acceptance", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    if (!localStorage.getItem("pubmax-theme")) localStorage.setItem("pubmax-theme", "light");
  });

  // Shareable patch link answers immediately, no geolocation prompt needed.
  const response = await page.goto("/near?patch=soho");
  expect(response?.status()).toBe(200);

  // Standard app chrome (upstream centered Near shell) — never the removed
  // custom back-arrow shell.
  await expect(page.getByRole("navigation", { name: "Site navigation" })).toBeVisible();
  await expect(page.locator("section.nmn")).toBeVisible();

  // The patch answer resolves to real cards.
  const firstCard = page.locator(".nmnCard").first();
  await expect(firstCard).toBeVisible();
  await expect(page.getByRole("heading", { name: "Cheapest listed around Soho" })).toBeVisible();
  await expect(page.getByText("Finding the cheapest", { exact: false })).toHaveCount(0);

  const accept = page.locator(".nmnAccept").first();
  await expect(accept).toBeVisible();
  await expect(accept).toHaveText("Keep for tonight");
  const appearance = await accept.evaluate((button) => {
    const probe = document.createElement("span");
    probe.style.cssText = "position:fixed;background:var(--state-active-surface);border:1px solid var(--state-active-border);color:var(--state-active-ink)";
    document.body.appendChild(probe);
    const actual = getComputedStyle(button);
    const expected = getComputedStyle(probe);
    const result = {
      height: button.getBoundingClientRect().height,
      actual: [actual.backgroundColor, actual.borderColor, actual.color],
      expected: [expected.backgroundColor, expected.borderColor, expected.color],
    };
    probe.remove();
    return result;
  });
  expect(appearance.height).toBeGreaterThanOrEqual(48);
  expect(appearance.actual).toEqual(appearance.expected);

  // The permanent Keep action may not take the pub name's width. At 390px the
  // button drops onto its own line and the name wraps, so every name renders
  // whole rather than being ellipsed, and the row still does not scroll.
  const nameFit = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".nmnCardRow .nmnCardName")).map((node) => {
      const el = node as HTMLElement;
      return {
        text: el.textContent ?? "",
        clipped: el.scrollWidth > el.clientWidth,
      };
    }),
  );
  expect(nameFit.length).toBeGreaterThan(0);
  expect(nameFit.filter((name) => name.clipped)).toEqual([]);
  const horizontalOverflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  expect(horizontalOverflow).toBeLessThanOrEqual(0);
  await expect(page.locator(".nmnAcceptReceipt")).toHaveText(
    "Choose a pub to keep for tonight.",
  );

  // Nothing was written just by rendering the answer.
  const beforeClick = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    PLANNING_INTENT_KEY,
  );
  expect(beforeClick).toBeNull();

  // Opening a card is browse: it navigates to the canonical selected Map URL and
  // still leaves no stored intent behind.
  await firstCard.click();
  await expect(page).toHaveURL(/\/map(\/[a-z-]+)?\?[^#]*\bsel=/);
  const afterClick = await page.evaluate(
    (key) => window.sessionStorage.getItem(key),
    PLANNING_INTENT_KEY,
  );
  expect(afterClick).toBeNull();

  await page.goBack();
  await expect(page.locator(".nmnAccept").first()).toBeVisible();
  await page.locator(".nmnAccept").first().click();
  await expect(page).toHaveURL(/\/map(\/[a-z-]+)?\?[^#]*\bsel=[^&]+&accept=1&src=near/);
  await expect(page.getByText("Kept for tonight. Make it Stop 1 when you are ready.")).toBeVisible();
  const acceptStop1 = page
    .locator('.mobileSheetPortal[data-sheet-kind="venue"]')
    .getByRole("button", { name: /^Make .+ Stop 1$/ });
  await expect(acceptStop1).toBeVisible({ timeout: 30_000 });
  await expect(acceptStop1).toHaveText("Make it Stop 1");
  // The acceptance markers must survive the Venue detail load. Canonicalising
  // the selected id is the SAME pub resolving its own name, never a switch to
  // another one, so it may not quietly turn an accepted arrival into browsing.
  await expect(page).toHaveURL(/[?&]accept=1(&|$)/);
  await expect(page).toHaveURL(/[?&]src=near(&|$)/);
  await page.screenshot({
    path: "docs/proof/venue-acceptance/accepted-map-390-light.png",
  });
  await page.evaluate(() => {
    localStorage.setItem("pubmax-theme", "dark");
  });
  await page.reload();
  // The reload is a cold arrival on the CDN-cached /map document, so the sheet
  // is rebuilt from ?sel= and its Venue read. Wait for the sheet the same way
  // the first arrival above does; the receipt lives inside it.
  await expect(acceptStop1).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Kept for tonight. Make it Stop 1 when you are ready.")).toBeVisible();
  await expect(acceptStop1).toHaveText("Make it Stop 1");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  await page.screenshot({
    path: "docs/proof/venue-acceptance/accepted-map-390-dark.png",
  });
  const stored = await page.evaluate((key) => {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, PLANNING_INTENT_KEY);
  expect(stored?.source).toBe("near");
  expect(stored?.acceptedVenueId).toBeTruthy();

  // The /near surface itself raised no uncaught errors.
  expect(errors).toEqual([]);
});

test("storage denial stays on Near and emits no acceptance events", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "granted");
    const nativeSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      if (this === sessionStorage && key === "pubmax:planning-intent:v1") {
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      return nativeSetItem.call(this, key, value);
    };
  });
  const payloads = await captureAnalytics(page);

  await page.goto("/near?patch=soho");
  await page.locator(".nmnAccept").first().click();

  await expect(page).toHaveURL(/\/near\?patch=soho$/);
  await expect(page.locator(".nmnAcceptError")).toHaveText(
    "Couldn’t keep this pub on this device. Try again.",
  );
  // Visible error is action completion. Storage failed before trackEvent, so
  // no analytics request can be queued after this state.
  expect(payloads.some((payload) => (
    payload && typeof payload === "object"
    && ["venue_accepted", "planning_handoff_opened"].includes(
      String((payload as { name?: unknown }).name),
    )
  ))).toBe(false);
});

test("Map rejects forged Near acceptance markers", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    localStorage.setItem("pubmax-theme", "light");
  });

  await page.goto("/near?patch=soho");
  const firstCard = page.locator(".nmnCard").first();
  await expect(firstCard).toBeVisible();
  await firstCard.click();
  await expect(page).toHaveURL(/\/map(\/[a-z-]+)?\?[^#]*\bsel=/);
  const forgedUrl = new URL(page.url());
  forgedUrl.searchParams.set("accept", "1");
  forgedUrl.searchParams.set("src", "near");

  expect(
    await page.evaluate((key) => window.sessionStorage.getItem(key), PLANNING_INTENT_KEY),
  ).toBeNull();
  await page.goto(forgedUrl.toString());

  const acceptStop1 = page
    .locator('.mobileSheetPortal[data-sheet-kind="venue"]')
    .getByRole("button", { name: /^Make .+ Stop 1$/ });
  await expect(acceptStop1).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".venueAcceptanceReceipt")).toHaveCount(0);

  await acceptStop1.click();
  await expect(page).toHaveURL(/\/plan(?:\?|$)/);
  const stored = await page.evaluate((key) => {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, PLANNING_INTENT_KEY);
  expect(stored?.source).toBe("map-search");
});
