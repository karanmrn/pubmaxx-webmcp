import { expect, type Page, test } from "@playwright/test";

/**
 * /plan opens on the describe-first question (components/plan/PlanDescribeFirst.tsx).
 * These tests need the full composer (including .planComposer__coverage, which
 * only renders once composerVisible is true) without first generating a route,
 * so this reaches it through the wizard's own "Describe instead" skip rather
 * than trusting the describe-first field's visibility, which would false-positive.
 */
async function openComposer(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Guide me instead" }).click();
  await page.getByRole("button", { name: "Describe instead" }).click();
  await expect(page.getByLabel("Describe the outing")).toBeVisible();
}

test("mobile planner explains planning confidence and evidence warnings", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto("/plan");
  expect(response?.status()).toBe(200);
  await openComposer(page);

  const coverage = page.locator(".planComposer__coverage");
  await expect(coverage).toBeVisible();
  await expect(coverage.locator("details")).not.toHaveAttribute("open", "");

  await coverage.getByText("Area coverage", { exact: true }).click();

  await expect(coverage).toContainText(
    "We only call an area crawl-ready when its prices are fresh and checked. The rest are yours to browse.",
  );
  await expect(coverage.getByRole("heading", { name: "Crawl-ready", exact: true })).toBeVisible();
  await expect(coverage.getByRole("heading", { name: "Not crawl-ready yet" })).toBeVisible();

  // Each row is found by the coverage state it OWNS (`data-coverage-status`,
  // written by PlanComposer), not by the badge wording beside it. The coverage
  // vocabulary has now been renamed twice and each rename broke this spec
  // silently, because a locator built on display copy tests the copy.
  const row = (status: string) => coverage.locator(`li[data-coverage-status="${status}"]`);

  await expect(coverage.getByText("Clapham", { exact: true })).toBeVisible();
  await expect(row("route_ready").first()).toContainText("Route-ready");
  await expect(coverage.getByText("Shoreditch", { exact: true })).toBeVisible();
  await expect(row("captured").first()).toContainText("Not all checked");
  await expect(row("discovered").first()).toContainText("Rough guess");
  await expect(row("paused").first()).toContainText("Gone stale");
  await expect(coverage).toContainText("Some checks complete. Missing opening hours and route feasibility + 2 more.");
  await expect(coverage.getByRole("link", { name: "Explore Shoreditch pubs on the map" })).toHaveAttribute(
    "href",
    "/map?q=Shoreditch",
  );
  await expect(coverage.getByText("Last checked 13 Jul 2026 · review through 1 Jan 2027.", { exact: true }).first()).toBeVisible();
  await expect(coverage.getByText("Not checked yet.", { exact: true }).first()).toBeVisible();
  await expect(coverage.getByText("Last checked 1 Jan 2026 · review expired 1 Jun 2026.", { exact: true })).toBeVisible();
});

test("mobile planner announces concierge progress while it finds a route", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  let releaseGenerate: () => void = () => {};
  const generatePaused = new Promise<void>((resolve) => {
    releaseGenerate = resolve;
  });
  await page.route("**/api/plans/generate", async (route) => {
    await generatePaused;
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "The planner is unavailable right now. Try again in a moment." }),
    });
  });

  const response = await page.goto("/plan");
  expect(response?.status()).toBe(200);
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await openComposer(page);

  const concierge = page.locator(".planComposer__concierge");
  const description = page.getByLabel("Describe the outing");
  await description.fill("A calm, affordable night near Clapham");
  await expect(description).toHaveValue("A calm, affordable night near Clapham");
  const submit = page.getByRole("button", { name: "Make a plan" });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(concierge).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "Planning…" })).toBeDisabled();
  await expect(page.locator("#plan-concierge-status")).toContainText(
    "checking confidence and picking stops we can back up",
  );
  releaseGenerate();
  await expect(page.locator(".planComposer__error")).toContainText("The planner is unavailable right now.");
  await expect(concierge).toHaveAttribute("aria-busy", "false");
});

test("mobile planner keeps the inferred Night Area context editable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await page.route("**/api/plans/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        inferredContext: {
          nightArea: "clapham",
          daypart: "evening",
          partyType: "friends",
          groupSize: 4,
          budget: "value",
          atmosphere: [],
          foodNeeds: [],
          accessibility: [],
          transportConstraints: [],
        },
        stops: [
          { venueId: "venue-1", venueName: "First Pub" },
          { venueId: "venue-2", venueName: "Second Pub" },
          { venueId: "venue-3", venueName: "Third Pub" },
        ],
      }),
    });
  });

  const response = await page.goto("/plan");
  expect(response?.status()).toBe(200);
  await openComposer(page);
  await page.getByLabel("Describe the outing").fill("A calm night in Clapham for four");
  await page.getByRole("button", { name: "Make a plan" }).click();

  await expect(page.getByRole("combobox", { name: "Area" })).toHaveValue("clapham");
  await page.getByRole("combobox", { name: "Area" }).selectOption("victoria");
  await page.getByRole("combobox", { name: "Time" }).selectOption("late_night");
  await page.getByRole("combobox", { name: "Group" }).selectOption("work");
  await page.getByRole("spinbutton", { name: "People" }).fill("6");
  await page.getByRole("combobox", { name: "Budget" }).selectOption("treat");

  await expect(page.getByRole("combobox", { name: "Area" })).toHaveValue("victoria");
  await expect(page.getByRole("combobox", { name: "Time" })).toHaveValue("late_night");
  await expect(page.getByRole("combobox", { name: "Group" })).toHaveValue("work");
  await expect(page.getByRole("spinbutton", { name: "People" })).toHaveValue("6");
  await expect(page.getByRole("combobox", { name: "Budget" })).toHaveValue("treat");
});
