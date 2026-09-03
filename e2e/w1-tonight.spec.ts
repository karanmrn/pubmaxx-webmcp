import { test, expect, type Page } from "@playwright/test";

// W1 design-QA shots — Tonight surface (lane + whats-on pin badges + venue
// sheet chips) at 390×844 and 1440×900, both themes. Not part of the default
// e2e gate; invoked explicitly:
//
//   PW_W1_SHOTS=1 npx playwright test e2e/w1-tonight.spec.ts
//
// The /api/whats-on response is route-mocked with venueId-joined rows so the
// badge/chip path is exercised deterministically (tonight's real quiz rows
// currently carry no resolved venueId — noted on the PR). The mock uses the
// same row contract the real spine serves.

test.skip(!process.env.PW_W1_SHOTS, "explicit W1 screenshot run only");

const DOCS_DIR = "docs/screenshots";
const ARNOS_ARMS_ID = "venue-xjf3n0";

function tonightRows() {
  // startsAt inside tonight's London window; observedAt in the past.
  const day = new Date().toISOString().slice(0, 10);
  return [
    {
      id: "w1-shot-quiz",
      venueId: ARNOS_ARMS_ID,
      placeName: "The Arnos Arms",
      kind: "quiz",
      startsAt: `${day}T19:30:00+01:00`,
      title: "Pub quiz — 7:30pm",
      priceGbp: 2,
      source: { label: "Question One", url: "https://questionone.com/" },
      observedAt: new Date(Date.now() - 3_600_000).toISOString(),
      confidence: "listed",
    },
    {
      id: "w1-shot-sport",
      venueId: ARNOS_ARMS_ID,
      placeName: "The Arnos Arms",
      kind: "sport",
      startsAt: `${day}T20:00:00+01:00`,
      title: "Screens live sport",
      source: { label: "FANZO", url: "https://www.fanzo.com/" },
      observedAt: new Date(Date.now() - 3_600_000).toISOString(),
      confidence: "derived",
    },
    {
      id: "w1-shot-music",
      venueId: "venue-0jly8w",
      placeName: "The Dublin Castle",
      kind: "music",
      startsAt: `${day}T20:30:00+01:00`,
      title: "Live band night",
      source: { label: "Venue site", url: "https://thedublincastle.com/" },
      observedAt: new Date(Date.now() - 3_600_000).toISOString(),
      confidence: "listed",
    },
  ];
}

async function seed(page: Page, theme: "light" | "dark"): Promise<void> {
  await page.addInitScript((t) => {
    window.localStorage.setItem("pubmax-theme", t);
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
  }, theme);
  await page.route("**/api/whats-on**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: tonightRows(), asOf: new Date().toISOString() }),
    });
  });
  await page.route("**/api/citymcp/things-to-do?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        window: "tonight",
        asOf: new Date().toISOString(),
        opportunities: [
          {
            title: "Late museum opening",
            kind: "exhibition",
            place: {
              id: "w1-shot-opportunity",
              name: "Somerset House",
              area: "Strand",
              location: { lat: 51.5111, lng: -0.1172 },
            },
            source: { label: "Venue site", url: "https://www.somersethouse.org.uk/" },
          },
        ],
      }),
    });
  });
}

const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "1440", width: 1440, height: 900 },
] as const;
const THEMES: Array<"light" | "dark"> = ["light", "dark"];

test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

// Dev-server cold compiles + SwiftShader tile paint are slow — give each shot room.
test.setTimeout(90_000);

for (const viewport of VIEWPORTS) {
  for (const theme of THEMES) {
    test.describe(`W1 tonight @ ${viewport.name} — ${theme}`, () => {
      test.use({ viewport: { width: viewport.width, height: viewport.height } });

      test(`map home with tonight lane + badges (${theme}, ${viewport.name})`, async ({ page }) => {
        await seed(page, theme);
        const response = await page.goto("/map");
        expect(response?.status()).toBe(200);
        await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 30000 });
        const chip = page.getByTestId("tonight-lane-chip");
        await chip.waitFor({ state: "visible", timeout: 15000 });
        const overlayToggle = page.getByTestId("tonight-overlay-toggle");
        await expect(overlayToggle).toBeVisible();
        await expect(overlayToggle).toHaveAttribute("aria-pressed", "true");
        await expect(
          page.getByRole("button", { name: "Dismiss tonight map pins" }),
        ).toBeVisible();
        await overlayToggle.click();
        await expect(overlayToggle).toHaveAttribute("aria-pressed", "false");
        await overlayToggle.click();
        await expect(overlayToggle).toHaveAttribute("aria-pressed", "true");
        if (viewport.width <= 640) {
          const tonightBox = await page.locator(".tonightLane--collapsed").boundingBox();
          const askBox = await page.locator(".mapConciergeAskPill").boundingBox();
          expect(tonightBox).not.toBeNull();
          expect(askBox).not.toBeNull();
          expect((tonightBox?.y ?? 0) + (tonightBox?.height ?? 0)).toBeLessThan(
            askBox?.y ?? 0,
          );
        }
        await chip.click();
        const lane = page.getByTestId("tonight-lane");
        await lane.waitFor({ state: "visible" });
        await expect(overlayToggle).toBeVisible();
        await page.waitForTimeout(2500); // let tiles + pins paint
        await page.screenshot({
          path: `${DOCS_DIR}/w1-tonight-lane-${theme}-${viewport.name}.png`,
        });
        await page.getByRole("button", { name: "Collapse on tonight" }).click();
        await expect(chip).toBeVisible();
        await expect(lane).toHaveCount(0);
        await chip.click();
        await lane.locator(".tonightLaneCardTap").first().click();
        await expect(page.locator(".appShell")).toHaveClass(/detail-open/);
        await expect(lane).toHaveCount(0);
      });

      test(`venue sheet with whats-on chips (${theme}, ${viewport.name})`, async ({ page }) => {
        await seed(page, theme);
        const response = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
        expect(response?.status()).toBe(200);
        await page.locator(".mapCanvasWrap").waitFor({ state: "visible", timeout: 30000 });
        // Chips can sit below the fold at the sheet's half snap on mobile —
        // "attached" proves the join rendered; the shot shows the sheet.
        await page
          .locator(".venueTonightChips")
          .waitFor({ state: "attached", timeout: 30000 });
        await page.waitForTimeout(1500);
        await page.screenshot({
          path: `${DOCS_DIR}/w1-tonight-sheet-${theme}-${viewport.name}.png`,
        });
      });
    });
  }
}
