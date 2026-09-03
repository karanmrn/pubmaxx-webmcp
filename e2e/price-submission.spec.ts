import { expect, test, type Page } from "@playwright/test";

// Community price submission E2E: the word-of-mouth moment end to end on a
// phone - tap a pub, pick a drink, type tonight's price, and watch the venue
// card restamp with its own dated community badge.
//
// TRUST GATE (captain decision 2026-07-26, review findings F1/F4). One account's
// report is NOT the map's price. This spec keeps one stable signed-in account,
// so everything it submits stays at one voice however many times it taps. That
// makes this the natural place to prove the uncorroborated half of the policy
// end to end: the sheet restamps, says it is awaiting confirmation, and the map
// keeps the price on record.
//
// The other two halves are unreachable from a browser and are pinned at their
// seams instead. A genuinely independent second submitter needs two distinct
// actors (__tests__/priceSubmitRoute.test.ts), and a 31-day-old price cannot be
// created at all through the API - submissions are stamped with the server's
// own clock, on purpose - so the age gate is asserted against an injected `now`
// in __tests__/communityPriceSignals.test.ts.
//
// Style mirrors e2e/golden-thread.spec.ts: the non-canvas selection path
// (/map?sel=<venueId>) so no WebGL is required, watchPageErrors, and a stable
// class selector. The identity journey uses a local Supabase boundary double,
// while route tests pin server verification and durable identity policy.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function openVenueSheet(page: Page) {
  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible();
  const inspector = venueSheet.locator(".venueInspector");
  const expand = venueSheet.getByRole("button", { name: "Expand sheet" });
  await expect.poll(async () => (await inspector.isVisible()) || (await expand.isVisible())).toBe(true);
  if (!(await inspector.isVisible()) && (await expand.isVisible())) await expand.click();
  await expect(inspector).toBeVisible();
  return venueSheet;
}

// A known seed venue id (lib/pintDropSeeds.ts) - the same pub the Golden
// Thread spec drives, so the sheet reliably has content around the card.
const SEED_VENUE_ID = "venue-16pnwmm";
const NO_ALCOHOL_VENUE_ID = "venue-19211ib";
const VIEWPORT = { width: 390, height: 844 };
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-000000000001";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";

async function seedSignedInSession(page: Page): Promise<void> {
  await page.addInitScript(({ authStorageKey, userId }) => {
    window.localStorage.setItem(
      authStorageKey,
      JSON.stringify({
        access_token: "pubmaxx-e2e-access-token",
        refresh_token: "pubmaxx-e2e-refresh-token",
        expires_at: Math.floor(Date.now() / 1000) + 86_400,
        expires_in: 86_400,
        token_type: "bearer",
        user: {
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "price-e2e@example.test",
          app_metadata: {},
          user_metadata: {},
          created_at: "2026-07-29T00:00:00.000Z",
        },
      }),
    );
  }, {
    authStorageKey: E2E_AUTH_STORAGE_KEY,
    userId: E2E_AUTH_USER_ID,
  });
}

type SubmittedPrice = {
  id: string;
  venueId: string;
  drinkCategory: string;
  priceGbp: number;
  submittedAt: number;
  source: "community";
  corroborations: number;
};

type SubmittedSignal = {
  id: string;
  venueId: string;
  signalKey: string;
  signalValue: string;
  submittedAt: number;
  source: "community";
  corroborations: number;
};

async function installContributorBoundary(
  page: Page,
  options: { requireOnboarding: boolean },
): Promise<{
  submittedPrices: SubmittedPrice[];
  submittedSignals: SubmittedSignal[];
}> {
  await seedSignedInSession(page);
  let onboardingComplete = !options.requireOnboarding;
  let lastSubmittedAt = Date.now();
  const submittedPrices: SubmittedPrice[] = [];
  const submittedSignals: SubmittedSignal[] = [];

  const nextSubmittedAt = (): number => {
    lastSubmittedAt = Math.max(lastSubmittedAt + 1, Date.now());
    return lastSubmittedAt;
  };

  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "price-e2e@example.test",
      }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer pubmaxx-e2e-access-token",
    );
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({
        handle: "night_owl",
        dateOfBirth: "2015-02-03",
      });
      onboardingComplete = true;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ complete: true, handle: "night_owl" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ complete: onboardingComplete }),
    });
  });
  await page.route("**/api/identity/handle/availability?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ available: true }),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    expect(route.request().headers().authorization).toBe(
      "Bearer pubmaxx-e2e-access-token",
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        handle: onboardingComplete ? "night_owl" : null,
      }),
    });
  });
  await page.route("**/api/price-submit**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          prices: submittedPrices,
          signals: submittedSignals,
        }),
      });
      return;
    }
    expect(route.request().headers().authorization).toBe(
      "Bearer pubmaxx-e2e-access-token",
    );
    const body = route.request().postDataJSON() as {
      venueId: string;
      drinkCategory: string;
      priceGbp: number;
      kind?: string;
      signalKey?: string;
      signalValue?: string;
    };
    if (
      body.kind === "venue-signal" &&
      body.signalKey &&
      body.signalValue
    ) {
      const submittedSignal: SubmittedSignal = {
        id: `signal-e2e-${submittedSignals.length + 1}`,
        venueId: body.venueId,
        signalKey: body.signalKey,
        signalValue: body.signalValue,
        submittedAt: nextSubmittedAt(),
        source: "community",
        corroborations: 1,
      };
      submittedSignals.push(submittedSignal);
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, signal: submittedSignal }),
      });
      return;
    }
    const submittedPrice: SubmittedPrice = {
      id: `price-e2e-${submittedPrices.length + 1}`,
      venueId: body.venueId,
      drinkCategory: body.drinkCategory,
      priceGbp: body.priceGbp,
      submittedAt: nextSubmittedAt(),
      source: "community",
      corroborations: 1,
    };
    const previous = submittedPrices.findIndex(
      (price) =>
        price.venueId === body.venueId &&
        price.drinkCategory === body.drinkCategory,
    );
    if (previous === -1) submittedPrices.push(submittedPrice);
    else submittedPrices.splice(previous, 1, submittedPrice);
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        price: submittedPrice,
        attribution: { status: "credited", handle: "night_owl" },
      }),
    });
  });

  return { submittedPrices, submittedSignals };
}

test.setTimeout(60_000);

// Identity boundary state is local to each test. Keep this file sequential so
// submission journeys remain easy to diagnose from one ordered trace.
test.describe.configure({ mode: "default" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("an over-limit drink price is blocked before any network attempt", async ({
  page,
}) => {
  let writes = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/price-submit"
    ) {
      writes += 1;
    }
  });
  await installContributorBoundary(page, { requireOnboarding: false });

  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  const venueSheet = page.locator('.mobileSheetPortal[data-sheet-kind="venue"]');
  await expect(venueSheet).toBeVisible();
  const submit = venueSheet.locator(".venuePriceSubmit");
  await expect(submit).toBeVisible();

  const priceField = submit.getByRole("textbox");
  const logButton = submit.getByRole("button", { name: "Log it" });
  await priceField.fill("31.00");

  await expect(priceField).toHaveAttribute("aria-invalid", "true");
  await expect(submit.getByRole("alert")).toContainText(
    "£30 is our ceiling for one drink",
  );
  await expect(logButton).toBeDisabled();

  await priceField.press("Enter");
  await page.waitForTimeout(100);
  expect(writes).toBe(0);
});

test("a drinker logs tonight's price after completing private signup", async ({
  page,
}, testInfo) => {
  const errors = watchPageErrors(page);
  const analyticsPayloads: Array<{ name?: unknown; props?: unknown }> = [];
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "granted");
  });
  await page.route("**/api/events", async (route) => {
    const raw = route.request().postData();
    if (raw) analyticsPayloads.push(JSON.parse(raw));
    await route.fulfill({ status: 204, headers: { "cache-control": "no-store" } });
  });
  const boundary = await installContributorBoundary(page, {
    requireOnboarding: true,
  });
  await page.route("**/api/profiles/night_owl/lane-stats", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 350));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stats: {
          status: "ready",
          handle: "night_owl",
          prices: 1,
          reviews: 0,
          recommendations: 0,
          total: 1,
        },
      }),
    });
  });
  await page.route("**/api/price-impact", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        observationsLogged: 1,
        pricesTrustedNow: 0,
        lifetimeTrustUnlocks: 0,
      }),
    });
  });

  await page.addInitScript(() => {
    const originalScrollIntoView = Element.prototype.scrollIntoView;
    const browser = window as typeof window & { __impactScrolls?: number };
    browser.__impactScrolls = 0;
    Element.prototype.scrollIntoView = function (...args) {
      if (this instanceof HTMLElement && this.id === "contribution-impact") {
        browser.__impactScrolls = (browser.__impactScrolls ?? 0) + 1;
      }
      return originalScrollIntoView.apply(this, args);
    };
  });

  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  const venueSheet = await openVenueSheet(page);

  const onboarding = page.getByRole("dialog", {
    name: "Let's get you in",
  });
  await expect(onboarding).toBeVisible();
  await expect(onboarding.getByLabel("Your handle")).toBeVisible();
  await expect(onboarding.getByLabel("Date of birth")).toBeVisible();
  const onboardingZ = await onboarding.evaluate((element) =>
    Number.parseInt(getComputedStyle(element.parentElement!).zIndex, 10),
  );
  const venueSheetZ = await venueSheet.evaluate((element) =>
    Number.parseInt(getComputedStyle(element).zIndex, 10),
  );
  expect(onboardingZ).toBeGreaterThan(venueSheetZ);
  const handleField = onboarding.getByLabel("Your handle");
  await handleField.fill("night_owl");
  await expect(handleField).toHaveValue("night_owl");
  await onboarding.getByLabel("Date of birth").fill("2015-02-03");
  await expect(onboarding.getByLabel("Date of birth")).toHaveValue("2015-02-03");
  await expect(onboarding.getByRole("status")).toHaveText("Handle available.");
  const claimHandle = onboarding.getByRole("button", {
    name: "Claim handle",
  });
  await expect(claimHandle).toBeEnabled();
  await claimHandle.click();
  await expect(onboarding).toHaveCount(0);
  await openVenueSheet(page);

  // The submit card lives on the Overview tab, the tab the sheet opens on.
  const submit = venueSheet.locator(".venuePriceSubmit");
  await expect(submit).toBeVisible();
  // The copy uses a typographic apostrophe, so match the shape, not the glyph.
  await expect(submit.getByRole("heading", { name: /What.s it tonight\?/ })).toBeVisible();

  // Every control is thumb-sized at 390px - this is a card used one-handed at
  // a bar, so a cramped target is a real defect, not a nit.
  for (const name of ["Beer", "Alcohol-free", "Soft drinks", "Coffee", "Wine"]) {
    const chip = submit.getByRole("radio", { name, exact: true });
    await expect(chip).toBeVisible();
    const box = await chip.boundingBox();
    expect(box?.height ?? 0, `${name} chip height`).toBeGreaterThanOrEqual(44);
  }
  const quickPriceChips = submit.locator(".vpsubQuickChip");
  await expect(quickPriceChips).toHaveCount(3);
  for (let index = 0; index < 3; index += 1) {
    const chip = quickPriceChips.nth(index);
    await expect(chip).toBeVisible();
    const box = await chip.boundingBox();
    expect(box?.height ?? 0, `quick-price chip ${index + 1} height`).toBeGreaterThanOrEqual(44);
  }

  const priceField = submit.getByRole("textbox");
  const logButton = submit.getByRole("button", { name: "Log it" });

  // Bounds first: an implausible figure is refused in place, with a sentence
  // that says what a real price looks like - and nothing reaches the map.
  await priceField.fill("0.45");
  const error = submit.getByRole("alert");
  await expect(priceField).toHaveAttribute("aria-invalid", "true");
  await expect(error).toBeVisible();
  await expect(error).toContainText("£4.50");
  await expect(logButton).toBeDisabled();
  await priceField.press("Enter");
  await expect(venueSheet.locator(".communityPriceRow")).toHaveCount(0);

  // First valid contribution proceeds directly after completed signup. Date of
  // birth is a private profile field, not a contribution gate.
  await priceField.fill("4.20");
  await logButton.click();
  await expect(
    page.getByRole("dialog", { name: /18 or over|age/i }),
  ).toHaveCount(0);

  const stamp = submit.locator(".vpsubStamp");
  await expect(stamp).toBeVisible();
  await expect(stamp).toContainText("£4.20");
  await expect(stamp).toContainText("today");
  await expect(stamp.locator("xpath=following-sibling::*[1]")).toContainText(
    "@night_owl",
  );
  const impactLink = submit.getByRole("link", { name: "See your impact" });
  await expect(impactLink).toHaveAttribute(
    "href",
    "/u/night_owl#contribution-impact",
  );
  expect(
    (await impactLink.boundingBox())?.height ?? 0,
  ).toBeGreaterThanOrEqual(44);
  expect(
    (await impactLink.boundingBox())?.width ?? 0,
  ).toBeGreaterThanOrEqual(44);

  // …and the receipt is honest about REACH. One device is one voice, so this
  // tap has MARKED the map - the provisional badge on the pin - without setting
  // any price on it. Both halves matter: "Marked on the map" is the loop
  // closing in-session (captain decision 2026-07-26), and the hint beside it is
  // what stops that reading as "the pin now says £4.40".
  await expect(stamp).toContainText("Marked on the map");
  const stampHint = submit.getByText(/A second independent drinker/i);
  await expect(stampHint).toBeVisible();
  await expect(stampHint).toContainText(/second independent drinker/i);

  // The venue card carries the same price on its own dated, badged row -
  // alongside the price on record, which is still shown.
  const communityRow = venueSheet.locator(".communityPriceRow");
  await expect(communityRow).toBeVisible();
  await expect(communityRow).toContainText("£4.20");
  await expect(communityRow).toContainText("today");

  // The uncorroborated half of the policy, as the reader meets it: the figure
  // shows in full, dated, and says where it stands rather than letting the
  // reader assume a pin moved with it.
  await expect(communityRow.locator(".communityPriceStanding")).toContainText(
    /marked on the map as unconfirmed/i,
  );

  // And the number the map gate actually reads. Every submission in this test
  // came from one stable account, so however many times it tapped, the venue
  // still has exactly one voice behind it and
  // mergeCommunityPriceSignals refuses to restamp. The pin itself is a WebGL
  // surface this spec deliberately never opens, so the restamp decision is
  // asserted at its seam instead (__tests__/communityPriceSignals.test.ts);
  // what belongs here is proving the browser really did reach that state.
  expect(boundary.submittedPrices[0]).toMatchObject({
    venueId: SEED_VENUE_ID,
    drinkCategory: "beer",
    priceGbp: 4.2,
    corroborations: 1,
  });

  // Provenance is not flattened: whatever the pub had before the submission -
  // a sourced/baseline price row, or the honest "no price yet" nudge - is still
  // there underneath the new community row, not overwritten by it.
  await expect
    .poll(
      async () =>
        (await venueSheet.locator(".contributorPrice:not(.communityPriceRow)").count()) +
        (await venueSheet.locator(".firstDropNudge").count()),
      { message: "the price on record should survive a community submission" },
    )
    .toBeGreaterThan(0);

  expect(errors).toEqual([]);

  await impactLink.click();
  await expect(page).toHaveURL(/\/u\/night_owl#contribution-impact$/);
  const impact = page.locator("#contribution-impact");
  await expect(impact).toBeVisible();
  const priceTrustImpact = impact.locator('[data-testid="price-trust-impact"]');
  await expect(priceTrustImpact.locator(".contribStatValue").first()).toHaveText("1");
  await expect(priceTrustImpact.locator(".contribStatLabel").first()).toHaveText(
    "observation logged",
  );
  await expect(page.locator(".contribNudge")).toHaveCount(0);
  await expect.poll(() =>
    impact.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    }),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => (window as typeof window & { __impactScrolls?: number }).__impactScrolls ?? 0,
    ),
  ).toBe(1);
  const arrivalWelcome = page.locator(".arrivalWelcome");
  if (await arrivalWelcome.isVisible()) {
    await expect.poll(async () => {
      const [welcomeBox, impactBox] = await Promise.all([
        arrivalWelcome.boundingBox(),
        impact.boundingBox(),
      ]);
      return (
        !welcomeBox ||
        !impactBox ||
        welcomeBox.y + welcomeBox.height <= impactBox.y
      );
    }).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    VIEWPORT.width,
  );
  await page.screenshot({
    path: testInfo.outputPath("price-impact-destination.png"),
    fullPage: false,
  });
  await expect.poll(() =>
    analyticsPayloads
      .filter((payload) => payload.name === "price_impact_opened")
      .map(({ name, props }) => ({ name, props })),
  )
    .toEqual([{ name: "price_impact_opened", props: {} }]);
});

test("a person can log soft-drink, alcohol-free and coffee prices from the pub sheet", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  const boundary = await installContributorBoundary(page, {
    requireOnboarding: false,
  });
  const response = await page.goto(`/map?sel=${NO_ALCOHOL_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  const venueSheet = await openVenueSheet(page);
  const submit = venueSheet.locator(".venuePriceSubmit");
  await expect(submit).toBeVisible();
  const priceField = submit.getByRole("textbox");
  const logButton = submit.getByRole("button", { name: "Log it" });
  const stamp = submit.locator(".vpsubStamp");

  for (const entry of [
    { label: "Soft drinks", category: "soft-drink", price: "2.80" },
    { label: "Alcohol-free", category: "alcohol-free", price: "4.60" },
    { label: "Coffee", category: "coffee", price: "2.50" },
  ] as const) {
    const category = submit.getByRole("radio", {
      name: entry.label,
      exact: true,
    });
    await category.click();
    await expect(category).toHaveAttribute("aria-checked", "true");
    await priceField.fill(entry.price);
    await logButton.click();
    await expect(stamp).toContainText(`£${entry.price}`);
    await expect(stamp).toContainText("On this pub’s page");

    expect(
      boundary.submittedPrices.find(
        (row) => row.drinkCategory === entry.category,
      )?.priceGbp,
    ).toBe(Number(entry.price));
  }

  // The default pint lane has no submitted beer, so menu order leads with
  // alcohol-free. Coffee remains its own row rather than replacing another
  // category's observation.
  const communityRow = venueSheet.locator(".communityPriceRow");
  await expect(communityRow).toContainText("Alcohol-free");
  await expect(communityRow).toContainText("£4.60");
  const coffeeRow = venueSheet.locator(".venueDrinkPriceRow", {
    hasText: "Coffee",
  });
  await expect(coffeeRow).toContainText("£2.50");
  expect(errors).toEqual([]);
});

test("the one-tap price confirm still works alongside submission", async ({ page }) => {
  const errors = watchPageErrors(page);

  const response = await page.goto(`/map?sel=${SEED_VENUE_ID}`);
  expect(response?.status()).toBe(200);

  const venueSheet = await openVenueSheet(page);

  // The Golden Thread (and its "Still £X?" chip) lives on the Stories tab.
  await venueSheet.getByRole("tab", { name: "Stories", exact: true }).click();
  const priceStory = page.locator(".venuePriceStory");
  await expect(priceStory).toHaveCount(1);

  // This seed pub carries a resolvable price, so the vouch chip is present and
  // asserted outright - if a seed change ever removed it, this regression guard
  // should fail loudly rather than quietly assert nothing.
  const confirmChip = priceStory.locator(".vpsConfirmBtn");
  await expect(confirmChip).toBeVisible();
  await expect(confirmChip).toHaveAttribute("aria-pressed", "false");
  await confirmChip.click();
  await expect(confirmChip).toHaveAttribute("aria-pressed", "true");
  await expect(confirmChip).toContainText("Confirmed");

  expect(errors).toEqual([]);
});
