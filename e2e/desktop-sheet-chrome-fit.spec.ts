import { test, expect, type Page } from "@playwright/test";

// D3 — an open venue drawer owns the right edge on desktop, so the map chrome
// has to live in the lane that is left of it.
//
// Two things went wrong at once on production, and both are measured here.
//
//   1. OVERLAP. mapDesktopRail.css hides the toolbar's Conditions chip only
//      while the drawer is closed, so opening the drawer put the chip BACK into
//      a `flex-wrap: nowrap` row that was already full. The search cell shrank,
//      its 260px child and 168px input kept their own floors, and the search
//      field painted straight through the drink select's box.
//   2. GHOST. The toolbar and the ambient banners are centred on the whole map
//      stage, so their right halves ran under the translucent sheet and read as
//      a second copy of the bar.
//
// The Conditions endpoint is mocked because the chip only renders when the
// weather has a verdict, and without it the row is not full enough to overlap.
// WebGL is never touched: every box read here is map chrome, not the canvas.

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

type ChromeGeometry = {
  drawerLeft: number;
  controls: { label: string; left: number; right: number; top: number; bottom: number }[];
  overlaps: string[];
  ghosts: string[];
};

async function readChromeGeometry(page: Page): Promise<ChromeGeometry> {
  return page.evaluate(() => {
    const drawer = document.querySelector<HTMLElement>(".mapDrawer.right.open")!;
    const drawerLeft = drawer.getBoundingClientRect().left;
    const bar = document.querySelector<HTMLElement>(".mapToolbar")!;

    const controls = Array.from(
      bar.querySelectorAll<HTMLElement>("input, select, button, a[href]"),
    )
      .filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .map((node) => {
        const box = node.getBoundingClientRect();
        return {
          label: (
            node.getAttribute("aria-label") ||
            node.textContent ||
            node.getAttribute("placeholder") ||
            node.tagName
          )
            .trim()
            .slice(0, 40),
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
        };
      });

    const overlaps: string[] = [];
    for (let i = 0; i < controls.length; i += 1) {
      for (let j = i + 1; j < controls.length; j += 1) {
        const a = controls[i];
        const b = controls[j];
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 0.5 && y > 0.5) {
          overlaps.push(
            `"${a.label}" [${Math.round(a.left)}-${Math.round(a.right)}] over ` +
              `"${b.label}" [${Math.round(b.left)}-${Math.round(b.right)}]`,
          );
        }
      }
    }

    // Nothing the map floats over its own surface may reach under the sheet.
    const ghosts: string[] = [];
    for (const selector of [".mapToolbar", ".cityStatusStack", ".citySuggestBanner"]) {
      const node = document.querySelector<HTMLElement>(selector);
      if (!node) continue;
      const box = node.getBoundingClientRect();
      if (box.width > 0 && box.right > drawerLeft + 1) {
        ghosts.push(`${selector} right ${Math.round(box.right)} > drawer ${Math.round(drawerLeft)}`);
      }
    }

    return { drawerLeft, controls, overlaps, ghosts };
  });
}

test.describe("desktop venue sheet keeps the map chrome out of its lane (D3)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });
    await page.route("**/api/tonight-conditions**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          summary: {
            dateLabel: "Thursday 23 Jul",
            weatherLabel: "21C, cloudy",
            drinkLine: "Warm and dry. Beer garden weather.",
            drinkSuggestion: "a cold lager or cider",
            venueClaim: null,
          },
        }),
      }),
    );
  });

  for (const { width, height } of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    test(`no control sits in another control's box at ${width}x${height}`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`, {
        waitUntil: "domcontentloaded",
      });
      expect(response?.status()).toBe(200);

      await expect(page.locator(".mapToolbar")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".mapDrawer.right.open")).toBeVisible({ timeout: 30_000 });

      await expect
        .poll(async () => (await readChromeGeometry(page)).controls.length, {
          timeout: 20_000,
        })
        .toBeGreaterThan(1);

      const geometry = await readChromeGeometry(page);
      expect(geometry.overlaps, geometry.overlaps.join(" | ")).toEqual([]);
      expect(geometry.ghosts, geometry.ghosts.join(" | ")).toEqual([]);

      // Every control the bar still shows stays inside the free map lane.
      for (const control of geometry.controls) {
        expect(
          control.right,
          `${control.label} reaches ${Math.round(control.right)}`,
        ).toBeLessThanOrEqual(geometry.drawerLeft + 1);
      }
    });
  }
});
