import { expect, test } from "@playwright/test";

test("mobile city chooser keeps choices tappable and opens the selected city map", async ({
  page,
}) => {
  test.setTimeout(60_000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });

  const response = await page.goto("/choose-city");
  expect(response?.status()).toBe(200);

  await expect(page.getByRole("heading", { name: "Choose your city" })).toBeVisible();

  const result = await page.evaluate(() => {
    const locate = document.querySelector<HTMLElement>(".cityChooserLocate");
    const links = Array.from(document.querySelectorAll<HTMLElement>(".cityChooserLink"))
      .filter((el) => el.offsetParent !== null)
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          label: el.textContent?.trim() ?? "",
          height: rect.height,
          width: rect.width,
          left: rect.left,
          right: rect.right,
        };
      });
    const locateRect = locate?.getBoundingClientRect();

    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      locate: locateRect
        ? {
            height: locateRect.height,
            width: locateRect.width,
            left: locateRect.left,
            right: locateRect.right,
          }
        : null,
      links,
    };
  });

  expect(result.overflow).toBeLessThanOrEqual(1);
  expect(result.locate, "Use my location control should render").not.toBeNull();
  expect(result.locate!.height).toBeGreaterThanOrEqual(44);
  expect(result.locate!.width).toBeGreaterThan(44);
  expect(result.locate!.left).toBeGreaterThanOrEqual(0);
  expect(result.locate!.right).toBeLessThanOrEqual(390);

  expect(result.links.length).toBeGreaterThanOrEqual(3);
  for (const link of result.links) {
    expect(link.height, `${link.label} link height`).toBeGreaterThanOrEqual(44);
    expect(link.width, `${link.label} link width`).toBeGreaterThan(44);
    expect(link.left, `${link.label} should stay inside the viewport`).toBeGreaterThanOrEqual(0);
    expect(link.right, `${link.label} should stay inside the viewport`).toBeLessThanOrEqual(390);
  }

  const manchester = page.getByRole("link", { name: /Manchester .* Open map\./ });
  await expect(manchester).toHaveAttribute("href", "/map/manchester");
  await Promise.all([
    page.waitForURL(/\/map\/manchester$/),
    manchester.click(),
  ]);
  await expect(page.locator(".mapCanvasWrap")).toBeVisible({ timeout: 20_000 });
});
