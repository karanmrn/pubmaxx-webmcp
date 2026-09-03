import { expect, test } from "@playwright/test";

test("More menu stays usable in a short desktop viewport", async ({ page }) => {
  await page.setViewportSize({ width: 667, height: 320 });
  await page.goto("/today");

  const trigger = page.getByRole("button", { name: "More pages" });
  await trigger.focus();
  await page.keyboard.press("ArrowDown");

  const menu = page.getByRole("menu", { name: "More pages" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem")).toHaveText([
    "PlanBuild a three-stop outing",
    "NearFind priced pubs close to you",
    "HistoricRead the stories behind old pubs",
    "PalAsk for a pub that fits tonight",
  ]);

  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(312);

  const firstItem = page.getByRole("menuitem", { name: /Plan/ });
  const lastItem = page.getByRole("menuitem", { name: /Pal/ });
  await expect(firstItem).toBeFocused();
  await page.keyboard.press("End");
  await expect(lastItem).toBeFocused();
  await expect(lastItem).toBeInViewport();

  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(lastItem).toBeFocused();
});
