import { expect, test, type Page } from "@playwright/test";

const VIEWPORT = { width: 390, height: 844 };

test.use({
  launchOptions: {
    args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  },
});

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("no-alcohol and food views own the 390px map without pint controls", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = watchPageErrors(page);
  const response = await page.goto("/map");
  expect(response?.status()).toBe(200);

  // The phone chrome mounts with the SCENE, not with the document, and warming
  // the map up regularly outlasts the 10s expect budget on a cold server. That
  // is a wait on the map, not a finding about this view, so it gets the same
  // generous first-paint budget every other mobile map spec takes.
  const filtersButton = page.getByRole("button", { name: /^Filters/ });
  await expect(filtersButton).toBeVisible({ timeout: 45_000 });
  await filtersButton.click();

  const sheet = page.locator('.mobileSheetPortal[data-sheet-kind="filters"]');
  await expect(sheet).toBeVisible();
  const mapViewGroup = sheet.getByRole("group", { name: "Map view" });
  const all = mapViewGroup.getByRole("button", { name: "All", exact: true });
  const noAlcohol = mapViewGroup.getByRole("button", {
    name: "No alcohol",
    exact: true,
  });
  const food = mapViewGroup.getByRole("button", { name: "Food", exact: true });
  for (const control of [all, noAlcohol, food]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 390) + (box?.width ?? 1)).toBeLessThanOrEqual(390);
  }

  const indexResponse = page.waitForResponse(
    (candidate) =>
      candidate.url().includes("/api/price-submit?lens=no-alcohol") &&
      candidate.status() === 200,
  );
  await noAlcohol.click();
  await indexResponse;
  await expect(noAlcohol).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("status")).toContainText(
    /alcohol-free or soft drink prices/i,
  );
  await expect(
    sheet.getByRole("button", { name: "Beer", exact: true }),
  ).toHaveCount(0);
  await expect(sheet.getByText("Maximum pint price")).toHaveCount(0);
  await expect(filtersButton).toHaveAttribute(
    "aria-label",
    "Filters: no-alcohol view active",
  );

  await food.click();
  await expect(food).toHaveAttribute("aria-pressed", "true");
  await expect(sheet.getByRole("status")).toContainText(
    /sourced menu price|Food venues shown/i,
  );
  await expect(
    page.getByRole("button", { name: "Pints", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Bars", exact: true }),
  ).toHaveCount(0);
  await expect(
    sheet
      .getByRole("group", { name: "Venue types" })
      .getByRole("button", { name: "Food", exact: true }),
  ).toBeVisible();
  await expect(filtersButton).toHaveAttribute(
    "aria-label",
    "Filters: food view active",
  );

  expect(errors).toEqual([]);
});
