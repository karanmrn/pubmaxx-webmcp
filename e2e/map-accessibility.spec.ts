import { expect, test, type Locator, type Page } from "@playwright/test";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const ARNOS_ARMS_ID = "venue-xjf3n0";
const LOCKED_DARK_INK = [22, 18, 42] as const;
const LOCKED_CORAL = [255, 90, 95] as const;
const LOCKED_CORAL_BRIGHT = [255, 122, 85] as const;

function relativeLuminance([red, green, blue]: readonly number[]): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(
  foreground: readonly number[],
  background: readonly number[],
): number {
  const lighter = Math.max(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  const darker = Math.min(
    relativeLuminance(foreground),
    relativeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

function rgbChannels(cssColour: string): [number, number, number] {
  const channels = cssColour.match(/\d+(?:\.\d+)?/g)?.map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Could not parse computed colour: ${cssColour}`);
  }
  return [channels[0], channels[1], channels[2]];
}

async function expectLockedCoralContrast(control: Locator): Promise<void> {
  const computed = await control.evaluate((node) => {
    const style = getComputedStyle(node);
    return {
      colour: style.color,
      backgroundColour: style.backgroundColor,
      backgroundImage: style.backgroundImage,
    };
  });
  const foreground = rgbChannels(computed.colour);
  expect(foreground).toEqual(LOCKED_DARK_INK);
  expect(
    `${computed.backgroundColour} ${computed.backgroundImage}`,
  ).toContain("255, 90, 95");
  expect(
    Math.min(
      contrastRatio(foreground, LOCKED_CORAL),
      contrastRatio(foreground, LOCKED_CORAL_BRIGHT),
    ),
  ).toBeGreaterThanOrEqual(5.96);
}

/**
 * A theme-mixed surface computes as `color(srgb r g b)` with 0..1 channels,
 * never `rgb()`, so a bare digit scrape reads 0.99 as a channel of 1 and calls
 * a near-white panel black. The sticky bar's secondary sits on such a mix.
 */
function cssColourChannels(cssColour: string): [number, number, number] {
  const channels = cssColour.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!channels || channels.length < 3) {
    throw new Error(`Could not parse computed colour: ${cssColour}`);
  }
  const [red, green, blue] = channels;
  return cssColour.startsWith("color(")
    ? [red * 255, green * 255, blue * 255]
    : [red, green, blue];
}

/**
 * The sticky bar's SECONDARY action is not locked coral and must not be held to
 * the locked-coral ink: acceptance owns the one primary slot on a pub sheet, so
 * Add price reads as a ghost over the sheet's own panel. What it still owes is
 * ordinary readable contrast against the surface it actually renders on.
 */
async function expectReadableGhostContrast(control: Locator): Promise<void> {
  const computed = await control.evaluate((node) => {
    const style = getComputedStyle(node);
    let background = style.backgroundColor;
    let cursor: HTMLElement | null = node.parentElement;
    while (cursor && /^(transparent|rgba\(0, 0, 0, 0\))$/.test(background)) {
      background = getComputedStyle(cursor).backgroundColor;
      cursor = cursor.parentElement;
    }
    return { colour: style.color, background };
  });
  expect(
    contrastRatio(
      cssColourChannels(computed.colour),
      cssColourChannels(computed.background),
    ),
  ).toBeGreaterThanOrEqual(4.5);
}

function dismissFirstRunChrome(page: Page): Promise<void> {
  return page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
}

async function tabTo(page: Page, target: Locator, maxTabs = 80): Promise<void> {
  for (let index = 0; index < maxTabs; index += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

async function openVenueListFromLayers(page: Page): Promise<void> {
  const layers = page.getByRole("button", { name: /Map layers:/ });
  await expect(layers).toBeVisible({ timeout: 30_000 });
  await layers.click();
  const list = page.getByRole("button", { name: "List view" });
  await expect(list).toBeVisible();
  await list.click();
}

async function openVenueListWithKeyboard(page: Page): Promise<Locator> {
  const layers = page.getByRole("button", { name: /Map layers:/ });
  await expect(layers).toBeVisible({ timeout: 30_000 });
  await tabTo(page, layers);
  await page.keyboard.press("Enter");
  const list = page.getByRole("button", { name: "List view" });
  await expect(list).toBeVisible();
  await tabTo(page, list);
  await page.keyboard.press("Enter");

  const firstVenue = page.locator(".mapVenueListItem").first();
  await expect(firstVenue).toBeFocused();
  return firstVenue;
}

test.describe("map keyboard and screen-reader venue path", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await dismissFirstRunChrome(page);
  });

  test("keeps desktop MapLibre zoom controls at the 44px target floor", async ({
    page,
  }) => {
    await page.goto("/map");

    for (const name of ["Zoom in", "Zoom out"] as const) {
      const control = page.getByRole("button", { name });
      await expect(control).toBeVisible({ timeout: 30_000 });
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test("tabs into venue list and opens a named venue without canvas hit-testing", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/map");

    const firstVenue = await openVenueListWithKeyboard(page);
    const venueName = (await firstVenue.locator(".mapVenueListItemName").innerText()).trim();
    const venueId = await firstVenue.getAttribute("data-venue-id");
    const accessibleName = await firstVenue.getAttribute("aria-label");

    expect(venueName.length).toBeGreaterThan(0);
    expect(venueId).toBeTruthy();
    expect(accessibleName).toBeNull();
    await expect(firstVenue).toContainText(/Pub|Bar|Late food|Restaurant/);
    await expect(firstVenue).toContainText(/£|Price|no price/i);

    await page.keyboard.press("Enter");

    const drawer = page.locator(".mapDrawer.right.open");
    await expect(drawer).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sel"))
      .toBe(venueId);
  });

  test("updates open venue list after map movement and a venue-kind filter", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/map");
    await openVenueListWithKeyboard(page);

    const rows = page.locator(".mapVenueListItem");
    const beforeMove = await rows.count();
    const beforeMoveIds = await rows.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-venue-id")),
    );
    expect(beforeMove).toBeGreaterThan(0);
    expect(beforeMoveIds.every(Boolean)).toBe(true);

    const zoomIn = page.getByRole("button", { name: "Zoom in" });
    await zoomIn.click();
    await zoomIn.click();
    await zoomIn.click();

    await expect
      .poll(() => rows.count(), { timeout: 20_000 })
      .toBeLessThan(beforeMove);
    await expect
      .poll(
        () =>
          rows.evaluateAll((items) =>
            items.map((item) => item.getAttribute("data-venue-id")),
          ),
        { timeout: 20_000 },
      )
      .not.toEqual(beforeMoveIds);

    const beforeFilter = await rows.count();
    const bars = page.getByRole("button", { name: "Bars", exact: true });
    await expect(bars).toHaveAttribute("aria-pressed", "true");
    await bars.click();
    await expect(bars).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => rows.count()).toBeLessThan(beforeFilter);
  });

  test("drops old base-pub rows during a disjoint pan before the next shard fetch", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.goto("/map");

    const canvas = page.locator(".maplibregl-canvas").first();
    const wrap = page.locator(".mapCanvasWrap");
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await canvas.focus();
    for (let press = 0; press < 3; press += 1) {
      await page.keyboard.press("Equal");
      await page.waitForTimeout(1_400);
    }
    await expect
      .poll(
        async () => Number(await wrap.getAttribute("data-uk-base-count")),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);

    await openVenueListFromLayers(page);
    const baseRows = page.locator(
      '.mapVenueListItem[data-venue-id^="venue-uk-"]',
    );
    await expect.poll(() => baseRows.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    const oldIds = new Set(
      await baseRows.evaluateAll((items) =>
        items.map((item) => item.getAttribute("data-venue-id") ?? ""),
      ),
    );

    // One quick multi-screen drag leaves the next 180 ms shard request
    // pending. DOM membership must still follow camera projection immediately.
    for (let drag = 0; drag < 3; drag += 1) {
      await page.mouse.move(1_300, 500);
      await page.mouse.down();
      await page.mouse.move(400, 500);
      await page.mouse.up();
    }
    await page.waitForTimeout(50);

    const overlappingOldIds = await baseRows.evaluateAll(
      (items, ids) =>
        items
          .map((item) => item.getAttribute("data-venue-id") ?? "")
          .filter((id) => ids.includes(id)),
      [...oldIds],
    );
    expect(overlappingOldIds).toEqual([]);

    await expect.poll(() => baseRows.count(), { timeout: 20_000 }).toBeGreaterThan(0);
    await canvas.focus();
    await page.keyboard.press("Minus");
    await page.waitForTimeout(400);
    await page.keyboard.press("Minus");
    await page.waitForTimeout(400);
    await page.keyboard.press("Minus");
    // MapLibre has settled below the layer floor, but the base stream's 180 ms
    // clear may still be pending on a loaded runner. Poll rather than a tight
    // fixed-timeout assertion so runner variance can't race the clear.
    await expect.poll(() => baseRows.count(), { timeout: 5_000 }).toBe(0);
  });

  test("keeps desktop drawer focus inside and restores chosen venue on Escape", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.goto("/map");

    const chosenVenue = await openVenueListWithKeyboard(page);
    const chosenVenueId = await chosenVenue.getAttribute("data-venue-id");
    expect(chosenVenueId).toBeTruthy();
    const chosenVenueAfterClose = page.locator(
      `.mapVenueListItem[data-venue-id="${chosenVenueId}"]`,
    );
    await page.keyboard.press("Enter");

    const drawer = page.locator(".mapDrawer.right.open");
    const closeButton = drawer.getByRole("button", { name: /Close/ });
    await expect(drawer).toBeVisible();
    await expect(drawer).toHaveAttribute("role", "dialog");
    await expect(drawer).toHaveAttribute("aria-modal", "true");
    await expect(closeButton).toBeFocused();

    const lastFocusable = drawer.locator(
      'a[href]:visible, button:not([disabled]):visible, input:not([disabled]):visible, select:not([disabled]):visible, textarea:not([disabled]):visible, [tabindex]:not([tabindex="-1"]):visible',
    ).last();
    await lastFocusable.focus();
    await page.keyboard.press("Tab");
    await expect(closeButton).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(lastFocusable).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(chosenVenueAfterClose).toBeFocused();
  });

  test("returns Escape focus to a keyboard-selected search result", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/map");

    const search = page.locator("#mapSearchInput");
    await expect(search).toBeVisible({ timeout: 30_000 });
    await search.fill("Dolphin");
    const listbox = page.getByRole("listbox", { name: "Search suggestions" });
    // Search suggestions can include area/place entries. Select a concrete
    // venue option so the contract never depends on a mixed-result index.
    const highlightedVenue = listbox
      .locator('[role="option"][data-venue-id]')
      .nth(2);
    await expect(highlightedVenue).toBeVisible();
    const highlightedVenueId = await highlightedVenue.getAttribute("data-venue-id");
    expect(highlightedVenueId).toBeTruthy();
    const optionIndex = await listbox.getByRole("option").evaluateAll(
      (options, venueId) =>
        options.findIndex((option) => option.getAttribute("data-venue-id") === venueId),
      highlightedVenueId,
    );
    expect(optionIndex).toBeGreaterThanOrEqual(0);

    await search.focus();
    for (let index = 0; index <= optionIndex; index += 1) {
      await page.keyboard.press("ArrowDown");
    }
    await page.keyboard.press("Enter");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sel"))
      .toBe(highlightedVenueId);

    const drawer = page.locator(".mapDrawer.right.open");
    await expect(drawer).toBeVisible();
    await expect(
      drawer.getByRole("button", { name: /Close/ }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sel"))
      .toBeNull();
    await expect(search).toBeFocused();
  });

  test("keeps a rapid reselection open after close history settles", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.goto("/map");
    await page.evaluate(() => {
      const back = window.history.back.bind(window.history);
      window.history.back = () => {
        window.setTimeout(back, 250);
      };
    });

    const firstVenue = await openVenueListWithKeyboard(page);
    const firstVenueId = await firstVenue.getAttribute("data-venue-id");
    const secondVenueCandidate = page.locator(".mapVenueListItem").nth(1);
    const secondVenueId = await secondVenueCandidate.getAttribute("data-venue-id");
    expect(firstVenueId).toBeTruthy();
    expect(secondVenueId).toBeTruthy();
    expect(secondVenueId).not.toBe(firstVenueId);
    const secondVenue = page.locator(
      `.mapVenueListItem[data-venue-id="${secondVenueId}"]`,
    );

    await page.keyboard.press("Enter");
    const drawer = page.locator(".mapDrawer.right.open");
    await expect(drawer).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect(firstVenue).toBeFocused();
    await secondVenue.focus();
    await page.keyboard.press("Enter");

    await expect(drawer).toBeVisible();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("sel"))
      .toBe(secondVenueId);
    await page.waitForTimeout(350);
    await expect(drawer).toBeVisible();
    expect(new URL(page.url()).searchParams.get("sel")).toBe(secondVenueId);

    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => document.activeElement?.id ?? ""))
      .toBe(`map-venue-list-item-${secondVenueId}`);
  });

  test("keeps locked coral Plan CTA above 5.96:1 contrast", async ({
    page,
  }) => {
    await page.goto("/map");
    const planButton = page.getByRole("button", { name: "Plan an outing" }).first();
    await expect(planButton).toBeVisible({ timeout: 30_000 });

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((nextTheme) => {
        window.localStorage.setItem("pubmax-theme", nextTheme);
        document.documentElement.dataset.theme = nextTheme;
      }, theme);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expectLockedCoralContrast(planButton);
    }

    await page.setViewportSize(MOBILE);
    await page.goto(`/map?sel=${ARNOS_ARMS_ID}&mode=build`);
    const planStop = page.getByRole("button", { name: "Plan stop" });
    // Acceptance is permanent, so the pub sheet's ONE primary slot is now
    // "Make it Stop 1" and Add price is its ghost neighbour. The locked coral
    // guarantee follows the primary; it never followed the button's name.
    const acceptStop1 = page.getByRole("button", {
      name: "Make Arnos Arms Stop 1",
    });
    const addPrice = page.getByRole("button", {
      name: "Add a price at Arnos Arms",
    });
    await expect(planStop).toBeVisible();
    await expect(acceptStop1).toBeVisible();
    await expect(addPrice).toBeVisible();

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((nextTheme) => {
        window.localStorage.setItem("pubmax-theme", nextTheme);
        document.documentElement.dataset.theme = nextTheme;
      }, theme);
      await expectLockedCoralContrast(planStop);
      await expectLockedCoralContrast(acceptStop1);
      await expectReadableGhostContrast(addPrice);
    }
  });
});
