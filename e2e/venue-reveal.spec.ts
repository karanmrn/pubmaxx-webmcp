import { expect, test, type Locator, type Page } from "@playwright/test";

type PaintedMapTapPoint = {
  kind: "pin" | "cluster";
  x: number;
  y: number;
};

async function paintedMarks(page: Page): Promise<PaintedMapTapPoint[]> {
  return page.evaluate(() =>
    (
      window as typeof window & {
        __pubmaxPaintedMapTapPoints?: () => PaintedMapTapPoint[];
      }
    ).__pubmaxPaintedMapTapPoints?.() ?? [],
  );
}

async function openVenueFromMap(
  page: Page,
): Promise<{ inspector: Locator }> {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    window.localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
  });
  await page.goto("/map");
  const inspector = page.locator(".venueInspector");
  await expect
    .poll(async () => (await paintedMarks(page)).length, {
      message: "the map paints a tappable pub mark",
      timeout: 60_000,
    })
    .toBeGreaterThan(0);

  const marks = await paintedMarks(page);
  let target = marks.find((mark) => mark.kind === "pin");
  for (let expansion = 0; !target && expansion < 5; expansion += 1) {
    const currentMarks = await paintedMarks(page);
    const viewport = page.viewportSize();
    const cluster = currentMarks.find(
      (mark) =>
        mark.kind === "cluster" &&
        (!viewport ||
          (mark.x >= 64 &&
            mark.x <= viewport.width - 64 &&
            mark.y >= 96 &&
            mark.y <= viewport.height - 96)),
    ) ?? currentMarks.find((mark) => mark.kind === "cluster");
    if (!cluster) break;
    await page.mouse.click(cluster.x, cluster.y);
    await page.waitForTimeout(800);
    await expect
      .poll(async () => (await paintedMarks(page)).length, {
        message: "opening a painted cluster keeps a live venue mark available",
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
    target = (await paintedMarks(page)).find((mark) => mark.kind === "pin");
  }
  if (!target) throw new Error("painted map marks did not yield a venue pin");
  await page.mouse.click(target.x, target.y);
  await inspector.waitFor({ state: "attached", timeout: 20_000 });
  return { inspector };
}

test.describe("venue reveal reduced motion", () => {
  test.describe.configure({ timeout: 120_000 });

  test("skips entrance classes under prefers-reduced-motion", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    await page.setViewportSize({ width: 390, height: 844 });
    const { inspector } = await openVenueFromMap(page);

    await page.waitForTimeout(600);
    await expect(inspector).toBeVisible();

    const revealClasses = await page.evaluate(() => {
      const inspector = document.querySelector(".venueInspector");
      if (!inspector) throw new Error("venue inspector missing");
      return {
        className: inspector.className,
        dataReveal: inspector.getAttribute("data-reveal"),
        bloomAnimation: getComputedStyle(
          document.querySelector(".venueRevealBloom") ?? document.body,
        ).animationName,
      };
    });

    expect(revealClasses.className).not.toMatch(/venueReveal/);
    expect(revealClasses.dataReveal).toBeNull();
    expect(revealClasses.bloomAnimation).not.toMatch(/venueRevealBloom/);
  });

  test("keeps the price figure outside reveal animation", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const { inspector } = await openVenueFromMap(page);
    await expect(inspector).toHaveClass(/venueReveal/, { timeout: 5_000 });
    const figure = inspector.locator(".priceBadge").first();
    await expect(figure).toBeVisible();
    await expect.poll(() => figure.evaluate((node) => getComputedStyle(node).animationName)).not.toMatch(
      /venueReveal/,
    );
  });
});
