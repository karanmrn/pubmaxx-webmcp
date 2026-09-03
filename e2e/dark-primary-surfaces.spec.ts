import { expect, test, type Locator, type Page } from "@playwright/test";

import { installDeterministicMapBasemap } from "./helpers/mapNetworkFixtures";

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const ARNOS_ARMS_ID = "venue-xjf3n0";
const LONG_QUERY = `The ${"Extremely Long User Entered Pub Identity ".repeat(14)}`;
const LONG_STATUS_HEADLINE =
  "Major disruption across central London. Several routes are diverted while emergency works continue, replacement services are limited, and travellers should allow extra time before setting off.";

type Rgba = [number, number, number, number];

type PaintState = {
  colour: string;
  opacity: number;
  backgroundColour: string;
  backgroundImage: string;
  ancestorBackgrounds: string[];
};

function parseColour(value: string): Rgba {
  const channels = value.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Could not parse colour: ${value}`);
  }

  if (value.startsWith("color(srgb")) {
    return [
      channels[0] * 255,
      channels[1] * 255,
      channels[2] * 255,
      channels[3] ?? 1,
    ];
  }

  return [channels[0], channels[1], channels[2], channels[3] ?? 1];
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  return [
    (foreground[0] * foreground[3] +
      background[0] * background[3] * (1 - foreground[3])) /
      alpha,
    (foreground[1] * foreground[3] +
      background[1] * background[3] * (1 - foreground[3])) /
      alpha,
    (foreground[2] * foreground[3] +
      background[2] * background[3] * (1 - foreground[3])) /
      alpha,
    alpha,
  ];
}

function relativeLuminance(colour: Rgba): number {
  const channels = colour.slice(0, 3).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: Rgba, background: Rgba): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (
    (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
    (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
  );
}

function gradientColours(backgroundImage: string): Rgba[] {
  return (
    backgroundImage.match(
      /(?:rgb|color\(srgb)[^(]*(?:\([^)]*\)|\([^)]*\))/g,
    ) ?? []
  ).map(parseColour);
}

function withAlpha(colour: Rgba, alpha: number): Rgba {
  return [colour[0], colour[1], colour[2], alpha];
}

function resolveBackdrop(ancestorBackgrounds: string[]): Rgba {
  return ancestorBackgrounds
    .map(parseColour)
    .reverse()
    .reduce<Rgba>(
      (background, foreground) => composite(foreground, background),
      [255, 255, 255, 1],
    );
}

async function readPaintState(
  colourLocator: Locator,
  surfaceLocator: Locator = colourLocator,
  pseudo?: "::placeholder",
  surfacePseudo?: "::before",
): Promise<PaintState> {
  const colour = await colourLocator.evaluate(
    (node, pseudoElement) => getComputedStyle(node, pseudoElement).color,
    pseudo,
  );
  return surfaceLocator.evaluate((node, input) => {
    const style = getComputedStyle(node, input.surfacePseudo);
    const ancestorBackgrounds: string[] = [];
    let ancestor = node.parentElement;
    while (ancestor) {
      ancestorBackgrounds.push(getComputedStyle(ancestor).backgroundColor);
      ancestor = ancestor.parentElement;
    }
    return {
      colour: input.foregroundColour,
      opacity: Number(style.opacity),
      backgroundColour: style.backgroundColor,
      backgroundImage: style.backgroundImage,
      ancestorBackgrounds,
    };
  }, { foregroundColour: colour, surfacePseudo });
}

function renderedContrastRatios(
  state: PaintState,
  background: "solid" | "gradient" = "solid",
): number[] {
  const foreground = parseColour(state.colour);
  const backdrop = resolveBackdrop(state.ancestorBackgrounds);
  const surfaceColour = parseColour(state.backgroundColour);
  const surfaceBase = composite(surfaceColour, backdrop);
  const paintedBackgrounds =
    background === "gradient"
      ? gradientColours(state.backgroundImage).map((stop) =>
          composite(stop, surfaceBase),
        )
      : [surfaceBase];

  return paintedBackgrounds.map((paintedBackground) => {
    const localForeground = composite(foreground, paintedBackground);
    const renderedForeground = composite(
      withAlpha(localForeground, state.opacity),
      backdrop,
    );
    const renderedBackground = composite(
      withAlpha(paintedBackground, state.opacity),
      backdrop,
    );
    return contrastRatio(renderedForeground, renderedBackground);
  });
}

async function expectRenderedTextContrast(
  colourLocator: Locator,
  options: {
    background?: "solid" | "gradient";
    minimum?: number;
    pseudo?: "::placeholder";
    surfaceLocator?: Locator;
    surfacePseudo?: "::before";
  } = {},
): Promise<number> {
  await expect(colourLocator).toBeVisible();
  const state = await readPaintState(
    colourLocator,
    options.surfaceLocator,
    options.pseudo,
    options.surfacePseudo,
  );
  const ratios = renderedContrastRatios(state, options.background);
  expect(ratios.length).toBeGreaterThan(0);
  const minimumRatio = Math.min(...ratios);
  expect(
    minimumRatio,
    `Rendered contrast for ${await colourLocator.evaluate((node) => node.className)} from ${JSON.stringify(state)}`,
  ).toBeGreaterThanOrEqual(options.minimum ?? 4.5);
  return minimumRatio;
}

async function prepareDarkRoutes(
  page: Page,
  viewport: { width: number; height: number },
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-theme", "dark");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await installDeterministicMapBasemap(page);
  await page.route("**/api/citymcp/status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-30T18:00:00.000Z",
        weather: null,
        tubeLines: [],
        signals: [],
      }),
    }),
  );
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [],
        asOf: "2026-07-30T18:00:00.000Z",
      }),
    }),
  );
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

for (const viewport of VIEWPORTS) {
  test(`dark production landing, map, and venue sheet meet state contracts at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await prepareDarkRoutes(page, viewport);
    const measurements: Record<string, number> = {};

    const landingResponse = await page.goto("/");
    expect(landingResponse?.status()).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    measurements.landingPrimary = await expectRenderedTextContrast(
      page.locator(".lpHero .lpButtonPrimary").first(),
    );
    const landingMaterial = await page.locator(".lpNav").evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        backgroundImage: style.backgroundImage,
        backdropFilter: style.backdropFilter,
      };
    });
    expect(landingMaterial.backgroundImage).toBe("none");
    expect(landingMaterial.backdropFilter).toBe("none");

    const cityInput = page.locator(".cityChooserSearchInput");
    await cityInput.scrollIntoViewIfNeeded();
    measurements.landingPlaceholder = await expectRenderedTextContrast(cityInput, {
      pseudo: "::placeholder",
      surfaceLocator: page.locator(".cityChooserSearchField"),
    });
    await expectNoHorizontalOverflow(page);

    const mapResponse = await page.goto("/map");
    expect(mapResponse?.status()).toBe(200);
    await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 45_000 });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");

    // The venue-type chips are read in the Filters sheet on a phone (design
    // judgement 2026-08-01, finding 2.3), so that is where their contrast is
    // measured.
    await page
      .locator(".mobileMapTopbar")
      .getByRole("button", { name: /^Filters/ })
      .click();
    const filtersSheet = page.locator(
      '.mobileSheetPortal[data-sheet-kind="filters"]',
    );
    await expect(filtersSheet).toBeVisible({ timeout: 45_000 });
    measurements.mapActiveChip = await expectRenderedTextContrast(
      filtersSheet.locator(".tonightArcChip.isOn").first(),
    );
    measurements.mapDisabledChip = await expectRenderedTextContrast(
      filtersSheet.locator('.tonightArcChip[aria-disabled="true"]'),
    );
    await page.keyboard.press("Escape");
    await expectNoHorizontalOverflow(page);

    const sheetResponse = await page.goto(`/map?sel=${ARNOS_ARMS_ID}`);
    expect(sheetResponse?.status()).toBe(200);
    const sheet = page.locator(".mobileSharedSheet.right");
    await expect(sheet).toBeVisible({ timeout: 45_000 });
    await expect(sheet.locator(".venueInspector")).toContainText("Arnos Arms", {
      timeout: 45_000,
    });
    measurements.sheetPricePlaque = await expectRenderedTextContrast(
      sheet.locator(".mobileVenuePeekSummary .priceBadge"),
    );

    const activeTab = sheet.locator(".venueTab.active");
    measurements.sheetActiveTab = await expectRenderedTextContrast(activeTab, {
      background: "gradient",
    });
    const sheetPrimary = sheet.locator(".venueSheetStickyPrimary");
    measurements.sheetPrimary = await expectRenderedTextContrast(
      sheetPrimary,
      { background: "gradient" },
    );

    await activeTab.focus();
    const focusState = await activeTab.evaluate((node) => {
      const style = getComputedStyle(node);
      return {
        outline: style.outlineStyle,
        outlineColour: style.outlineColor,
      };
    });
    expect(focusState.outline).not.toBe("none");
    const tabRailPaint = await readPaintState(sheet.locator(".venueTabs"));
    const tabRailBackground = composite(
      parseColour(tabRailPaint.backgroundColour),
      resolveBackdrop(tabRailPaint.ancestorBackgrounds),
    );
    measurements.sheetFocusOutline = contrastRatio(
      parseColour(focusState.outlineColour),
      tabRailBackground,
    );
    expect(measurements.sheetFocusOutline).toBeGreaterThanOrEqual(3);

    const inactiveTab = sheet.locator(".venueTab:not(.active)").first();
    await inactiveTab.hover();
    measurements.sheetHoverTab = await expectRenderedTextContrast(inactiveTab);

    await sheetPrimary.click();
    await expect(sheet.locator(".venuePriceSignInGate")).toBeVisible();
    await expect(sheet.locator(".venuePriceSubmit")).toHaveCount(0);
    await expectNoHorizontalOverflow(page);

    await testInfo.attach(`rendered-composited-contrast-${viewport.width}.json`, {
      body: Buffer.from(JSON.stringify(measurements, null, 2)),
      contentType: "application/json",
    });
  });
}

test("bounds user-entered search identity while keeping fixed qualifiers visible", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await prepareDarkRoutes(page, { width: 800, height: 800 });

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  const search = page.locator("#mapSearchInput");
  await expect(search).toBeVisible({ timeout: 45_000 });
  await search.fill(LONG_QUERY);

  const status = page.locator(".mapToolbarSearchStatus");
  await expect(status).toBeVisible();
  const query = status.locator(".mapToolbarSearchQuery");
  const qualifier = status.locator(".mapToolbarSearchQualifier");
  await expect(query).toHaveText(LONG_QUERY.trim());
  await expect(qualifier).toHaveText("’ with your current filters.");

  const queryGeometry = await query.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  expect(queryGeometry.scrollWidth).toBeGreaterThan(queryGeometry.clientWidth);
  expect(queryGeometry.overflow).toBe("hidden");
  expect(queryGeometry.textOverflow).toBe("ellipsis");
  expect(queryGeometry.whiteSpace).toBe("nowrap");

  const [statusBox, qualifierBox] = await Promise.all([
    status.boundingBox(),
    qualifier.boundingBox(),
  ]);
  expect(statusBox).not.toBeNull();
  expect(qualifierBox).not.toBeNull();
  expect(qualifierBox!.x).toBeGreaterThanOrEqual(statusBox!.x);
  expect(qualifierBox!.x + qualifierBox!.width).toBeLessThanOrEqual(
    statusBox!.x + statusBox!.width + 1,
  );
});

test("expanded city-status sheet follows wrapped headline geometry", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 800, height: 800 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-theme", "dark");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
  await installDeterministicMapBasemap(page);
  await page.route("**/api/whats-on**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ rows: [] }),
    }),
  );
  await page.route("**/api/citymcp/status**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-30T18:00:00.000Z",
        weather: null,
        tubeLines: [],
        signals: [
          {
            headline: LONG_STATUS_HEADLINE,
            detail: "Use another route where possible.",
            kind: "transport",
            severity: "major",
          },
        ],
      }),
    }),
  );

  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  const toggle = page.locator(".cityStatusBannerLink");
  await expect(toggle).toBeVisible({ timeout: 45_000 });
  await expect(toggle.locator(".cityStatusBannerCopy")).toHaveText(
    LONG_STATUS_HEADLINE,
  );
  await toggle.click();

  const banner = page.locator(".cityStatusBanner");
  const sheet = page.locator(".cityStatusSignalSheet");
  await expect(sheet).toBeVisible();
  await sheet.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const [bannerBox, sheetBox] = await Promise.all([
    banner.boundingBox(),
    sheet.boundingBox(),
  ]);
  expect(bannerBox).not.toBeNull();
  expect(sheetBox).not.toBeNull();
  expect(sheetBox!.y).toBeGreaterThanOrEqual(
    bannerBox!.y + bannerBox!.height + 8,
  );
  expect(sheetBox!.height).toBeLessThan(260);
  expect(sheetBox!.y + sheetBox!.height).toBeLessThanOrEqual(784);
});
