import { expect, test, type Locator } from "@playwright/test";

async function widthOf(locator: Locator): Promise<number> {
  return locator.evaluate((element) => element.getBoundingClientRect().width);
}

test.describe("desktop route composition", () => {
  test.use({ viewport: { width: 1440, height: 1000 } });

  test("Tonight uses a wide primary column with a contextual rail", async ({ page }) => {
    await page.goto("/tonight");

    await expect(page.getByTestId("tonight-screen")).toBeVisible();
    expect(await widthOf(page.getByTestId("tonight-screen"))).toBeGreaterThan(1000);
    expect(await widthOf(page.locator(".tonightContext"))).toBeGreaterThanOrEqual(300);
  });

  test("Today presents its brief and pub context side by side", async ({ page }) => {
    await page.goto("/today");

    const screen = page.locator('[data-testid="today-screen"]:visible').last();
    await expect(screen).toBeVisible();
    expect(await widthOf(screen)).toBeGreaterThan(1000);

    const brief = screen.locator(".todayBriefColumn");
    const explore = screen.locator(".todayExploreColumn");
    await expect(brief).toBeVisible();
    await expect(explore).toBeVisible();
    const [briefBox, exploreBox] = await Promise.all([
      brief.boundingBox(),
      explore.boundingBox(),
    ]);
    expect(briefBox).not.toBeNull();
    expect(exploreBox).not.toBeNull();
    expect(exploreBox!.x).toBeGreaterThan(briefBox!.x + briefBox!.width);
  });

  test("We're out pairs its explanation with the check-in card", async ({ page }) => {
    await page.goto("/we-are-out");

    const explanation = page.locator(".weAreOut .feedHeader");
    const card = page.locator(".weAreOut .weAreOutForm");
    await expect(explanation).toBeVisible();
    await expect(card).toBeVisible();

    const [explanationBox, cardBox] = await Promise.all([
      explanation.boundingBox(),
      card.boundingBox(),
    ]);
    expect(explanationBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    // Side by side, not stacked: the card starts past the right edge of the copy.
    expect(cardBox!.x).toBeGreaterThan(explanationBox!.x + explanationBox!.width);
    // And they share the row rather than the card dropping below the fold.
    expect(Math.abs(cardBox!.y - explanationBox!.y)).toBeLessThan(80);
  });

  test("Near leads with the answer and rails the mode control", async ({ page }) => {
    await page.goto("/near");

    const answer = page.locator(".nmnPageBody > .nmn");
    const control = page.locator(".nmnPageBody > .nearModeSwitch");
    await expect(answer).toBeVisible();
    await expect(control).toBeVisible();

    const [answerBox, controlBox] = await Promise.all([
      answer.boundingBox(),
      control.boundingBox(),
    ]);
    expect(answerBox).not.toBeNull();
    expect(controlBox).not.toBeNull();
    // Content first: the answer holds the primary column and the Pint/Desk
    // control sits beside it instead of stacking above it.
    expect(controlBox!.x).toBeGreaterThan(answerBox!.x + answerBox!.width);
    // The answer took back the width the 560px column used to cap it at.
    expect(answerBox!.width).toBeGreaterThan(560);
  });

  test("Login sits in the page instead of pinned to the top", async ({ page }) => {
    await page.goto("/login");

    const card = page.locator(".loginPageInner");
    await expect(card).toBeVisible();

    const alignment = await page
      .locator(".loginPage")
      .evaluate((element) => getComputedStyle(element).alignContent);
    expect(alignment).toBe("center");

    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    const viewport = page.viewportSize();
    expect(viewport).not.toBeNull();
    // Centring only distributes free space, so the balance claim applies while
    // the card fits. A taller card grows the page and scrolls instead.
    if (box!.height < viewport!.height) {
      const above = box!.y;
      const below = viewport!.height - (box!.y + box!.height);
      expect(Math.abs(above - below)).toBeLessThan(48);
    }
  });

});

test.describe("phone route composition", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Today keeps one card column in its original order", async ({ page }) => {
    await page.route("**/api/tfl-disruption?*", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          disruption: {
            patchId: "soho",
            patchLabel: "Soho",
            lineId: "central",
            lineName: "Central",
            kind: "severe_delays",
            line: "Severe delays on the Central line tonight, leave more time to get home",
          },
          generatedAt: "2026-08-06T10:00:00.000Z",
        }),
      }),
    );
    await page.goto("/today");
    await expect(page.getByTestId("today-tube")).toBeVisible();

    const cards = page.locator(".todayStack .todayCard");
    const cardIds = await cards.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-testid")),
    );
    const expectedCardIds = [
      "today-weather",
      "today-tube",
      "today-picks",
      "today-get-there",
      "today-pints",
      ...(cardIds.includes("today-quiet-pint") ? ["today-quiet-pint"] : []),
      "today-fact",
    ];
    expect(cardIds).toEqual(expectedCardIds);
    const boxes = await cards.evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().toJSON()),
    );
    expect(boxes.every((box) => box.width < 390)).toBe(true);
    expect(boxes.every((box, index) => index === 0 || box.top > boxes[index - 1]!.top)).toBe(true);
  });

  test("We're out keeps one stacked column on a phone", async ({ page }) => {
    await page.goto("/we-are-out");

    const explanation = page.locator(".weAreOut .feedHeader");
    const card = page.locator(".weAreOut .weAreOutForm");
    await expect(explanation).toBeVisible();
    await expect(card).toBeVisible();

    const [explanationBox, cardBox] = await Promise.all([
      explanation.boundingBox(),
      card.boundingBox(),
    ]);
    expect(explanationBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    // The desktop pairing is inside its breakpoint: the wrapper is
    // `display: contents` here, so the phone still reads copy then form.
    expect(cardBox!.y).toBeGreaterThan(explanationBox!.y);
    expect(cardBox!.width).toBeLessThanOrEqual(390);
  });
});
