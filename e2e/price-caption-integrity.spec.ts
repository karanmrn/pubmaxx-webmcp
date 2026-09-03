import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { storyBandsForCity } from "@/lib/cityStoryBands";
import { listEnabledCities } from "@/lib/cities";

const VIEWPORTS = [
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

const DEAL_QUALIFIER =
  "Two pints for £12 before 7pm on Thursdays. Booking excludes match nights, bank holidays, and the terrace.";
const OSM_PUB_ATTRIBUTION = "Pub data © OpenStreetMap contributors (ODbL)";
const FIRST_RUN_COMPANION_NOTES = [
  "Loyal and perceptive",
  "Calm and mischievous",
  "Curious and quick",
  "Streetwise and social",
  "Steady and protective",
  "Bright and encouraging",
] as const;
const THE_GRAPES_HOOK =
  "The Grapes is a Grade II listed public house at 76 Narrow Street, Limehouse, on the north bank of the Thames; a pub has stood on the site since 1583.";

const LONGEST_STORY_BAND = listEnabledCities()
  .flatMap((city) => storyBandsForCity(city.id))
  .sort((left, right) => right.copy.length - left.copy.length)[0]!;

type CaptionCase = {
  name: string;
  cssPath: string;
  selector: string;
  expected: string;
  markup: string;
  checkNextSibling?: boolean;
  checkNoOverlapSelector?: string;
  growingContainerSelector?: string;
  expectContainerGrowth?: boolean;
  visibleAtPhone?: boolean;
  expectedButtons?: string[];
};

const FIXTURE_ONLY_CAPTION_CASES: CaptionCase[] = [
  {
    name: "deal conditions",
    cssPath: "components/discovery/dealsTonightLane.css",
    selector: ".dealsTonightDetail",
    expected: DEAL_QUALIFIER,
    markup: `
      <section class="dealsTonight">
        <a class="dealsTonightCard" href="/map?sel=venue-xjf3n0">
          <div class="dealsTonightCardHead"><strong>Early round offer</strong></div>
          <span class="dealsTonightPlace">Arnos Arms, Arnos Grove</span>
          <span class="dealsTonightDetail">${DEAL_QUALIFIER}</span>
          <span class="dealsTonightSource">Venue listing · sourced</span>
        </a>
      </section>
    `,
    checkNextSibling: true,
  },
  {
    name: "search recovery status",
    cssPath: "components/map/mapToolbar.css",
    selector: ".mapToolbarSearchStatusCopy",
    expected: "Search is unavailable right now. Existing pubs remain on the map while it reconnects.",
    markup: `
      <div class="mapToolbar">
        <div class="mapToolbarSearchStatus">
          <span class="mapToolbarSearchStatusCopy">Search is unavailable right now. Existing pubs remain on the map while it reconnects.</span>
          <button class="mapToolbarSearchRecovery">Retry</button>
        </div>
      </div>
    `,
  },
  {
    name: "search price provenance",
    cssPath: "components/map/mapSearchSuggest.css",
    selector: ".mapSearchSuggestPriceProvenance",
    expected: "Observed 30 July · Community report",
    markup: `
      <div class="mapSearchSuggestRow">
        <span class="mapSearchSuggestRowMain"><span class="mapSearchSuggestRowName">Arnos Arms</span></span>
        <span class="mapSearchSuggestPrice">
          <span>Beer · £5.60</span>
          <small class="mapSearchSuggestPriceProvenance">Observed 30 July · Community report</small>
        </span>
      </div>
    `,
  },
  {
    name: "list price provenance",
    cssPath: "components/map/mapVenueList.css",
    selector: ".mapVenueListPriceProvenance",
    expected: "Observed 30 July · Community report",
    markup: `
      <div class="mapVenueListPanel">
        <button class="mapVenueListItem">
          <span class="mapVenueListItemName">Arnos Arms</span>
          <span class="mapVenueListItemMeta">
            <span class="mapVenueListCompactPrice">
              <span>Beer · £5.60</span>
              <small class="mapVenueListPriceProvenance">Observed 30 July · Community report</small>
            </span>
          </span>
        </button>
      </div>
    `,
  },
  {
    name: "tonight listing conditions",
    cssPath: "components/map/tonightLane.css",
    selector: ".tonightLaneCardTitle",
    expected: "Two pints for £12 before 7pm, except bank holidays and match nights.",
    markup: `
      <article class="tonightLaneCard">
        <p class="tonightLaneCardTitle">Two pints for £12 before 7pm, except bank holidays and match nights.</p>
        <p class="tonightLaneCardSource">via Venue listing checked 30 July</p>
      </article>
    `,
  },
  {
    name: "tonight source",
    cssPath: "components/map/tonightLane.css",
    selector: ".tonightLaneCardSource",
    expected: "via Venue listing checked 30 July",
    markup: `
      <article class="tonightLaneCard">
        <p class="tonightLaneCardTitle">Early round offer</p>
        <p class="tonightLaneCardSource">via Venue listing checked 30 July</p>
      </article>
    `,
  },
  {
    name: "tonight freshness",
    cssPath: "components/map/tonightLane.css",
    selector: ".tonightLaneCollapsedChecked",
    expected: "Checked 30 July from listed sources",
    markup: `
      <div class="tonightLaneCollapsed">
        <button class="tonightLaneCollapsedMain">
          <span class="tonightLaneCollapsedTitle">On tonight · 12</span>
          <span class="tonightLaneCollapsedChecked">Checked 30 July from listed sources</span>
        </button>
        <button class="tonightLaneOverlayToggle">Map</button>
      </div>
    `,
    checkNoOverlapSelector: ".tonightLaneOverlayToggle",
    growingContainerSelector: ".tonightLaneCollapsedMain",
  },
  {
    name: "tonight expanded freshness",
    cssPath: "components/map/tonightLane.css",
    selector: ".tonightLaneChecked",
    expected: "Checked 30 July from listed sources",
    markup: `
      <section class="tonightLane tonightLane--open tonightLane--sheet">
        <div class="tonightLaneHead">
          <div class="tonightLaneTitleRow">
            <div class="tonightLaneTitleMeta">
              <h2 class="tonightLaneTitle">On tonight</h2>
              <span class="tonightLaneChecked">Checked 30 July from listed sources</span>
            </div>
            <button class="tonightLaneClose">Close</button>
          </div>
        </div>
      </section>
    `,
    checkNoOverlapSelector: ".tonightLaneClose",
  },
  {
    name: "place story condition",
    cssPath: "app/globals.css",
    selector: ".bandOnboardingChip span",
    expected: LONGEST_STORY_BAND.copy,
    markup: `
      <div class="bandOnboardingChip" role="status" aria-live="polite">
        <div>
          <strong>${LONGEST_STORY_BAND.title}</strong>
          <span>${LONGEST_STORY_BAND.copy}</span>
        </div>
        <button type="button">Walk this story</button>
        <button type="button" aria-label="Dismiss Place story intro">
          <svg aria-hidden="true"></svg>
        </button>
      </div>
    `,
    growingContainerSelector: ".bandOnboardingChip",
    expectContainerGrowth: true,
    expectedButtons: ["Walk this story", "Dismiss Place story intro"],
  },
];

async function prepareCaptionCase(
  page: Page,
  viewport: (typeof VIEWPORTS)[number],
  captionCase: CaptionCase,
): Promise<void> {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const css = readFileSync(captionCase.cssPath, "utf8");
  await page.setContent(`
    <style>
      :root {
        --ink: #24221f;
        --ink-soft: #67625b;
        --line: #d8d0c7;
        --brass: #b04b31;
        --panel-raised: #fffaf4;
      }
      * { box-sizing: border-box; }
      body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; }
      ${css}
    </style>
    <main>${captionCase.markup}</main>
  `);
}

async function expectUnclippedCaption(locator: Locator, expected: string): Promise<void> {
  await expect(locator).toHaveText(expected);
  const state = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      text: element.textContent,
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      lineClamp: style.getPropertyValue("-webkit-line-clamp"),
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });

  expect(state.text).toBe(expected);
  expect(state.textOverflow).not.toBe("ellipsis");
  expect(state.whiteSpace).not.toBe("nowrap");
  expect(state.lineClamp).toBe("none");
  expect(state.clientHeight).toBe(state.scrollHeight);
}

async function expectBoundedProse(
  locator: Locator,
  expected: string | undefined,
  lineClamp: number,
): Promise<void> {
  if (expected !== undefined) {
    await expect(locator).toHaveText(expected);
  }
  const state = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      overflow: style.overflow,
      lineClamp: style.getPropertyValue("-webkit-line-clamp"),
      clientHeight: element.clientHeight,
      lineHeight: Number.parseFloat(style.lineHeight),
    };
  });

  expect(state.overflow).toBe("hidden");
  expect(state.lineClamp).toBe(String(lineClamp));
  expect(state.clientHeight).toBeLessThanOrEqual(
    Math.ceil(state.lineHeight * lineClamp) + 1,
  );
}

for (const viewport of VIEWPORTS) {
  for (const captionCase of FIXTURE_ONLY_CAPTION_CASES) {
    test(`fixture-only CSS contract: ${captionCase.name} at ${viewport.width}px`, async ({ page }) => {
      await prepareCaptionCase(page, viewport, captionCase);

      const qualifier = page.locator(captionCase.selector);
      if (captionCase.visibleAtPhone !== false) {
        await expect(qualifier).toBeVisible();
      }
      await expectUnclippedCaption(qualifier, captionCase.expected);

      if (captionCase.checkNextSibling) {
        const qualifierBox = await qualifier.boundingBox();
        const next = qualifier.locator("xpath=following-sibling::*[1]");
        await expect(next).toBeVisible();
        const nextBox = await next.boundingBox();
        expect(qualifierBox).not.toBeNull();
        expect(nextBox).not.toBeNull();
        expect(nextBox!.y).toBeGreaterThanOrEqual(qualifierBox!.y + qualifierBox!.height);
      }

      if (captionCase.checkNoOverlapSelector) {
        const qualifierBox = await qualifier.boundingBox();
        const peer = page.locator(captionCase.checkNoOverlapSelector);
        await expect(peer).toBeVisible();
        const peerBox = await peer.boundingBox();
        expect(qualifierBox).not.toBeNull();
        expect(peerBox).not.toBeNull();
        const overlaps =
          qualifierBox!.x < peerBox!.x + peerBox!.width &&
          qualifierBox!.x + qualifierBox!.width > peerBox!.x &&
          qualifierBox!.y < peerBox!.y + peerBox!.height &&
          qualifierBox!.y + qualifierBox!.height > peerBox!.y;
        expect(overlaps).toBe(false);
      }

      if (captionCase.growingContainerSelector) {
        const container = page.locator(captionCase.growingContainerSelector);
        const containerBox = await container.boundingBox();
        const qualifierBox = await qualifier.boundingBox();
        expect(containerBox).not.toBeNull();
        expect(qualifierBox).not.toBeNull();
        expect(containerBox!.height).toBeGreaterThanOrEqual(44);
        if (captionCase.expectContainerGrowth) {
          expect(containerBox!.height).toBeGreaterThan(44);
        }
        expect(qualifierBox!.y).toBeGreaterThanOrEqual(containerBox!.y);
        expect(qualifierBox!.y + qualifierBox!.height).toBeLessThanOrEqual(
          containerBox!.y + containerBox!.height,
        );
      }

      if (captionCase.expectedButtons) {
        const buttons = page.locator("button");
        await expect(buttons).toHaveCount(captionCase.expectedButtons.length);
        for (const name of captionCase.expectedButtons) {
          await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
        }
      }

      const documentOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(documentOverflow).toBeLessThanOrEqual(1);
    });
  }
}

for (const viewport of VIEWPORTS.filter(({ width }) => width >= 390)) {
  test(`historic disclosures retain the full 1583 text at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const response = await page.goto("/historic");
    expect(response?.status()).toBe(200);

    const card = page
      .locator(".historicCard")
      .filter({ hasText: "The Grapes" });
    await expect(card).toBeVisible();
    const disclosure = card.locator(".proseDisclosure");
    await expect(disclosure).not.toHaveAttribute("open", "");
    const hook = disclosure.locator(".proseDisclosureText");
    await expect(hook).toHaveText(THE_GRAPES_HOOK);
    await expectBoundedProse(hook, THE_GRAPES_HOOK, 2);
    await expect(disclosure.getByText("Show more", { exact: true })).toBeVisible();
    await disclosure.locator("summary").click();
    await expect(disclosure).toHaveAttribute("open", "");
    await expectUnclippedCaption(hook, THE_GRAPES_HOOK);
    await expect(disclosure.getByText("Show less", { exact: true })).toBeVisible();
    await expect(hook).toContainText("since 1583");
    const provenance = card.locator(".historicProvenance");
    await expect(provenance).toBeVisible();
    await expect(card.locator(".historicEra")).toHaveText("1583");
    await expect(card.locator(".historicCite")).toBeVisible();
    const [hookBox, provenanceBox] = await Promise.all([
      disclosure.boundingBox(),
      provenance.boundingBox(),
    ]);
    expect(hookBox).not.toBeNull();
    expect(provenanceBox).not.toBeNull();
    expect(provenanceBox!.y).toBeGreaterThanOrEqual(
      hookBox!.y + hookBox!.height,
    );

    const boroughResponse = await page.goto("/borough/tower-hamlets");
    expect(boroughResponse?.status()).toBe(200);

    const boroughCard = page
      .locator(".boroughHeritageCard")
      .filter({ hasText: "The Grapes" });
    await expect(boroughCard).toBeVisible();
    const boroughDisclosure = boroughCard.locator(".proseDisclosure");
    const boroughHook = boroughDisclosure.locator(".proseDisclosureText");
    await expect(boroughHook).toHaveText(THE_GRAPES_HOOK);
    await expectBoundedProse(boroughHook, THE_GRAPES_HOOK, 2);
    await boroughDisclosure.locator("summary").click();
    await expect(boroughDisclosure).toHaveAttribute("open", "");
    await expectUnclippedCaption(boroughHook, THE_GRAPES_HOOK);
    await expect(boroughHook).toContainText("since 1583");
    const boroughLink = boroughCard.locator(".boroughHeritageMapLink");
    await expect(boroughLink).toBeVisible();
    await expect(boroughCard.locator(".boroughHeritageEra")).toHaveText("1583");
    const [boroughHookBox, boroughLinkBox] = await Promise.all([
      boroughDisclosure.boundingBox(),
      boroughLink.boundingBox(),
    ]);
    expect(boroughHookBox).not.toBeNull();
    expect(boroughLinkBox).not.toBeNull();
    expect(boroughLinkBox!.y).toBeGreaterThanOrEqual(
      boroughHookBox!.y + boroughHookBox!.height,
    );
    await expect(page.locator(".boroughHeritageProvenance")).toBeVisible();
  });
}

for (const viewport of VIEWPORTS.filter(({ width }) => width >= 390)) {
  test(`mobile map renders story qualifier and attribution at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    });

    const response = await page.goto("/map/glasgow?band=subcrawl");
    expect(response?.status()).toBe(200);
    await expect(page.locator(".mapLoading")).toBeHidden({ timeout: 30_000 });

    const chip = page.locator(".bandOnboardingChip");
    await expect(chip).toBeVisible();
    await expect(chip.locator("span")).toHaveText(LONGEST_STORY_BAND.copy);
    await expectUnclippedCaption(chip.locator("span"), LONGEST_STORY_BAND.copy);
    await expect(chip.getByRole("button")).toHaveCount(2);
    await expect(chip.getByRole("button", { name: "Walk this story" })).toBeVisible();
    await expect(
      chip.getByRole("button", { name: "Dismiss Place story intro" }),
    ).toBeVisible();
    await expect(page.locator(".mobilePlanActivation")).toHaveCount(0);

    const geometry = await page.evaluate(() => {
      const chipElement = document.querySelector(".bandOnboardingChip");
      const mapElement = document.querySelector(".mapStage");
      const tabElement = document.querySelector(".mobileTabBar");
      if (!chipElement || !mapElement || !tabElement) return null;
      const chip = chipElement.getBoundingClientRect();
      const map = mapElement.getBoundingClientRect();
      const tab = tabElement.getBoundingClientRect();
      return {
        chip: { x: chip.x, y: chip.y, width: chip.width, height: chip.height, bottom: chip.bottom },
        map: { x: map.x, y: map.y, width: map.width, height: map.height },
        tab: { x: tab.x, y: tab.y, width: tab.width, height: tab.height },
      };
    });
    expect(geometry).not.toBeNull();
    expect(geometry!.chip.height).toBeGreaterThan(120);
    expect(geometry!.chip.x).toBeGreaterThanOrEqual(geometry!.map.x);
    expect(geometry!.chip.x + geometry!.chip.width).toBeLessThanOrEqual(
      geometry!.map.x + geometry!.map.width,
    );
    expect(geometry!.chip.y).toBeGreaterThanOrEqual(geometry!.map.y);
    expect(geometry!.chip.bottom).toBeLessThanOrEqual(geometry!.tab.y);
    expect(geometry!.chip.height / geometry!.map.height).toBeLessThan(0.3);

    const attribution = page.locator(".maplibregl-ctrl-attrib");
    await expect(attribution).toBeVisible();
    const attributionInner = attribution.locator(".maplibregl-ctrl-attrib-inner");
    if (!(await attributionInner.isVisible())) {
      await attribution.locator(".maplibregl-ctrl-attrib-button").click();
    }
    await expect(attributionInner).toBeVisible();
    await expect(attributionInner).toContainText(OSM_PUB_ATTRIBUTION);
    const attributionState = await attributionInner.evaluate((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent,
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        top: rect.top,
        bottom: rect.bottom,
      };
    });
    expect(attributionState.text).toContain(OSM_PUB_ATTRIBUTION);
    expect(attributionState.display).not.toBe("none");
    expect(attributionState.visibility).toBe("visible");
    expect(Number(attributionState.opacity)).toBeGreaterThan(0);
    expect(attributionState.top).toBeGreaterThanOrEqual(geometry!.chip.bottom);
    expect(attributionState.bottom).toBeLessThanOrEqual(geometry!.tab.y);

    await page.getByRole("button", { name: "More map controls" }).click();
    const layersSheet = page.locator(
      '.mobileSheetPortal[data-sheet-kind="layers"]:visible',
    );
    await expect(layersSheet).toBeVisible();
    await layersSheet.getByRole("tab", { name: "Layers" }).click();
    const listShortcut = layersSheet.getByRole("button", {
      name: "List view of venues on the map",
    });
    await expect(listShortcut).toBeVisible();
    await listShortcut.click();
    await expect(page.locator(".mapVenueListPanel")).toBeVisible();
    await expect(chip).toHaveCount(0);

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(1);
  });

  test(`first-run qualifiers render on the real page at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      Object.defineProperty(window, "Capacitor", {
        configurable: true,
        value: {
          isNativePlatform: () => true,
          getPlatform: () => "ios",
        },
      });
    });

    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(/\/onboarding$/);

    const reviewedSources = page.getByText("PUBMAXX reviewed", { exact: true });
    await expect(reviewedSources).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      await expectUnclippedCaption(reviewedSources.nth(index), "PUBMAXX reviewed");
      await expect(reviewedSources.nth(index)).toBeVisible();
    }

    await page.getByRole("button", { name: "Use London" }).click();
    for (const note of FIRST_RUN_COMPANION_NOTES) {
      const qualifier = page.getByText(note, { exact: true });
      await expect(qualifier).toBeVisible();
      await expectUnclippedCaption(qualifier, note);
    }
  });

  test(`Pal setup progress renders on the real page at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(() => {
      window.localStorage.setItem(
        "pubmaxx.pub-pal-route-activation.v1",
        JSON.stringify({
          version: 1,
          activatedAt: new Date().toISOString(),
        }),
      );
    });

    const response = await page.goto("/pal");
    expect(response?.status()).toBe(200);
    await page.getByRole("button", { name: "Meet your Pub Pal" }).click();
    const progress = page.locator(".palTopbar > span");
    await expect(progress).toBeVisible();
    await expectUnclippedCaption(progress, "1 of 5");
  });
}
