import { expect, test, type Locator, type Page } from "@playwright/test";

const MOBILE_VIEWPORT = { width: 390, height: 844 };

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
        })),
      { message: "document should not horizontally overflow at 390px" },
    )
    .toEqual({
      clientWidth: MOBILE_VIEWPORT.width,
      scrollWidth: MOBILE_VIEWPORT.width,
      bodyScrollWidth: MOBILE_VIEWPORT.width,
    });
}

async function expectTapTargetsAtLeast44(locator: Locator, label: string): Promise<void> {
  const count = await locator.count();
  for (let i = 0; i < count; i += 1) {
    const control = locator.nth(i);
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    expect(box, `${label} #${i + 1} should have a layout box`).not.toBeNull();
    if (!box) continue;
    expect(Math.round(box.width), `${label} #${i + 1} width`).toBeGreaterThanOrEqual(44);
    expect(Math.round(box.height), `${label} #${i + 1} height`).toBeGreaterThanOrEqual(44);
  }
}

test.describe("messages mobile surface", () => {
  test("/messages renders a usable signed-out/keyless surface at 390px", async ({
    page,
  }) => {
    const response = await page.goto("/messages");
    expect(response?.status()).toBe(200);

    const main = page.locator(".messagesMain");
    await expect(main).toBeVisible();
    await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
    await expect(page.locator(".messagesCourtesyNote")).toContainText(
      "Messages need a signed-in account",
    );
    await expect(page.locator(".messagesInboxPane")).toBeVisible();
    await expect(page.locator(".messagesThreadPane")).toBeHidden();
    await expect(
      page.getByRole("heading", { name: /sign in to message|no conversations yet/i }),
    ).toBeVisible();

    await expectTapTargetsAtLeast44(
      main.locator("a, button").and(page.locator(":visible")),
      "messages main control",
    );
    await expectNoHorizontalOverflow(page);
  });

  test("/messages/nonexistent stays usable on mobile and routes back when allowed", async ({
    page,
  }) => {
    const response = await page.goto("/messages/nonexistent");
    expect(response?.status()).toBe(200);

    const main = page.locator(".messagesMain");
    await expect(main).toBeVisible();
    await expect(page.locator(".messagesInboxPane")).toBeHidden();
    await expect(page.locator(".messagesThreadPane")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const backToInbox = main.getByRole("link", { name: /back to inbox/i }).first();
    if ((await backToInbox.count()) > 0 && await backToInbox.isVisible()) {
      await expectTapTargetsAtLeast44(backToInbox, "back to inbox link");
      await expect(backToInbox).toHaveAttribute("href", "/messages");
      await backToInbox.click();
      await expect(page).toHaveURL(/\/messages$/);
      await expect(page.getByRole("heading", { name: "Messages", exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      return;
    }

    // Keyless/signed-out runs cannot reach the participant-gated 404 branch,
    // but the deep link should still fail gracefully as a sign-in surface.
    await expect(page.getByText(/sign in to read and send messages/i)).toBeVisible();
    await expectTapTargetsAtLeast44(
      main.locator("a, button").and(page.locator(":visible")),
      "signed-out thread control",
    );
  });
});
