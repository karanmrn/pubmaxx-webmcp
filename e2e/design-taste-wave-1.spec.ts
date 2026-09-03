import { expect, test, type Locator, type Page } from "@playwright/test";

async function setTheme(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript((nextTheme) => {
    window.localStorage.setItem("pubmax-theme", nextTheme);
  }, theme);
}

async function expectSentenceCase(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible();
  await expect(locator).toHaveCSS("text-transform", "none");
}

async function mockTonightMusic(page: Page): Promise<void> {
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [
          {
            id: "music-1",
            venueId: "venue-music",
            placeName: "The Blue Note",
            kind: "music",
            startsAt: "2026-08-06T21:00:00.000Z",
            title: "Live Jazz",
            source: { label: "Listings", url: "https://listings.example/jazz" },
            observedAt: "2026-08-06T12:00:00.000Z",
            confidence: "listed",
          },
        ],
        servedAt: "2026-08-06T18:00:00.000Z",
        sourceObservedAt: "2026-08-06T12:00:00.000Z",
        sourceFreshnessKind: "provider-observed",
        localityBasis: "london-default",
        asOf: "2026-08-06T12:00:00.000Z",
      }),
    }),
  );
}

test.describe("desktop taste wave 1", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`landing hero keeps its promise above the fold in ${theme} mode`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");

      const hero = page.locator("#hero-title");
      await expect(hero).toBeVisible();
      const metrics = await hero.evaluate((element) => {
        const styles = getComputedStyle(element);
        const fontSize = Number.parseFloat(styles.fontSize);
        const lineHeight = Number.parseFloat(styles.lineHeight);
        const height = element.getBoundingClientRect().height;
        return {
          fontSize,
          lineCount: Math.round(height / lineHeight),
        };
      });

      expect(metrics.fontSize).toBeGreaterThanOrEqual(56);
      expect(metrics.fontSize).toBeLessThanOrEqual(64);
      expect(metrics.lineCount).toBeLessThanOrEqual(2);
    });

    test(`semantic hues and sentence-case eyebrows hold in ${theme} mode`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/today");

      await expectSentenceCase(page.locator(".todayCardEyebrow").first());
      const semanticColours = await page.locator(".todayPintPrice").first().evaluate((price) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--accent-price-ink)";
        document.body.append(probe);
        const result = {
          price: getComputedStyle(price).color,
          expected: getComputedStyle(probe).color,
        };
        probe.remove();
        return result;
      });
      expect(semanticColours.price).toBe(semanticColours.expected);

      await mockTonightMusic(page);
      await page.goto("/tonight");
      const musicKind = page.locator('.tonightRowKind[data-kind="music"]').first();
      await expectSentenceCase(musicKind);
      const musicStyle = await musicKind.evaluate((element) => {
        const probe = document.createElement("span");
        probe.style.color = "var(--ink-soft)";
        document.body.append(probe);
        const result = {
          colour: getComputedStyle(element).color,
          expected: getComputedStyle(probe).color,
        };
        probe.remove();
        return result;
      });
      expect(musicStyle.colour).toBe(musicStyle.expected);

      await page.goto("/pint-index");
      await expectSentenceCase(page.locator(".pintIndexEyebrow").first());
    });

    test(`Stories and Discover keep coral for actions in ${theme} mode`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width: 1440, height: 900 });

      await page.route("**/api/pint-drops**", (route) =>
        route.fulfill({ status: 200, contentType: "application/json", body: '{"drops":[]}' }),
      );
      await page.goto("/feed");
      await page.getByRole("button", { name: "Tonight", exact: true }).click();
      const empty = page.locator(".feedEmpty");
      await expect(empty).toBeVisible();
      const emptyColours = await empty.evaluate((element) => {
        const action = element.querySelector<HTMLElement>(".feedEmptyPrimary");
        const eyebrow = element.querySelector<HTMLElement>(".emptyStateEyebrow");
        const stamp = element.querySelector<HTMLElement>(".emptyStateStamp");
        const accentProbe = document.createElement("span");
        accentProbe.style.backgroundColor = "var(--brass)";
        document.body.append(accentProbe);
        const style = getComputedStyle(element);
        const result = {
          action: action ? getComputedStyle(action).backgroundColor : "",
          accent: getComputedStyle(accentProbe).backgroundColor,
          eyebrow: eyebrow ? getComputedStyle(eyebrow).color : "",
          borderStyle: style.borderStyle,
          stampHidden: stamp?.getAttribute("aria-hidden") === "true",
        };
        accentProbe.remove();
        return result;
      });
      expect(emptyColours.action).toBe(emptyColours.accent);
      expect(emptyColours.eyebrow).not.toBe(emptyColours.accent);
      // Pressed paper: solid edge, never the dashed upload-zone look.
      expect(emptyColours.borderStyle).not.toContain("dashed");
      expect(emptyColours.stampHidden).toBe(true);

      await page.goto("/discover");
      const actions = page.locator(".editorialLink");
      await expect(actions).toHaveCount(7);
      const actionStyles = await actions.evaluateAll((links) =>
        links.map((link) => ({
          backgroundImage: getComputedStyle(link).backgroundImage,
          label: link.textContent?.trim() ?? "",
        })),
      );
      expect(actionStyles.every(({ backgroundImage }) => backgroundImage === "none")).toBe(true);
      expect(new Set(actionStyles.map(({ label }) => label)).size).toBe(actionStyles.length);
      await expectSentenceCase(page.locator(".nightAreaCoverage__eyebrow"));
      await expectSentenceCase(page.locator(".nightAreaCoverage__sectionLabel").first());
    });
  }
});
