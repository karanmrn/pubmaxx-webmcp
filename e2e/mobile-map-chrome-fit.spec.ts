import { expect, test, type Locator, type Page } from "@playwright/test";

// Rendered geometry for the phone map chrome at 320, 390 and 430.
//
// Design judgement 2026-08-01, finding 2.3 collapsed that chrome to ONE bar.
// What used to stack here — a Near me / Tonight / Filters rail and a
// full-width category band — is gone: the category toggles live in the Filters
// sheet, Near me is a round map-edge FAB, and Tonight keeps its other two
// homes. So the measurements below are the bar, the map-edge lane and the plan
// pill, and the budget they may not exceed.

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 320, height: 568 },
] as const;

type Rect = {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
};

type MeasuredRect = Rect & {
  clientWidth: number;
  scrollWidth: number;
};

type ShellLayout = {
  topbar: Rect;
  utility: Rect;
  locate: Rect;
  plan: Rect;
  barControls: Array<Rect & { label: string }>;
  chipRow: Rect;
  chipControls: Array<Rect & { label: string }>;
  areaLabel: MeasuredRect;
  areaCaret: Rect;
  tonightChip: Rect | null;
  tonightLabel: MeasuredRect | null;
  tonightCount: Rect | null;
  barClientWidth: number;
  barScrollWidth: number;
  chipClientWidth: number;
  chipScrollWidth: number;
  documentClientWidth: number;
  documentScrollWidth: number;
};

const PIN_SLA_ENFORCED = process.env.PUBMAX_PIN_SLA_ENFORCE === "1";

test.use({
  launchOptions: {
    args: PIN_SLA_ENFORCED
      ? []
      : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
  video:
    process.env.PUBMAX_MOBILE_MAP_EVIDENCE === "1"
      ? { mode: "on", size: { width: 390, height: 844 } }
      : "off",
});

test.setTimeout(120_000);

test("cold /map/london paints tappable pins within the pin-ready SLA", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // The first-visit arrival card is ANSWERED on purpose, for the same reason
    // consent is below: it is a full-width member of this very lane, and it
    // lifts the map-edge column, the plan pill and the OSM credit to their own
    // higher berths - the one state where the collisions these tests exist for
    // cannot happen.
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
  });

  const started = Date.now();
  const response = await page.goto("/map/london");
  expect(response?.status()).toBe(200);

  await page.waitForFunction(
    () =>
      (
        window as typeof window & {
          __pubmaxPaintedMapTapPoints?: () => Array<unknown>;
        }
      ).__pubmaxPaintedMapTapPoints?.().length > 0,
    // A wait, not a ceiling: the recorded envelope in perf/route-budgets.json
    // is 9.8-25.5s on this SwiftShader build, so a shorter wait here would
    // fail the very run whose figure it exists to record. The enforced ceiling
    // is the gated expect below and nothing else.
    { timeout: 60_000 },
  );
  const pinReadyMs = Date.now() - started;
  // The recorded figure in perf/route-budgets.json (routes./map.pinReady) is
  // re-measured from this annotation after a production-build run.
  test.info().annotations.push({ type: "pinReadyMs", description: `${pinReadyMs}` });
  // Software-rendered CI (SwiftShader) records the figure but does not enforce
  // the ceiling. PUBMAX_PIN_SLA_ENFORCE=1 drops the SwiftShader override for
  // this whole file as well as arming the ceiling, so the enforced run really
  // is the machine's own renderer.
  if (PIN_SLA_ENFORCED) {
    expect(pinReadyMs).toBeLessThanOrEqual(4_000);
  }
});

async function preparePhoneMap(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
  reducedMotion: "reduce" | "no-preference" = "reduce",
  path = "/map",
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // See the cold-paint test above: the arrival card is answered so these
    // measurements really are the default berths.
    window.localStorage.setItem("pubmax:map-first-visit-arrival:v1", "dismissed");
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition(success: PositionCallback) {
          success({
            coords: {
              latitude: 51.515,
              longitude: -0.09,
              accuracy: 10,
            },
          } as GeolocationPosition);
        },
      },
    });
  });
  await installPositiveTonightResponse(page);

  const response = await page.goto(path);
  expect(response?.status()).toBe(200);
  await expect(page.locator(".mobileMapTopbar")).toBeVisible({
    timeout: 45_000,
  });
}

async function openPhoneMap(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
  reducedMotion: "reduce" | "no-preference" = "reduce",
  path = "/map",
): Promise<void> {
  await preparePhoneMap(page, viewport, reducedMotion, path);
  // One bar: neither the old rail nor the map-floating category band.
  await expect(page.locator(".mobileMapRail")).toHaveCount(0);
  await expect(
    page.getByRole("group", { name: "Venue types" }),
  ).toHaveCount(0);
  await expect(page.locator(".mobileMapLocateFab")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Describe the outing" }),
  ).toBeVisible();
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
}

async function openLimitedPhoneMap(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
  reducedMotion: "reduce" | "no-preference" = "reduce",
  path: string,
): Promise<void> {
  await preparePhoneMap(page, viewport, reducedMotion, path);
  await expect(page.locator(".mobileMapTopbarLimited")).toBeVisible();
  await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 45_000 });
}

async function installPositiveTonightResponse(page: Page): Promise<void> {
  const observedAt = new Date().toISOString();
  const startsAt = new Date(Date.now() + 60 * 60 * 1_000).toISOString();
  await page.route("**/api/whats-on**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        rows: [
          {
            id: "mobile-map-chrome-tonight",
            venueId: "venue-xjf3n0",
            placeName: "The Arnos Arms",
            kind: "quiz",
            startsAt,
            title: "Pub quiz",
            source: { label: "Question One", url: "https://questionone.com/" },
            observedAt,
            confidence: "listed",
          },
        ],
        asOf: observedAt,
        sourceObservedAt: observedAt,
        sourceFreshnessKind: "dataset-generated",
      }),
    });
  });
}

async function shellLayout(page: Page): Promise<ShellLayout> {
  return page.evaluate(() => {
    const rectFor = (element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      return {
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        left: box.left,
        width: box.width,
        height: box.height,
      };
    };
    const rect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      return rectFor(element);
    };
    const measuredRect = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      return {
        ...rectFor(element),
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      };
    };
    const controls = (root: HTMLElement) =>
      [...root.querySelectorAll<HTMLElement>("a, button")].map((control) => ({
        ...rectFor(control),
        label:
          control.getAttribute("aria-label") ??
          control.textContent?.replace(/\s+/g, " ").trim() ??
          "",
      }));
    const bar = document.querySelector<HTMLElement>(".mobileMapTopbar");
    if (!bar) throw new Error("Missing the phone map bar");
    const chipRow = document.querySelector<HTMLElement>(".mobileMapChipRow");
    if (!chipRow) throw new Error("Missing the phone map chip row");

    return {
      topbar: rect(".mobileMapTopbar"),
      utility: rect(".mobileMapTflButton"),
      locate: rect(".mobileMapLocateFab"),
      plan: rect(".mobilePlanActivation"),
      barControls: controls(bar),
      chipRow: rectFor(chipRow),
      chipControls: controls(chipRow),
      areaLabel: measuredRect(
        ".citySwitcher--mobile .citySwitcherLabelFull",
      ),
      areaCaret: rect(".citySwitcher--mobile .citySwitcherCaret"),
      tonightChip: document.querySelector<HTMLElement>(".mobileMapTonightChip")
        ? rect(".mobileMapTonightChip")
        : null,
      tonightLabel: document.querySelector<HTMLElement>(
        ".mobileMapTonightChipLabel",
      )
        ? measuredRect(".mobileMapTonightChipLabel")
        : null,
      tonightCount: document.querySelector<HTMLElement>(
        ".mobileMapTonightChipCount",
      )
        ? rect(".mobileMapTonightChipCount")
        : null,
      barClientWidth: bar.clientWidth,
      barScrollWidth: bar.scrollWidth,
      chipClientWidth: chipRow.clientWidth,
      chipScrollWidth: chipRow.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
    };
  });
}

async function tapRenderedCentre(
  page: Page,
  control: Locator,
  viewportWidth: number,
  label: string,
  scrollIntoView = true,
  visibleWithin?: Locator,
): Promise<void> {
  if (scrollIntoView) {
    await control.scrollIntoViewIfNeeded();
  }
  const box = await control.boundingBox();
  expect(box, `${label} has a rendered box`).not.toBeNull();
  if (!box) return;
  expect(box.width, `${label} width`).toBeGreaterThanOrEqual(44);
  expect(box.height, `${label} height`).toBeGreaterThanOrEqual(44);
  expect(box.x, `${label} left`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${label} right`).toBeLessThanOrEqual(
    viewportWidth,
  );
  if (visibleWithin) {
    const containerBox = await visibleWithin.boundingBox();
    expect(containerBox, `${label} visible container has a box`).not.toBeNull();
    if (containerBox) {
      expect(box.x, `${label} clears its container left`).toBeGreaterThanOrEqual(
        containerBox.x,
      );
      expect(
        box.x + box.width,
        `${label} clears its container right`,
      ).toBeLessThanOrEqual(containerBox.x + containerBox.width);
    }
  }

  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const receivesTap = await control.evaluate(
    (button, point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      return hit === button || (hit !== null && button.contains(hit));
    },
    centre,
  );
  expect(receivesTap, `${label} owns its centre point`).toBe(true);
  if ((await control.getAttribute("aria-disabled")) === "true") {
    // The unavailable Clubs chip stays intentionally focusable and clickable
    // so it can reveal why it is unavailable. Playwright treats aria-disabled
    // as non-actionable, while the browser correctly dispatches this pointer.
    await page.mouse.click(centre.x, centre.y);
  } else {
    await control.click({
      position: { x: box.width / 2, y: box.height / 2 },
    });
  }
}

async function dismissSheet(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.locator(".mobileSheetPortal:visible")).toHaveCount(0);
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px phone chrome is one bar sharing the shell boundary`, async ({
    page,
  }) => {
    await openPhoneMap(page, viewport);
    const layout = await shellLayout(page);
    console.log(
      `mobile-map-chrome-layout ${viewport.width}px ${JSON.stringify(layout)}`,
    );

    for (const [name, box] of Object.entries({
      topbar: layout.topbar,
      plan: layout.plan,
    })) {
      expect(box.left, `${name} left is inside viewport`).toBeGreaterThanOrEqual(
        0,
      );
      expect(box.right, `${name} right is inside viewport`).toBeLessThanOrEqual(
        viewport.width,
      );
    }

    expect(
      layout.documentScrollWidth,
      "phone page does not gain horizontal scroll",
    ).toBeLessThanOrEqual(layout.documentClientWidth);
    expect(
      layout.barScrollWidth,
      "topbar does not scroll its controls horizontally",
    ).toBeLessThanOrEqual(layout.barClientWidth);
    expect(
      layout.chipScrollWidth,
      "chip row does not scroll its controls horizontally",
    ).toBeLessThanOrEqual(layout.chipClientWidth);
    expect(layout.chipRow.left, "chip row left is inside viewport").toBeGreaterThanOrEqual(
      0,
    );
    expect(
      layout.chipRow.right,
      "chip row right is inside viewport",
    ).toBeLessThanOrEqual(viewport.width);

    const shared = [layout.topbar, layout.plan];
    expect(
      new Set(shared.map(({ left }) => Math.round(left))).size,
      "stacked surfaces share one left edge",
    ).toBe(1);
    expect(
      new Set(shared.map(({ right }) => Math.round(right))).size,
      "stacked surfaces share one right edge",
    ).toBe(1);

    // The whole top chrome is the bar. Its budget is what one bar costs, not
    // what a three-row stack used to.
    expect(
      layout.topbar.bottom - layout.topbar.top,
      "phone top chrome height",
    ).toBeLessThanOrEqual(60);

    // The map-edge lane runs TfL at the top and Near me at the thumb, both
    // right-aligned and both clear of the bar.
    expect(layout.utility.top, "TfL clears the bar").toBeGreaterThan(
      layout.topbar.bottom,
    );
    expect(layout.locate.top, "Near me sits below TfL").toBeGreaterThan(
      layout.utility.bottom,
    );
    expect(layout.locate.bottom, "Near me clears the plan pill").toBeLessThanOrEqual(
      layout.plan.top,
    );
    expect(
      Math.round(layout.locate.right),
      "map-edge controls share one right edge",
    ).toBe(Math.round(layout.utility.right));

    // Near me's own size is published with the floating stack, so what it owes
    // is measured here rather than read back out of that declaration: the tap
    // floor, a square box its 50% radius can round, and a footprint the map
    // edge holds whole.
    expect(layout.locate.width, "Near me keeps the tap floor").toBeGreaterThanOrEqual(44);
    expect(layout.locate.height, "Near me keeps the tap floor").toBeGreaterThanOrEqual(44);
    expect(
      Math.round(layout.locate.width),
      "Near me is square, so its 50% radius reads as a circle",
    ).toBe(Math.round(layout.locate.height));
    expect(layout.locate.left, "Near me stays inside the viewport").toBeGreaterThan(0);
    expect(
      layout.locate.right,
      "Near me stays inside the viewport",
    ).toBeLessThanOrEqual(viewport.width);

    // Below 361px the wordmark leaves the bar on purpose, so the place name
    // keeps a readable column (components/mobile/mobileMapShell.css). It is the
    // one control the bar drops, and it must be dropped OUTRIGHT: a hidden
    // element reports a zero box at 0,0, which is indistinguishable from a
    // control shoved off the bar's left edge unless the spec says which it is.
    const wordmark = layout.barControls.find(
      (control) => control.label === "Open PUBMAXX landing page",
    );
    if (viewport.width <= 360) {
      expect(wordmark?.width ?? 0, "the wordmark leaves the narrow bar").toBe(0);
    } else {
      expect(wordmark?.width ?? 0, "the wordmark stays on the bar").toBeGreaterThan(0);
    }

    // The bar never scrolls: every control it renders is whole, none is cut.
    for (const control of layout.barControls.filter((one) => one.width > 0)) {
      expect(control.left, `${control.label} left is inside viewport`).toBeGreaterThanOrEqual(
        0,
      );
      expect(control.right, `${control.label} right is inside viewport`).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(control.left, `${control.label} left is visible`).toBeGreaterThanOrEqual(
        layout.topbar.left,
      );
      expect(control.right, `${control.label} right is visible`).toBeLessThanOrEqual(
        layout.topbar.right,
      );
      expect(control.height, `${control.label} tap height`).toBeGreaterThanOrEqual(
        44,
      );
    }

    // The area label and caret are both part of the map's location claim. A
    // zero box or an overflowing label would leave the claim visually broken
    // even when the bar's own scroll width stayed within its track.
    expect(layout.areaLabel.width, "map area label has a rendered box").toBeGreaterThan(0);
    expect(layout.areaLabel.height, "map area label has a rendered height").toBeGreaterThan(0);
    expect(
      layout.areaLabel.scrollWidth,
      "map area label is not clipped inside its track",
    ).toBeLessThanOrEqual(layout.areaLabel.clientWidth);
    expect(layout.areaLabel.left, "map area label left is inside topbar").toBeGreaterThanOrEqual(
      layout.topbar.left,
    );
    expect(layout.areaLabel.right, "map area label right is inside topbar").toBeLessThanOrEqual(
      layout.topbar.right,
    );
    expect(layout.areaCaret.width, "map area caret has a rendered box").toBeGreaterThan(0);
    expect(layout.areaCaret.height, "map area caret has a rendered height").toBeGreaterThan(0);
    expect(layout.areaCaret.left, "map area caret left is inside topbar").toBeGreaterThanOrEqual(
      layout.topbar.left,
    );
    expect(layout.areaCaret.right, "map area caret right is inside topbar").toBeLessThanOrEqual(
      layout.topbar.right,
    );

    for (const control of layout.chipControls.filter((one) => one.width > 0)) {
      expect(control.left, `${control.label} left is inside viewport`).toBeGreaterThanOrEqual(
        0,
      );
      expect(control.right, `${control.label} right is inside viewport`).toBeLessThanOrEqual(
        viewport.width,
      );
      expect(control.left, `${control.label} left is inside chip row`).toBeGreaterThanOrEqual(
        layout.chipRow.left,
      );
      expect(control.right, `${control.label} right is inside chip row`).toBeLessThanOrEqual(
        layout.chipRow.right,
      );
      expect(control.width, `${control.label} tap width`).toBeGreaterThanOrEqual(44);
      expect(control.height, `${control.label} tap height`).toBeGreaterThanOrEqual(44);
    }

    expect(
      layout.tonightChip,
      `${viewport.width}px map exposes its Tonight chip`,
    ).not.toBeNull();
    if (layout.tonightChip) {
      expect(
        layout.tonightChip.left,
        "Tonight chip left is inside chip row",
      ).toBeGreaterThanOrEqual(layout.chipRow.left);
      expect(
        layout.tonightChip.right,
        "Tonight chip right is inside chip row",
      ).toBeLessThanOrEqual(layout.chipRow.right);
      expect(
        layout.tonightChip.left,
        "Tonight chip left is inside viewport",
      ).toBeGreaterThanOrEqual(0);
      expect(
        layout.tonightChip.right,
        "Tonight chip right is inside viewport",
      ).toBeLessThanOrEqual(viewport.width);
      expect(layout.tonightChip.width, "Tonight chip tap width").toBeGreaterThanOrEqual(44);
      expect(layout.tonightChip.height, "Tonight chip tap height").toBeGreaterThanOrEqual(44);
      expect(layout.tonightLabel, "Tonight label is rendered").not.toBeNull();
      expect(layout.tonightCount, "Tonight count is rendered").not.toBeNull();
      if (layout.tonightLabel) {
        expect(layout.tonightLabel.width, "Tonight label has a rendered box").toBeGreaterThan(0);
        expect(layout.tonightLabel.height, "Tonight label has a rendered height").toBeGreaterThan(0);
        if (viewport.width === 390) {
          expect(
            layout.tonightLabel.scrollWidth,
            "Tonight label is not clipped inside its 390px chip",
          ).toBeLessThanOrEqual(layout.tonightLabel.clientWidth);
        }
        expect(layout.tonightLabel.left, "Tonight label left is inside chip").toBeGreaterThanOrEqual(
          layout.tonightChip.left,
        );
        expect(layout.tonightLabel.right, "Tonight label right is inside chip").toBeLessThanOrEqual(
          layout.tonightChip.right,
        );
      }
      if (layout.tonightCount) {
        expect(layout.tonightCount.width, "Tonight count has a rendered box").toBeGreaterThan(0);
        expect(layout.tonightCount.height, "Tonight count has a rendered height").toBeGreaterThan(0);
        expect(layout.tonightCount.left, "Tonight count left is inside chip").toBeGreaterThanOrEqual(
          layout.tonightChip.left,
        );
        expect(layout.tonightCount.right, "Tonight count right is inside chip").toBeLessThanOrEqual(
          layout.tonightChip.right,
        );
      }
    }
  });

  test(`${viewport.width}px phone map controls receive their own taps`, async ({
    page,
  }) => {
    await openPhoneMap(page, viewport);
    const topbar = page.locator(".mobileMapTopbar");
    // No location is granted in this run, so the chip names what the map is
    // looking at rather than claiming the reader.
    const area = topbar.getByRole("button", { name: /^Map area:/ });
    await tapRenderedCentre(page, area, viewport.width, "Area");
    const cityMenu = page.getByRole("listbox", { name: "Choose city map" });
    await expect(cityMenu).toBeVisible();
    const thisArea = cityMenu.getByRole("button", { name: "This area" });
    await tapRenderedCentre(page, thisArea, viewport.width, "This area");
    await expect(
      page.locator('.mobileSheetPortal[data-sheet-kind="choose-area"]:visible'),
    ).toHaveCount(1);
    await dismissSheet(page);

    // Near me before Search: MapEdgeControls unmount while search owns the
    // overlay, and Back from the layers sheet restores search when it was open.
    const nearMe = page.locator(".mobileMapLocateFab");
    await tapRenderedCentre(page, nearMe, viewport.width, "Near me", false);
    await expect(nearMe).toHaveAttribute("aria-label", /^Nearby \d+$/, {
      timeout: 20_000,
    });
    if (await page.locator(".mobileSheetPortal:visible").count()) {
      await dismissSheet(page);
    }

    const search = topbar.getByRole("button", { name: "Search the map" });
    await tapRenderedCentre(page, search, viewport.width, "Search");
    const searchField = page.getByRole("combobox", { name: "Search pubs" });
    await expect(searchField).toBeVisible();
    await search.click();
    await expect(searchField).toHaveCount(0);
    await expect(search).toHaveAttribute("aria-expanded", "false");

    const more = topbar.getByRole("button", { name: "More map controls" });
    await tapRenderedCentre(page, more, viewport.width, "More map controls");
    await expect(
      page.locator('.mobileSheetPortal[data-sheet-kind="layers"]:visible'),
    ).toHaveCount(1);
    await dismissSheet(page);

    const filters = topbar.getByRole("button", { name: /^Filters/ });
    await tapRenderedCentre(page, filters, viewport.width, "Filters");
    const sheet = page.locator(
      '.mobileSheetPortal[data-sheet-kind="filters"]:visible',
    );
    await expect(sheet).toHaveCount(1);

    // The venue-type toggles have exactly one home on a phone: this sheet.
    const arc = sheet.getByRole("group", { name: "Venue types" });
    await expect(arc).toHaveCount(1);
    const arcButtons = arc.locator(".tonightArcChip");
    expect(await arcButtons.count()).toBe(5);
    for (let index = 0; index < (await arcButtons.count()); index += 1) {
      const button = arcButtons.nth(index);
      const label =
        (await button.getAttribute("aria-label")) ??
        (await button.textContent())?.trim() ??
        `Tonight Arc control ${index + 1}`;
      const disabled = (await button.getAttribute("aria-disabled")) === "true";
      const pressedBefore = await button.getAttribute("aria-pressed");
      await tapRenderedCentre(page, button, viewport.width, label);
      if (disabled) {
        await expect(button).toHaveAttribute("aria-expanded", "true");
        await tapRenderedCentre(page, button, viewport.width, `Close ${label}`);
        await expect(button).toHaveAttribute("aria-expanded", "false");
      } else {
        await expect(button).toHaveAttribute(
          "aria-pressed",
          pressedBefore === "true" ? "false" : "true",
        );
      }
    }

    const wine = sheet
      .getByRole("group", { name: "Filter by drink shape" })
      .getByRole("button", { name: "Wine", exact: true });
    await tapRenderedCentre(page, wine, viewport.width, "Wine filter");
    await expect(
      sheet
        .getByRole("group", { name: "Filter by drink shape" })
        .getByRole("button", { name: "Wine (selected)" }),
    ).toHaveAttribute("aria-pressed", "true");
  });
}

test("320px keeps the whole place name and the map-edge lane tappable", async ({
  page,
}) => {
  const viewport = VIEWPORTS[2];
  await openPhoneMap(page, viewport, "reduce", "/map?drink=wine");

  const topbar = page.locator(".mobileMapTopbar");
  // The wordmark yields its column at 360px and below, so the place name is
  // read whole rather than cut (design judgement 2026-08-01, finding 2.3).
  await expect(topbar.locator(".mobileMapBrand")).toBeHidden();
  // The place name is the city switcher's own full label: the phone rules keep
  // .citySwitcherLabelFull visible and hide the short code, so this is the text
  // a 320px reader actually sees.
  const areaName = topbar.locator(".citySwitcher--mobile .citySwitcherLabelFull");
  const areaFit = await areaName.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(
    areaFit.scrollWidth,
    "the place name is not truncated at 320px",
  ).toBeLessThanOrEqual(areaFit.clientWidth);

  const filters = topbar.getByRole("button", {
    name: "Filters: drinks active",
  });
  await expect(filters.locator(".mobileMapTopbarBadge")).toHaveText("1");
  await tapRenderedCentre(
    page,
    filters,
    viewport.width,
    "Active Filters",
    false,
    topbar,
  );
  await expect(
    page.locator('.mobileSheetPortal[data-sheet-kind="filters"]:visible'),
  ).toHaveCount(1);
  await dismissSheet(page);

  const nearMe = page.getByRole("button", { name: "Near me" });
  await tapRenderedCentre(page, nearMe, viewport.width, "Near me", false);
  await expect(page.getByRole("button", { name: /^Nearby \d+$/ })).toBeVisible({
    timeout: 20_000,
  });
  if (await page.locator(".mobileSheetPortal:visible").count()) {
    await dismissSheet(page);
  }

  const safeAreaRight = 32;
  const chromium = await page.context().newCDPSession(page);
  await chromium.send("Emulation.setSafeAreaInsetsOverride", {
    insets: { top: 0, right: safeAreaRight, bottom: 0, left: 0 },
  });
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
  });

  const safeAreaLayout = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const rect = element.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    };
    return {
      tfl: box(".mobileMapTflButton"),
      locate: box(".mobileMapLocateFab"),
    };
  });
  expect(safeAreaLayout.tfl.right).toBe(viewport.width - safeAreaRight);
  expect(
    Math.round(safeAreaLayout.locate.right),
    "both map-edge controls honour the safe-area inset",
  ).toBe(viewport.width - safeAreaRight);
});

test("320px limited map keeps its topbar and city menu inside the viewport", async ({
  page,
}) => {
  const viewport = VIEWPORTS[2];
  await openLimitedPhoneMap(
    page,
    viewport,
    "reduce",
    "/map?place=Sheffield&lat=53.3800941&lng=-1.4789213",
  );

  const topbar = page.locator(".mobileMapTopbarLimited");
  await expect(topbar).toBeVisible();
  await expect(topbar.locator(".mobileMapBrand")).toBeHidden();

  const topbarFit = await topbar.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    };
  });
  expect(topbarFit.left).toBeGreaterThanOrEqual(0);
  expect(topbarFit.right).toBeLessThanOrEqual(viewport.width);
  expect(topbarFit.scrollWidth).toBeLessThanOrEqual(topbarFit.clientWidth);

  const area = topbar.getByRole("button", { name: /^Map area:/ });
  await tapRenderedCentre(page, area, viewport.width, "Limited map area");
  const cityMenu = page.getByRole("listbox", { name: "Choose city map" });
  await expect(cityMenu).toBeVisible();
  const menuBox = await cityMenu.evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right };
  });
  expect(menuBox.left).toBeGreaterThanOrEqual(0);
  expect(menuBox.right).toBeLessThanOrEqual(viewport.width);
});

test("390px recorded map journey reaches Filters and a painted pin", async ({
  page,
}) => {
  const viewport = VIEWPORTS[0];
  await openPhoneMap(page, viewport, "no-preference");
  await page.waitForTimeout(500);

  const filters = page
    .locator(".mobileMapTopbar")
    .getByRole("button", { name: /^Filters/ });
  await tapRenderedCentre(page, filters, viewport.width, "Filters");
  const filtersSheet = page.locator(
    '.mobileSheetPortal[data-sheet-kind="filters"]:visible',
  );
  await expect(filtersSheet).toHaveCount(1);

  const wine = filtersSheet
    .getByRole("group", { name: "Filter by drink shape" })
    .getByRole("button", { name: "Wine", exact: true });
  await tapRenderedCentre(page, wine, viewport.width, "Wine filter");
  await expect(
    filtersSheet.getByRole("button", { name: "Wine (selected)" }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.waitForTimeout(500);

  // The sheet's way out is SurfaceNav's Home control now
  // (components/ui/surface-nav.tsx); the bespoke close button it replaced is
  // gone, and so is the class this used to tap.
  const closeFilters = filtersSheet.locator(".surfaceNavHome");
  await tapRenderedCentre(
    page,
    closeFilters,
    viewport.width,
    "Close Filters",
  );
  await expect(filtersSheet).toHaveCount(0);
  await page.waitForTimeout(500);

  const venueSheet = page.locator(
    '.mobileSheetPortal[data-sheet-kind="venue"]:visible',
  );
  await expect(page.locator(".maplibregl-canvas")).toBeVisible();

  // This used to guess where a pin was: a 20px grid of taps across the canvas,
  // hunting for one that opened a sheet, abandoned after a fixed number of
  // passes. Under parallel workers the map had not painted its pins before the
  // scan ran out, so a timing loss read as a product defect. Ask the map
  // instead. `paintedPinProbe.ts` answers with the viewport point of every pub
  // mark the map is drawing right now, already checked to survive collision,
  // to re-query to the same mark, and to carry no chrome on top of it.
  const paintedMarks = () =>
    page.evaluate(
      () =>
        (
          window as typeof window & {
            __pubmaxPaintedMapTapPoints?: () => Array<{
              kind: "pin" | "cluster";
              id: string;
              x: number;
              y: number;
            }>;
          }
        ).__pubmaxPaintedMapTapPoints?.() ?? [],
    );

  await expect
    .poll(async () => (await paintedMarks()).length, {
      message: "the phone map paints a pub mark the reader can tap",
      timeout: 60_000,
    })
    .toBeGreaterThan(0);

  // The map opens with the pubs gathered, so the walk in is the reader's own:
  // open a cluster until it hands over pins, then tap a pin. Every tap lands
  // on a mark the map is painting at that moment, so nothing here is a guess -
  // the loop only repeats because one cluster can open onto another.
  let tappedPinId = "";
  await expect
    .poll(
      async () => {
        if (await venueSheet.count()) return true;
        const marks = await paintedMarks();
        const pin = marks.find((mark) => mark.kind === "pin");
        const target = pin ?? marks[0];
        if (!target) return false;
        if (pin) tappedPinId = pin.id;
        await page.mouse.click(target.x, target.y);
        // A cluster answers with a camera move; a pin answers with the sheet.
        await page.waitForTimeout(pin ? 400 : 900);
        return (await venueSheet.count()) > 0;
      },
      { message: "a painted map pin receives its own tap", timeout: 90_000 },
    )
    .toBe(true);
  await expect(venueSheet).toHaveCount(1);
  // The sheet belongs to the pin that was tapped, not to some other selection:
  // an in-Map selection writes its venue to `?sel=` (lib/mapSelectionHistory).
  await expect
    .poll(() => new URL(page.url()).searchParams.get("sel"), {
      message: "the sheet belongs to the pin that was tapped",
    })
    .toBe(tappedPinId);
  await page.waitForTimeout(1_200);
});

// The right-edge floating stack: one column, never an overlap.
//
// The create action, the Pub Pal pill and the map-edge locate FAB are three
// independently-positioned fixed controls in the same corner. The create action
// arrived last and, at the tab bar's own layer with the tab bar's own offset, it
// painted over roughly 50px of the pill on /map and /plan. What holds them apart
// is a shared set of custom properties, so the proof has to be the RENDERED
// geometry rather than the declarations.
const FLOATING_RIGHT_EDGE = [
  { name: "create action", selector: ".createFab" },
  { name: "Pub Pal pill", selector: ".palSummon" },
  { name: "plan activation", selector: ".mobilePlanActivation" },
  { name: "locate FAB", selector: ".mobileMapLocateFab" },
  { name: "TfL control", selector: ".mobileMapTflButton" },
] as const;

// Members that MUST be measured, or the sweep would pass by shrinking rather
// than by clearing: the plan pill is what the default berth used to land on, and
// the locate FAB is what the Pub Pal berth used to land on.
const REQUIRED_MEMBERS = [
  "create action",
  "Pub Pal pill",
  "plan activation",
  "locate FAB",
] as const;

function overlaps(a: Rect, b: Rect): boolean {
  return (
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
  );
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px right-edge floating controls never overlap`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      // Consent is ANSWERED on purpose. Leaving it undecided renders
      // AnalyticsConsentPrompt, which lifts the map-edge column to its own
      // higher berth - the one berth where the collision this test exists for
      // cannot happen - and whether it renders at all depends on a prompt
      // budget, so an undecided seed is nondeterministic as well as blind.
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      window.localStorage.setItem("pubmax:e2e-defer-shell:v1", "now");
      const now = "2026-01-01T00:00:00.000Z";
      window.localStorage.setItem(
        "pubmax_pub_pal_v1",
        JSON.stringify({
          id: "pal-e2e",
          ownerId: "owner-e2e",
          name: "Ada",
          adultAttestedAt: now,
          appearance: {},
          personality: {},
          voice: {},
          muted: false,
          hidden: false,
          proposalPreferences: {},
          masteryPoints: 0,
          createdAt: now,
          updatedAt: now,
        }),
      );
    });
    await openPhoneMap(page, viewport);
    // The pill is stored-pal gated and mounts after a microtask.
    await expect(page.locator(".palSummon")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".createFab")).toBeVisible();

    const boxes: Array<{ name: string; rect: Rect }> = [];
    for (const control of FLOATING_RIGHT_EDGE) {
      const locator = page.locator(control.selector);
      if ((await locator.count()) === 0) continue;
      if (!(await locator.first().isVisible())) continue;
      const rect = await locator.first().boundingBox();
      if (!rect) continue;
      boxes.push({
        name: control.name,
        rect: {
          top: rect.y,
          right: rect.x + rect.width,
          bottom: rect.y + rect.height,
          left: rect.x,
          width: rect.width,
          height: rect.height,
        },
      });
    }
    expect(boxes.map((box) => box.name)).toEqual(
      expect.arrayContaining([...REQUIRED_MEMBERS]),
    );
    await expect(page.locator(".analyticsConsentPrompt")).toHaveCount(0);
    // Same reason: the arrival card would lift every member measured above.
    await expect(page.locator(".mapArrivalCard")).toHaveCount(0);

    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        expect(
          overlaps(boxes[i]!.rect, boxes[j]!.rect),
          `${boxes[i]!.name} overlaps ${boxes[j]!.name}: ${JSON.stringify([boxes[i]!.rect, boxes[j]!.rect])}`,
        ).toBe(false);
      }
    }
    // The create action is the member this stack was built for, so its own
    // clearance is asserted separately and is never waived.
    const createAction = boxes.find((box) => box.name === "create action")!;
    for (const box of boxes) {
      if (box === createAction) continue;
      expect(
        overlaps(createAction.rect, box.rect),
        `create action overlaps ${box.name}: ${JSON.stringify([createAction.rect, box.rect])}`,
      ).toBe(false);
    }

    // And every one of them stays clear of the tab bar it parks above.
    const bar = await page.locator(".mobileTabBar").boundingBox();
    expect(bar).not.toBeNull();
    for (const box of boxes) {
      expect(
        box.rect.bottom,
        `${box.name} sits above the tab bar`,
      ).toBeLessThanOrEqual(Math.round(bar!.y) + 1);
    }

    // The plan pill's own published height and berth, measured rather than
    // read off a declaration (mobileNav.css --plan-activation-h / -bottom).
    const plan = boxes.find((box) => box.name === "plan activation")!;
    expect(plan.rect.height, "the plan pill keeps its 48px").toBeGreaterThanOrEqual(48);
    expect(
      Math.round(bar!.y) - Math.round(plan.rect.bottom),
      "the plan pill keeps a real gap above the tab bar",
    ).toBeGreaterThanOrEqual(10);
  });
}

// The DEFAULT berth, which no map case can reach.
//
// Every case above opens /map with a stored Pub Pal, so the create action is
// always measured at one of the map berths. The berth every OTHER phone route
// uses - the bare one, above the tab bar - was never rendered anywhere in the
// suite, and the one fixed control that shares it is mounted in the root layout
// for any reader who has not answered the analytics question. Both specs that
// could have caught that seeded the answer away, so the collision was excluded
// by construction: an opaque 56px circle sat on the card's Allow / No thanks
// column and took its taps.
//
// The assertion is hit-testing rather than geometry, because what the reader
// needs is not clearance, it is that pressing Allow records Allow.
for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px consent choices stay reachable in the default berth`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      // Consent is deliberately UNDECIDED, and no other prompt holds the
      // session budget, so the card is the one on screen.
      window.localStorage.removeItem("pubmaxx:analytics-consent:v1");
      window.sessionStorage.removeItem("pubmax:prompt-budget:v1");
    });

    const response = await page.goto("/out");
    expect(response?.status()).toBe(200);

    const prompt = page.locator(".analyticsConsentPrompt");
    // Present, or this case would pass by measuring nothing.
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".mobileTabBar")).toBeVisible();
    // And the map members really are absent, so this IS the default berth.
    await expect(page.locator(".palSummon")).toHaveCount(0);
    await expect(page.locator(".mobilePlanActivation")).toHaveCount(0);
    await expect(page.locator(".mobileMapUtilityCorner")).toHaveCount(0);

    for (const label of ["Allow", "No thanks"]) {
      const button = prompt.getByRole("button", { name: label, exact: true });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      expect(box, `${label} has a box`).not.toBeNull();
      expect(box!.height, `${label} keeps the tap floor`).toBeGreaterThanOrEqual(44);
      const owner = await page.evaluate(
        ({ x, y }) => {
          const hit = document.elementFromPoint(x, y);
          if (!hit) return "nothing";
          if (hit.closest(".analyticsConsentPrompt")) return "prompt";
          if (hit.closest(".createFabRoot")) return "create action";
          return hit.className || hit.tagName;
        },
        { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 },
      );
      expect(owner, `${label} receives its own tap`).toBe("prompt");
    }

    // Pressing it records the choice rather than opening the create sheet.
    await prompt.getByRole("button", { name: "No thanks", exact: true }).click();
    await expect(prompt).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Post a moment", exact: true })).toHaveCount(0);
    // With the question answered, compose comes back at the default berth.
    const create = page.getByTestId("create-fab");
    await expect(create).toBeVisible();
    const createBox = await create.boundingBox();
    expect(createBox, "the create action has a box").not.toBeNull();
    expect(createBox!.width, "the create action keeps its 56px").toBe(56);
  });
}

// The create action's own geometry, and what the hidden state COSTS a reader.
//
// Both used to be regexes over createFab.css. A declaration that matches proves
// nothing: the rule can be dead, overridden, or renamed without moving a pixel.
// So this measures the rendered boxes, and drives the hidden state through the
// one class the component emits for it (proved by __tests__/createFab.test.ts).
for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px the create action is measured, and leaves the screen when hidden`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
    });

    const response = await page.goto("/out");
    expect(response?.status()).toBe(200);

    const create = page.getByTestId("create-fab");
    await expect(create).toBeVisible();
    const box = await create.boundingBox();
    expect(box, "the create action has a box").not.toBeNull();
    expect(box!.width, "56px square").toBe(56);
    expect(box!.height, "56px square").toBe(56);
    expect(box!.x + box!.width, "inside the viewport").toBeLessThanOrEqual(viewport.width);

    const bar = await page.locator(".mobileTabBar").boundingBox();
    expect(bar, "the tab bar has a box").not.toBeNull();
    expect(
      box!.y + box!.height,
      "the create action parks above the tab bar",
    ).toBeLessThanOrEqual(Math.round(bar!.y) + 1);

    // Every row of its sheet keeps the tap floor. Scope to the sheet: /out's
    // own empty state links to /plan under the same name, so a page-wide
    // lookup is ambiguous rather than wrong.
    await create.click();
    const createMenu = page.locator(".createFabMenu");
    for (const label of ["Post a moment", "Log a price", "Start a plan"]) {
      const row = createMenu.getByRole("link", { name: label, exact: true });
      await expect(row).toBeVisible();
      const rowBox = await row.boundingBox();
      expect(rowBox, `${label} has a box`).not.toBeNull();
      expect(rowBox!.height, `${label} keeps the tap floor`).toBeGreaterThanOrEqual(44);
    }
    await page.keyboard.press("Escape");

    const centre = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
    const before = await page.evaluate((point) => {
      const fab = document.querySelector<HTMLElement>(".createFab")!;
      const style = getComputedStyle(fab);
      return {
        pointerEvents: style.pointerEvents,
        visibility: style.visibility,
        top: fab.getBoundingClientRect().top,
        ownsItsCentre: !!document
          .elementFromPoint(point.x, point.y)
          ?.closest(".createFabRoot"),
      };
    }, centre);
    expect(before.pointerEvents, "live, it takes taps").not.toBe("none");
    expect(before.visibility, "live, it is painted").toBe("visible");
    expect(before.ownsItsCentre, "live, it owns its own centre").toBe(true);

    // The soft keyboard is the OS's, not the page's, so no browser test can
    // raise it. What the component does about it is add this class
    // (components/nav/CreateFab.tsx); what the CSS owes is everything below.
    // Reduced motion is emulated above, so the withdrawal is not mid-transition.
    const hidden = await page.evaluate((point) => {
      const root = document.querySelector<HTMLElement>(".createFabRoot")!;
      root.classList.add("isKeyboardHidden");
      const fab = document.querySelector<HTMLElement>(".createFab")!;
      const style = getComputedStyle(fab);
      const rect = fab.getBoundingClientRect();
      const centreHit = document.elementFromPoint(point.x, point.y);
      const ownHit = document.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return {
        pointerEvents: style.pointerEvents,
        visibility: style.visibility,
        top: rect.top,
        centreOwned: !!centreHit?.closest(".createFabRoot"),
        ownBoxOwned: !!ownHit?.closest(".createFabRoot"),
      };
    }, centre);
    expect(hidden.pointerEvents, "hidden, it takes no taps").toBe("none");
    expect(hidden.visibility, "hidden, it is not painted").toBe("hidden");
    expect(hidden.top, "hidden, it slid down out of its berth").toBeGreaterThan(
      before.top,
    );
    expect(
      hidden.centreOwned,
      "hidden, its old centre belongs to whatever is under it",
    ).toBe(false);
    expect(
      hidden.ownBoxOwned,
      "hidden, it takes no tap anywhere its box still overlaps",
    ).toBe(false);
  });
}

// Social is a primary phone destination in the live launch. The count-driven
// row must close to five columns at every supported phone width.
for (const viewport of VIEWPORTS) {
  test(`${viewport.width}px live Social stays in primary phone chrome`, async ({
    page,
  }) => {
    await openPhoneMap(page, viewport);

    const primary = page.getByRole("navigation", { name: "Primary" });
    await expect(primary.locator('a[href="/social"]')).toHaveCount(1);
    await expect(primary.locator("a")).toHaveCount(5);
  });
}
