import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

test("mobile Describe the outing builds one grounded route without camera flicker", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    (window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }).__cameraIntents = [];
    window.addEventListener("pubmax:camera-intent", (event) => {
      const detail = (event as CustomEvent<{ kind: string; sequence: number }>).detail;
      (window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }).__cameraIntents?.push(detail);
    });
  });

  await page.goto("/map");
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Describe the outing" }).click();
  const planner = page.locator(".mapDrawer.left");
  await expect(planner).toHaveClass(/sheet-half/);
  await planner.getByLabel("Describe the outing").fill("Four of us in Barnes, under £24 each and quiet");
  const generateRequest = page.waitForRequest((request) => request.method() === "POST" && request.url().endsWith("/api/plans/generate"));
  await planner.getByRole("button", { name: "Make a plan" }).click();
  const submitted = (await generateRequest).postDataJSON() as { context: Record<string, unknown> };
  expect(submitted.context).not.toHaveProperty("nightArea");
  expect(submitted.context).not.toHaveProperty("atmosphere");
  // The confidence band is read off the surface's own `data-level`, not off the
  // words beside it: that copy has now been rewritten twice.
  await expect(planner.locator(".mobilePlannerConfidence")).toHaveAttribute("data-level", "low");
  await expect(planner.getByText("Rough guess, yours to change")).toBeVisible();
  await expect(planner.getByText("Some prices are missing. Check each stop before relying on the budget.")).toBeVisible();
  await expect(planner.locator(".mobilePlannerRouteTotal")).toContainText("min walk");
  await expect(planner.locator(".mobilePlannerEndings > div")).toHaveCount(3);
  await expect(planner.locator('.mobilePlannerEndings > div[data-recommended="true"]')).toHaveCount(1);

  const routeIntents = await page.evaluate(() => (
    (window as Window & { __cameraIntents?: Array<{ kind: string }> }).__cameraIntents ?? []
  ).filter((intent) => intent.kind === "route").length);
  expect(routeIntents).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "Describe the outing" })).toHaveCount(0);

  if (process.env.PUBMAX_GATE_Z_SHOTS) {
    const directory = "docs/screenshots/the-local-gate-z";
    await mkdir(directory, { recursive: true });
    await planner.getByRole("button", { name: "Expand sheet" }).click();
    await expect(planner).toHaveClass(/sheet-full/);
    await planner.locator(".mobilePlannerRouteTotal").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${directory}/activation-route-390x844-light.png` });
    const cameraIntents = await page.evaluate(() => (
      (window as Window & { __cameraIntents?: Array<{ kind: string; sequence: number }> }).__cameraIntents ?? []
    ));
    await writeFile(`${directory}/camera-intents.json`, `${JSON.stringify({ cameraIntents, routeIntents }, null, 2)}\n`);
  }
});
