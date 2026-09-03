import { mkdir, writeFile } from "node:fs/promises";

import { expect, test, type Locator, type Page } from "@playwright/test";

const VIEWPORT = { width: 390, height: 844 };

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => Math.max(
    document.documentElement.scrollWidth - window.innerWidth,
    document.body.scrollWidth - window.innerWidth,
  ))).toBeLessThanOrEqual(1);
}

async function expectTouchTarget(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function saveShot(page: Page, name: string): Promise<void> {
  if (!process.env.PUBMAX_RESET_SHOTS) return;
  await mkdir("docs/screenshots/onboarding", { recursive: true });
  await writeFile(
    `docs/screenshots/onboarding/${name}.png`,
    await page.screenshot({ fullPage: false }),
  );
}

async function installNativeShell(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, "Capacitor", {
      configurable: true,
      value: {
        isNativePlatform: () => true,
        getPlatform: () => "ios",
      },
    });
  });
}

async function installSuccessfulPlanRoute(page: Page): Promise<void> {
  await page.route("**/api/plans/generate", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stops: [
          { venueId: "venue-lrz4u2", venueName: "First Pub" },
          { venueId: "venue-1f5ygjb", venueName: "Second Pub" },
          { venueId: "venue-3h52h", venueName: "Third Pub" },
        ],
        inferredContext: {
          nightArea: "clapham",
          daypart: "evening",
          partyType: "friends",
          groupSize: 4,
          budget: "standard",
          budgetLimitPence: null,
          zeroProof: false,
          wetherspoonsPreferred: false,
          atmosphere: [],
          foodNeeds: [],
          accessibility: [],
          transportConstraints: [],
        },
        planningConfidence: {
          level: "high",
          score: 90,
          routeReady: true,
          missingEvidence: [],
          warnings: [],
          provenance: [{ kind: "night_area_review", label: "Reviewed Night Area" }],
        },
        budgetSummary: {
          currency: "GBP",
          limitPence: null,
          estimatedPerPersonPence: 1800,
          estimatedCrewPence: 7200,
          withinLimit: null,
          basis: "one-recorded-pint-per-stop",
        },
        routeTotals: {
          stopCount: 3,
          straightLineWalkingKm: 1.4,
          estimatedWalkingMinutes: 18,
          distanceBasis: "straight-line",
        },
        endingRecommendations: ["food", "get_home", "keep_going"].map((kind, index) => ({
          kind,
          label: ["Find food", "Get home", "Keep going"][index],
          reason: "Review the route ending before you commit.",
          preselected: kind === "get_home",
          requiresConfirmation: true,
          confidence: "high",
          warnings: [],
          options: [],
        })),
      }),
    });
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`first-run onboarding is composed at 390x844 in ${theme}`, async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await installNativeShell(page);
    await page.addInitScript((initialTheme) => {
      window.localStorage.setItem("pubmax-theme", initialTheme);
    }, theme);

    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(page.getByRole("heading", { name: "London is ready." })).toBeVisible();
    await expect(page.getByText("Clapham", { exact: true })).toBeVisible();
    await expect(page.getByText("Victoria", { exact: true })).toBeVisible();
    await expect(page.getByText("Piccadilly & Soho", { exact: true })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    await expect(page.getByRole("dialog", { name: "Stay in the loop" })).toHaveCount(0);
    await expectTouchTarget(page.getByRole("button", { name: "Use London" }));
    await expectTouchTarget(page.getByRole("button", { name: "Skip" }));
    await expectNoHorizontalOverflow(page);
    await saveShot(page, `london-${theme}-390`);

    await page.getByRole("button", { name: "Use London" }).click();
    await expect(page.getByRole("heading", { name: "Pick your Pub Pal." })).toBeVisible();
    const cat = page.getByRole("button", { name: /Black Cat/ });
    await expectTouchTarget(cat);
    await cat.click();
    await expect(cat).toHaveAttribute("aria-pressed", "true");
    const planAction = page.getByRole("button", { name: "Plan my night" });
    await expect(planAction).toBeEnabled();
    await expectTouchTarget(planAction);
    await expect(planAction).toBeInViewport({ ratio: 1 });
    await expectNoHorizontalOverflow(page);
    await saveShot(page, `companion-${theme}-390`);
  });
}

test("native first run hands one useful Plan to the contextual push ask", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installNativeShell(page);
  // Establish the app origin on an ordinary deep link before clearing state.
  // addInitScript runs for every document, so cleanup there would erase the
  // first-run marker on the second boot.
  await page.goto("/about");
  await page.evaluate(() => {
    window.localStorage.removeItem("pubmax:nativeFirstRun:routed:v1");
    window.localStorage.removeItem("pubmax:preferredCity:v1");
    window.localStorage.removeItem("pubmax:first-run-companion:v1");
    window.localStorage.removeItem("pubmax-tour-v1-done");
    window.localStorage.removeItem("pubmax:nativePush:enabled:v1");
    window.localStorage.removeItem("pubmax:nativePush:dismissedSeq:v1");
    window.localStorage.removeItem("pubmax:nativePush:actionSeq:v1");
    window.sessionStorage.clear();
  });
  await installSuccessfulPlanRoute(page);

  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(page.getByRole("dialog", { name: "Stay in the loop" })).toHaveCount(0);

  await page.getByRole("button", { name: "Use London" }).click();
  await page.getByRole("button", { name: /Pigeon/ }).click();
  await expect.poll(() => page.evaluate(() => window.localStorage.getItem("pubmax:first-run-companion:v1"))).toBe("pigeon");
  await page.getByRole("button", { name: "Plan my night" }).click();

  await expect(page).toHaveURL(/\/map\?plan=1$/);
  await expect(page.getByRole("heading", { name: "Describe the outing" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("dialog", { name: "Stay in the loop" })).toHaveCount(0);

  await page.getByRole("button", { name: "Make a plan" }).click();
  await expect(page.getByRole("dialog", { name: "Stay in the loop" })).toBeVisible();
  await expect(page.getByText("Get pinged when your crew votes or the get-in closes.")).toBeVisible();

  // The next native root boot is still the owner-locked /tonight cold start.
  await page.goto("/");
  await expect(page).toHaveURL(/\/tonight$/);
  await expect(page.getByRole("dialog", { name: "Stay in the loop" })).toHaveCount(0);
});

test("direct web onboarding redirects home without mutating onboarding state", async ({ page }) => {
  await page.goto("/about");
  await page.evaluate(() => {
    window.localStorage.setItem("pubmax:preferredCity:v1", "london");
    window.localStorage.setItem("pubmax:first-run-companion:v1", "fox");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  });

  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "London is ready." })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    city: window.localStorage.getItem("pubmax:preferredCity:v1"),
    companion: window.localStorage.getItem("pubmax:first-run-companion:v1"),
    tour: window.localStorage.getItem("pubmax-tour-v1-done"),
  }))).toEqual({ city: "london", companion: "fox", tour: "1" });
});

test("returning native direct onboarding redirects to Tonight without mutation", async ({ page }) => {
  await installNativeShell(page);
  await page.goto("/about");
  await page.evaluate(() => {
    window.localStorage.setItem("pubmax:nativeFirstRun:routed:v1", "1");
    window.localStorage.setItem("pubmax:preferredCity:v1", "london");
    window.localStorage.setItem("pubmax:first-run-companion:v1", "badger");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.clear();
  });

  await page.goto("/onboarding");
  await expect(page).toHaveURL(/\/tonight$/);
  await expect(page.getByRole("heading", { name: "London is ready." })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    city: window.localStorage.getItem("pubmax:preferredCity:v1"),
    companion: window.localStorage.getItem("pubmax:first-run-companion:v1"),
    tour: window.localStorage.getItem("pubmax-tour-v1-done"),
  }))).toEqual({ city: "london", companion: "badger", tour: "1" });
});

test("Skip releases onboarding budget for the next Plan but never prompts on reboot", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(VIEWPORT);
  await installNativeShell(page);
  await installSuccessfulPlanRoute(page);

  await page.goto("/");
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: "Skip" }).click();
  await expect(page).toHaveURL(/\/tonight$/);
  await expect.poll(() => page.evaluate(
    () => window.sessionStorage.getItem("pubmax:prompt-budget:v1"),
  )).toBeNull();

  await page.goto("/map?plan=1");
  await expect(page.getByRole("heading", { name: "Describe the outing" })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Make a plan" }).click();
  await expect(page.getByRole("dialog", { name: "Stay in the loop" })).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveURL(/\/tonight$/);
  await expect(page.getByRole("dialog", { name: "Stay in the loop" })).toHaveCount(0);
});
