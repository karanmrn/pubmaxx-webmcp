import { expect, test, type Locator, type Page } from "@playwright/test";

const VIEWPORT = { width: 390, height: 844 };
const CHIP_LABELS = ["Beer", "Wine", "Cocktails", "Whisky", "Gin", "Rum", "Coffee", "Alcohol-free", "Soft drinks"];

test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function openFilters(page: Page): Promise<Locator> {
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  const filtersButton = page.getByRole("button", { name: /^Filters/ });
  await expect(filtersButton).toBeVisible({ timeout: 45_000 });
  await filtersButton.click();

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
  await expect(sheet).toBeVisible();
  return sheet;
}

async function pressedLabels(group: Locator): Promise<string[]> {
  return group.locator('button[aria-pressed="true"]').evaluateAll((buttons) =>
    buttons.map((button) => {
      const label = button.getAttribute("aria-label");
      return (label ?? button.textContent ?? "").replace(" (selected)", "").trim();
    }),
  );
}

test("390px drink chip labels contain category names only", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sheet = await openFilters(page);
  const shapeGroup = sheet.getByRole("group", { name: "Filter by drink shape" });

  await expect(shapeGroup.getByRole("button")).toHaveText(CHIP_LABELS);
});

test("390px Prices and places controls show one truthful selection", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sheet = await openFilters(page);
  const shapeGroup = sheet.getByRole("group", { name: "Filter by drink shape" });
  const mapViewGroup = sheet.getByRole("group", { name: "Map view" });

  await shapeGroup.getByRole("button", { name: "Gin", exact: true }).click();
  await expect(page).toHaveURL(/[?&]drink=gin(?:&|$)/);
  expect([
    ...(await pressedLabels(mapViewGroup)),
    ...(await pressedLabels(shapeGroup)),
  ]).toEqual(["Gin"]);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
]) {
  test(`${viewport.width}px Prices and places keeps the active map key for every lens`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const sheet = await openFilters(page);
    const mapViewGroup = sheet.getByRole("group", { name: "Map view" });
    const key = sheet.getByLabel("Map key");
    const heading = key.locator("#mapKeyPriceHeading");
    const rows = key.locator(".mapKeyPriceRows li");

    await heading.scrollIntoViewIfNeeded();
    await expect(key).toBeVisible();
    await expect(heading).toHaveText(
      "Pint prices and other venue price bands",
    );
    await expect(rows).toHaveText([
      "££5.50 or less; low for its venue type",
      "££Over £5.50, up to £7; middle for its venue type",
      "£££Over £7; high for its venue type",
      "?No pint price on the map",
    ]);

    const noAlcoholIndex = page.waitForResponse(
      (candidate) =>
        candidate.url().includes("/api/price-submit?lens=no-alcohol") &&
        candidate.status() === 200,
    );
    await mapViewGroup
      .getByRole("button", { name: "No alcohol", exact: true })
      .click();
    await noAlcoholIndex;
    await expect(heading).toHaveText("No-alcohol price bands");
    await expect(rows.last()).toHaveText(
      "?No alcohol-free or soft drink price on the map",
    );
    await expect(key.locator(".mapKeyPriceRows")).not.toContainText("pint");
    await expect(key.locator(".mapKeyPriceRows")).not.toContainText(
      "venue type",
    );

    await mapViewGroup
      .getByRole("button", { name: "Food", exact: true })
      .click();
    await expect(heading).toHaveText("Food view");
    await expect(rows).toHaveText([
      "?Food pins and clusters stay grey",
    ]);
  });
}

test("persisted favourite pint keeps All unselected after mobile and desktop reloads", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);
  await page.evaluate(() => {
    window.localStorage.setItem("pubmax:favoritePint:v1", "guinness");
  });

  await page.reload();
  const filtersButton = page.getByRole("button", { name: /^Filters/ });
  await expect(filtersButton).toBeVisible({ timeout: 45_000 });
  await filtersButton.click();
  const mobileSheet = page.locator(
    '.mobileSheetPortal[data-sheet-kind="filters"]',
  );
  await expect(mobileSheet).toBeVisible();
  await expect(
    mobileSheet.getByLabel("Favourite pint or beer brand"),
  ).toHaveValue("guinness");
  await expect(
    mobileSheet
      .getByRole("group", { name: "Map view" })
      .getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload();
  const desktopToolbar = page.locator(".mapToolbar");
  await expect(desktopToolbar).toBeVisible({ timeout: 45_000 });
  await expect(
    desktopToolbar.getByLabel("Favourite pint or beer brand"),
  ).toHaveValue("guinness");
  await expect(
    desktopToolbar
      .getByRole("group", { name: "Map view" })
      .getByRole("button", { name: "All", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
});

test("390px fare-zone rows agree through selection and reset", async ({ page }) => {
  test.setTimeout(90_000);
  const sheet = await openFilters(page);
  const zoneGroup = sheet.getByRole("group", { name: "Filter by fare zone" });
  const zonePriceGroup = sheet.getByRole("list", {
    name: "Median pint price by fare zone",
  });

  expect(await pressedLabels(zoneGroup)).toEqual(["All"]);
  expect(await pressedLabels(zonePriceGroup)).toEqual([]);

  await zoneGroup.getByRole("button", { name: "Zone 5", exact: true }).click();
  expect(await pressedLabels(zoneGroup)).toEqual(["Zone 5"]);
  const pressedPriceLabels = await pressedLabels(zonePriceGroup);
  expect(pressedPriceLabels).toHaveLength(1);
  expect(pressedPriceLabels[0]).toMatch(/^Zone 5£\d/);

  await zoneGroup.getByRole("button", { name: "All", exact: true }).click();
  expect(await pressedLabels(zoneGroup)).toEqual(["All"]);
  expect(await pressedLabels(zonePriceGroup)).toEqual([]);

  const zoneFivePrice = zonePriceGroup.locator('button[title^="Zone 5:"]');
  const zoneFiveChip = zoneGroup.getByRole("button", {
    name: "Zone 5",
    exact: true,
  });
  expect(
    await zoneFivePrice.evaluate((button) => getComputedStyle(button).borderColor),
  ).toBe(
    await zoneFiveChip.evaluate((button) => getComputedStyle(button).borderColor),
  );
});

test("390px zone figures state their calculation and assignment basis", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sheet = await openFilters(page);

  await expect(
    sheet.getByText(
      "Each zone figure is the median of the cheapest recorded pint price for pubs assigned to that zone.",
    ),
  ).toBeVisible();
  await expect(
    sheet.getByText(
      "Assignment uses each pub’s nearest station’s TfL fare zone. A figure appears after 10 priced pubs.",
    ),
  ).toBeVisible();
});

for (const width of [390, 320]) {
  test(`${width}px Tonight Arc controls are equal and whole`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 844 });
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);

    // On a phone these toggles live in the Filters sheet (design judgement
    // 2026-08-01, finding 2.3); they no longer float over the map.
    await expect(
      page.getByRole("group", { name: "Venue types" }),
    ).toHaveCount(0);
    await page
      .locator(".mobileMapTopbar")
      .getByRole("button", { name: /^Filters/ })
      .click();
    const filtersSheet = page.locator(
      '.mobileSheetPortal[data-sheet-kind="filters"]',
    );
    const arc = filtersSheet.getByRole("group", {
      name: "Venue types",
    });
    await expect(arc).toBeVisible({ timeout: 45_000 });
    const row = arc.locator(".tonightArcRow");
    const chips = row.locator(".tonightArcChip");
    await expect(chips).toHaveCount(5);

    const layout = await row.evaluate((element) => {
      const rowRect = element.getBoundingClientRect();
      const boxes = [...element.querySelectorAll<HTMLElement>(".tonightArcChip")].map(
        (chip) => {
          const rect = chip.getBoundingClientRect();
          return {
            label: chip.textContent?.trim() ?? "",
            top: rect.top,
            right: rect.right,
            height: rect.height,
          };
        },
      );
      return {
        boxes,
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        overflowX: getComputedStyle(element).overflowX,
        right: rowRect.right,
      };
    });

    expect(
      new Set(layout.boxes.map(({ height }) => Math.round(height))).size,
      "unavailable and available controls share one height",
    ).toBe(1);
    expect(layout.boxes[0]?.height).toBeGreaterThanOrEqual(44);
    // In a sheet the row is plain content: it wraps rather than scrolling, so
    // no control is ever parked off the edge of its container.
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
    for (const box of layout.boxes) {
      expect(box.right, `${box.label} stays inside the row`).toBeLessThanOrEqual(
        layout.right + 0.5,
      );
    }

    const pints = arc.getByRole("button", { name: "Pints", exact: true });
    const bars = arc.getByRole("button", { name: "Bars", exact: true });
    const clubs = arc.getByRole("button", {
      name: "Clubs are not mapped yet",
    });
    expect((await chips.allTextContents()).join("")).not.toContain("✓");
    await expect(clubs).toHaveText("Clubs");
    await expect(clubs).toHaveAttribute("aria-disabled", "true");

    const selectedStyle = await bars.evaluate((button) => ({
      borderWidth: getComputedStyle(button, "::before").borderTopWidth,
      fontWeight: Number(getComputedStyle(button).fontWeight),
    }));
    await bars.click();
    await expect(bars).toHaveAttribute("aria-pressed", "false");
    const unselectedStyle = await bars.evaluate((button) => ({
      borderWidth: getComputedStyle(button, "::before").borderTopWidth,
      fontWeight: Number(getComputedStyle(button).fontWeight),
    }));
    expect(selectedStyle.borderWidth).not.toBe(unselectedStyle.borderWidth);
    expect(selectedStyle.fontWeight).toBeGreaterThan(unselectedStyle.fontWeight);
    await expect(pints).toHaveAttribute("aria-pressed", "true");

    const pressedBeforeUnavailableActivation = await chips.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-pressed")),
    );
    await clubs.focus();
    await expect(clubs).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(clubs).toHaveAttribute("aria-expanded", "true");
    const reason = arc.getByRole("tooltip");
    await expect(reason).toBeVisible();
    await expect(reason).toHaveText("Clubs are not mapped yet");
    expect(
      await chips.evaluateAll((buttons) =>
        buttons.map((button) => button.getAttribute("aria-pressed")),
      ),
      "asking why Clubs is unavailable never changes a venue filter",
    ).toEqual(pressedBeforeUnavailableActivation);
  });
}

test("390px Tonight Arc hides Clubs reason outside the All lens", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  await page
    .locator(".mobileMapTopbar")
    .getByRole("button", { name: /^Filters/ })
    .click();
  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
  const arc = sheet.getByRole("group", { name: "Venue types" });
  await expect(arc).toBeVisible({ timeout: 45_000 });
  const clubs = arc.getByRole("button", {
    name: "Clubs are not mapped yet",
  });
  await clubs.focus();
  await page.keyboard.press("Enter");
  await expect(arc.getByRole("tooltip")).toHaveText(
    "Clubs are not mapped yet",
  );
  const mapView = sheet.getByRole("group", { name: "Map view" });

  await mapView.getByRole("button", { name: "Food", exact: true }).click();
  await expect(arc.getByText("Clubs", { exact: true })).toHaveCount(0);
  await expect(arc.getByRole("tooltip")).toHaveCount(0);

  await mapView
    .getByRole("button", { name: "No alcohol", exact: true })
    .click();
  await expect(arc.getByText("Clubs", { exact: true })).toHaveCount(0);
  await expect(arc.getByRole("tooltip")).toHaveCount(0);

  await mapView.getByRole("button", { name: "All", exact: true }).click();
  await expect(arc.getByRole("tooltip")).toHaveText(
    "Clubs are not mapped yet",
  );
});

for (const width of [390, 320]) {
  test(`${width}px map attribution opens fully above the plan action`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 844 });
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);

    const attribution = page.locator(".maplibregl-ctrl-attrib");
    await expect(attribution).toBeVisible({ timeout: 45_000 });
    await expect(attribution).toHaveClass(/maplibregl-compact/);
    const collapsedBox = await attribution.boundingBox();
    expect(collapsedBox).not.toBeNull();
    expect(collapsedBox!.width).toBeLessThanOrEqual(44);
    expect(collapsedBox!.height).toBeLessThanOrEqual(44);

    await attribution.locator(".maplibregl-ctrl-attrib-button").click();
    const fullCredit = attribution.locator(".maplibregl-ctrl-attrib-inner");
    await expect(fullCredit).toBeVisible();
    await expect(fullCredit).toContainText(
      "Pub data © OpenStreetMap contributors (ODbL)",
    );
    await expect(fullCredit).toContainText("OpenFreeMap");
    await expect(fullCredit).toContainText("OpenMapTiles");
    await expect(fullCredit).toContainText("Data from OpenStreetMap");

    const plan = page.getByRole("button", { name: "Describe the outing" });
    await expect(plan).toBeVisible();
    const geometry = await page.evaluate(() => {
      const attributionElement = document.querySelector<HTMLElement>(
        ".maplibregl-ctrl-attrib",
      );
      const inner = document.querySelector<HTMLElement>(
        ".maplibregl-ctrl-attrib-inner",
      );
      const planElement = document.querySelector<HTMLElement>(
        ".mobilePlanActivation",
      );
      if (!attributionElement || !inner || !planElement) return null;
      const attributionRect = attributionElement.getBoundingClientRect();
      const planRect = planElement.getBoundingClientRect();
      const style = getComputedStyle(inner);
      return {
        attribution: {
          left: attributionRect.left,
          right: attributionRect.right,
          bottom: attributionRect.bottom,
        },
        inner: {
          clientWidth: inner.clientWidth,
          scrollWidth: inner.scrollWidth,
          textOverflow: style.textOverflow,
          whiteSpace: style.whiteSpace,
          text: inner.textContent?.trim() ?? "",
        },
        plan: {
          top: planRect.top,
        },
      };
    });
    expect(geometry).not.toBeNull();
    expect(geometry!.attribution.left).toBeGreaterThanOrEqual(0);
    expect(geometry!.attribution.right).toBeLessThanOrEqual(width);
    expect(geometry!.attribution.bottom).toBeLessThanOrEqual(
      geometry!.plan.top,
    );
    expect(geometry!.inner.scrollWidth).toBeLessThanOrEqual(
      geometry!.inner.clientWidth + 1,
    );
    expect(geometry!.inner.textOverflow).not.toBe("ellipsis");
    expect(geometry!.inner.whiteSpace).toBe("normal");
    expect(geometry!.inner.text).not.toContain("…");
  });
}

for (const width of [1280, 1440]) {
  test(`${width}px OpenStreetMap credit owns its hit target and opens`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    const response = await page.goto("/map");
    expect(response?.status()).toBe(200);

    const attribution = page.locator(".maplibregl-ctrl-attrib");
    await expect(attribution).toBeVisible({ timeout: 45_000 });
    const fullCredit = attribution.locator(".maplibregl-ctrl-attrib-inner");
    if (!(await fullCredit.isVisible())) {
      await attribution.locator(".maplibregl-ctrl-attrib-button").click();
    }

    const openStreetMap = attribution
      .getByRole("link", { name: "OpenStreetMap", exact: true })
      .last();
    await expect(openStreetMap).toBeVisible();
    const box = await openStreetMap.boundingBox();
    expect(box).not.toBeNull();
    const centre = {
      x: box!.x + box!.width / 2,
      y: box!.y + box!.height / 2,
    };
    const hit = await openStreetMap.evaluate((credit, { x, y }) => {
      const element = document.elementFromPoint(x, y);
      return {
        isCredit: element === credit,
        tagName: element?.tagName.toLowerCase() ?? null,
        className:
          element && typeof element.className === "string"
            ? element.className
            : null,
        accessibleName:
          element?.getAttribute("aria-label") ??
          element?.textContent?.replace(/\s+/g, " ").trim() ??
          null,
      };
    }, centre);
    expect(
      hit.isCredit,
      `credit centre belongs to ${JSON.stringify(hit)}`,
    ).toBe(true);

    const opened = Promise.any([
      page.waitForEvent("popup", { timeout: 5_000 }).then((popup) => ({
        kind: "popup",
        url: popup.url(),
      })),
      page
        .waitForURL(/^https?:\/\/(?:www\.)?openstreetmap\.org\//, {
          timeout: 5_000,
        })
        .then(() => ({ kind: "navigation", url: page.url() })),
    ]);
    await page.mouse.click(centre.x, centre.y);
    const destination = await opened;
    expect(destination.kind).toMatch(/^(popup|navigation)$/);
    expect(destination.url).toMatch(
      /^https?:\/\/(?:www\.)?openstreetmap\.org\//,
    );
  });
}

test("390px drink glyphs keep the requested 22px box", async ({ page }) => {
  test.setTimeout(90_000);
  const sheet = await openFilters(page);
  const shapeGroup = sheet.getByRole("group", { name: "Filter by drink shape" });

  const capturePath = process.env.DRINK_CHIP_CAPTURE_PATH;
  if (capturePath) {
    await page.screenshot({ path: capturePath, fullPage: true });
  }

  const measurements = await shapeGroup.locator("svg").evaluateAll((glyphs) =>
    glyphs.map((glyph) => {
      const box = glyph.getBoundingClientRect();
      const marks = glyph.querySelectorAll(
        "path, line, rect, circle, ellipse, polyline, polygon",
      );
      return {
        label:
          glyph.closest("button")?.getAttribute("aria-label")?.replace(" (selected)", "") ??
          "",
        width: box.width,
        height: box.height,
        viewBox: glyph.getAttribute("viewBox"),
        strokeWidths: [...new Set(
          [...marks].map((mark) => getComputedStyle(mark).strokeWidth),
        )],
      };
    }),
  );

  console.log(`drink glyph measurements: ${JSON.stringify(measurements)}`);
  expect(measurements.map(({ label, width, height, viewBox }) => ({
    label,
    width,
    height,
    viewBox,
  }))).toEqual(
    CHIP_LABELS.map((label) => ({
      label,
      width: 22,
      height: 22,
      viewBox: "0 0 32 32",
    })),
  );
});
