import { expect, test, type Page } from "@playwright/test";

import { installAuthDoubles, seedSignedIn } from "./helpers/authDoubles";

// A signed-in browser that has LOST its Plan capability cookie must get it
// back, and a signed-out one must never spend the write finding that out.
//
// This is the lane the Plan claim PR (#1301) could not prove in a browser,
// because the auth doubles it needed were trapped inside
// e2e/account-switch-identity.spec.ts. They are shared now, so the journey is
// provable rather than only unit-covered.
//
// The capability lives in an HttpOnly cookie the page cannot read, so "losing
// it" is done through the browser context, exactly as a cookie expiry or a
// cleared jar would do it.

const CAPABILITY_COOKIE = (planId: string) => `pubmax_plan_member_${planId}`;
const RECOVERY_OBSERVATION_BUDGET_MS = 20_000;

/** The composer needs React attached before a tap counts. */
async function openHydratedPlanComposer(page: Page): Promise<void> {
  await page.goto("/plan");
  const stopCount = page
    .getByRole("group", { name: "Number of pub stops" })
    .getByRole("button", { name: "4", exact: true });
  await expect(async () => {
    await stopCount.click();
    await expect(stopCount).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

/** London-local `datetime-local` value a couple of hours out. */
function futureLondonFirstPint(): string {
  const when = new Date(Date.now() + 2 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(when);
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}T${lookup("hour")}:${lookup("minute")}`;
}

function trackMainFrameDocumentNavigations(page: Page): () => number {
  let documentRequests = 0;
  page.on("request", (request) => {
    if (
      request.isNavigationRequest()
      && request.resourceType() === "document"
      && request.frame() === page.mainFrame()
    ) {
      documentRequests += 1;
    }
  });
  return () => documentRequests;
}

/** Create a real Plan as the signed-in host and answer its id. */
async function lockInAPlan(
  page: Page,
  options: { waitForAccountClaim?: boolean } = {},
): Promise<string> {
  await openHydratedPlanComposer(page);
  await page.getByLabel("Describe the outing").fill("Quiet in Clapham for 4, not pricey");
  await page.getByRole("button", { name: "Make a plan" }).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await page.getByLabel("Your name").fill("Karan");
  await page.getByLabel("First pint").fill(futureLondonFirstPint());
  await page.getByRole("button", { name: "Regenerate route" }).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  const claim = options.waitForAccountClaim
    ? page.waitForResponse(
        (response) =>
          response.request().method() === "PUT"
          && /\/api\/plans\/[0-9a-f-]{36}\/session$/.test(response.url())
          && response.ok(),
        { timeout: RECOVERY_OBSERVATION_BUDGET_MS },
      )
    : null;
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}/);
  if (claim) await claim;
  return page.url().replace(/#.*$/, "").split("/plan/")[1]!;
}

/** Drop the HttpOnly capability cookie, leaving every other cookie alone. */
async function loseTheCapabilityCookie(page: Page, planId: string): Promise<void> {
  const context = page.context();
  const name = CAPABILITY_COOKIE(planId);
  const cookies = await context.cookies();
  expect(
    cookies.some((cookie) => cookie.name === name),
    "the capability cookie exists before the reset",
  ).toBe(true);
  const kept = cookies.filter((cookie) => cookie.name !== name);
  await context.clearCookies();
  await context.addCookies(kept);
  expect(
    (await context.cookies()).some((cookie) => cookie.name === name),
    "the capability cookie is gone before the reload",
  ).toBe(false);
}

test.describe("signed-in Plan capability recovery", () => {
  test("a signed-in host who lost the capability cookie recovers it on the Plan page", async ({
    page,
  }) => {
    // HELD, NOT DELETED. The e2e web server runs keyless, so it has no
    // SUPABASE_SERVICE_ROLE_KEY and getSupabaseAdmin() answers null. That makes
    // verifyCallerAuth answer "unavailable", and app/api/plans/[id]/session
    // answers 503 to BOTH the PUT that claims the seat and the PATCH that
    // recovers it. So the signed-in half cannot pass here, and the only ways to
    // make it pass are a real service-role key in CI or a test-only bypass
    // inside verifyCallerAuth. Both were refused: a backdoor in production auth
    // code is not paid for by a browser test. The journey below is kept whole so
    // it can be switched on the day a real authenticated e2e lane exists.
    // See #1300 for what would actually prove it.
    test.skip(
      true,
      "No service-role key in the keyless e2e server: verifyCallerAuth answers \"unavailable\", so the claim PUT and the recovery PATCH both answer 503 by design.",
    );
    // This test asserts the recovery PATCH, not the resume cookie, so it leaves
    // the real /api/auth/session budget alone (60 persists an hour per IP).
    await installAuthDoubles(page);
    await seedSignedIn(page, "A");

    const planId = await lockInAPlan(page, { waitForAccountClaim: true });
    await loseTheCapabilityCookie(page, planId);

    const documentRequestCount = trackMainFrameDocumentNavigations(page);

    // The recovery write is a PATCH under one idempotency key, so a second tab
    // or a retry converges rather than rotating the token twice.
    const recovery = page.waitForRequest(
      (request) =>
        request.method() === "PATCH"
        && request.url().includes(`/api/plans/${planId}/session`),
      { timeout: RECOVERY_OBSERVATION_BUDGET_MS },
    );

    await page.reload();

    const request = await recovery;
    expect(
      request.headers()["idempotency-key"],
      "recovery is sent under an idempotency key",
    ).toBeTruthy();

    // Access is back: the host-only control returns without a second reload.
    await expect(page.getByRole("button", { name: "Copy invite link" })).toBeVisible({
      timeout: RECOVERY_OBSERVATION_BUDGET_MS,
    });
    expect(documentRequestCount(), "one main-frame document request after cookie loss").toBe(1);
    expect(
      (await page.context().cookies()).some(
        (cookie) => cookie.name === CAPABILITY_COOKIE(planId),
      ),
      "the capability cookie is restored",
    ).toBe(true);
  });

  test("a signed-out browser never spends a recovery write", async ({ page }, testInfo) => {
    testInfo.setTimeout(testInfo.timeout + RECOVERY_OBSERVATION_BUDGET_MS);
    await installAuthDoubles(page);
    await seedSignedIn(page, "A");
    const planId = await lockInAPlan(page);
    await loseTheCapabilityCookie(page, planId);

    // Sign out and clear the seeded session, so the page loads as a stranger.
    await page.evaluate(() => window.localStorage.clear());

    const documentRequestCount = trackMainFrameDocumentNavigations(page);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        request.method() === "PATCH"
        && request.url().includes(`/api/plans/${planId}/session`)
      ) {
        writes.push(request.url());
      }
    });

    const reloadResponse = await page.reload();
    expect(reloadResponse?.status(), "public Plan reload succeeds").toBe(200);
    await expect(
      page.getByRole("heading", { name: /^Your night out(?: in .+)?$/ }),
    ).toBeVisible({ timeout: RECOVERY_OBSERVATION_BUDGET_MS });
    // Give the effect the same budget the signed-in case gets before concluding
    // that nothing was sent, so this cannot pass by simply being quicker.
    await page.waitForTimeout(RECOVERY_OBSERVATION_BUDGET_MS);

    expect(
      documentRequestCount(),
      "one main-frame document request after cookie loss",
    ).toBe(1);
    expect(writes, "a signed-out browser sends no recovery PATCH").toEqual([]);
    await expect(
      page.getByRole("button", { name: "Copy invite link" }),
    ).toHaveCount(0);
  });
});
