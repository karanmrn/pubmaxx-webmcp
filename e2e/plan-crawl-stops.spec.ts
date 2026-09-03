import { expect, test, type Page } from "@playwright/test";

const SCENARIOS = [
  { stopCount: 5, width: 390, height: 844 },
  { stopCount: 6, width: 390, height: 844 },
  { stopCount: 5, width: 1440, height: 900 },
  { stopCount: 6, width: 1440, height: 900 },
] as const;

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function clearPlannerDrafts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.removeItem("pubmaxx:plan-route-draft:v1");
    window.localStorage.removeItem("pubmax:plan-intake:v1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.removeItem("pubmaxx:plan-draft:v1");
  });
}

for (const scenario of SCENARIOS) {
  test(`real ${scenario.stopCount}-stop crawl reaches every map stop at ${scenario.width}px`, async ({ page }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: scenario.width, height: scenario.height });
    await clearPlannerDrafts(page);
    const errors = watchPageErrors(page);

    const landing = await page.goto("/plan");
    expect(landing?.status()).toBe(200);

    const input = page.locator("#plan-describe-first-query");
    await expect(input).toBeVisible();
    await input.fill(`a ${scenario.stopCount} pub crawl in Camden`);

    const picker = page.getByRole("group", { name: "Number of pub stops" });
    const selectedStopButton = picker.getByRole("button", { name: String(scenario.stopCount), exact: true });
    if (await selectedStopButton.getAttribute("aria-pressed") !== "true") {
      await selectedStopButton.click();
    }

    const generation = page.waitForResponse((response) => (
      response.request().method() === "POST"
      && response.url().endsWith("/api/plans/generate")
    ));
    await page.getByRole("button", { name: "Make a plan", exact: true }).click();
    const generatedResponse = await generation;
    expect(generatedResponse.status()).toBe(200);
    const generated = await generatedResponse.json() as {
      stops?: Array<{ venueId?: string }>;
      inferredContext?: { stopCount?: number };
    };
    expect(generated.inferredContext?.stopCount).toBe(scenario.stopCount);
    const venueIds = (generated.stops ?? []).map((stop) => stop.venueId).filter(
      (venueId): venueId is string => typeof venueId === "string" && venueId.length > 0,
    );
    expect(new Set(venueIds).size).toBe(scenario.stopCount);

    const plannerStops = page.locator(".planComposer__stop");
    await expect(plannerStops).toHaveCount(scenario.stopCount, { timeout: 150_000 });
    await expect(page.getByText(`${scenario.stopCount} stops we can stand behind`)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`crawl-${scenario.stopCount}-${scenario.width}-planner.png`),
      fullPage: true,
    });

    const map = await page.goto(`/map?mode=build&pubs=${encodeURIComponent(venueIds.join(","))}`);
    expect(map?.status()).toBe(200);
    const routePanel = page.locator(".routePanel:visible").first();
    if (await routePanel.count() === 0) {
      const editRoute = page.getByRole("button", { name: /^Edit(?: active \d+-stop plan)?$/ }).first();
      await expect(editRoute).toBeVisible({ timeout: 120_000 });
      await editRoute.click();
    }
    await expect(routePanel).toBeVisible({ timeout: 120_000 });
    const routeStops = routePanel.locator("ol.routeList > li");
    await expect(routeStops).toHaveCount(scenario.stopCount, { timeout: 120_000 });
    await expect(routePanel.locator(".routeLeg")).toHaveCount(scenario.stopCount - 1);
    await expect(routePanel.locator(".routePaceTotal")).toContainText(/\d+\s*min\s*walk\s*total/);
    await expect(routePanel.locator(".routeMetrics")).toContainText(String(scenario.stopCount));

    for (let index = 0; index < scenario.stopCount; index += 1) {
      await expect(routeStops.nth(index).locator(".stopNumber")).toHaveText(String(index + 1));
      await expect(routeStops.nth(index)).toBeVisible();
    }
    await page.screenshot({
      path: testInfo.outputPath(`crawl-${scenario.stopCount}-${scenario.width}-map.png`),
      fullPage: false,
      timeout: 30_000,
    });

    expect(errors).toEqual([]);
  });
}
