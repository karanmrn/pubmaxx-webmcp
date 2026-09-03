import { expect, test } from "@playwright/test";

const VIEWPORT = { width: 390, height: 844 };
const PENDING_KEY = "pubmax:identityNudge:pending:v1";
const PENDING_AT_KEY = "pubmax:identityNudge:pendingAt:v1";

test.setTimeout(60_000);

test("Plan identity nudge keeps one sign-in email action on a 390px phone", async ({
  page,
}, testInfo) => {
  const subscriberRequests: string[] = [];
  const analyticsEvents: string[] = [];

  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(({ pendingKey, pendingAtKey }) => {
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "granted");
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // Arm the same fresh Plan trigger written by recordPlanNudgeTrigger().
    // The browser test owns the gate input so it can isolate the nudge surface
    // from Plan's provider and route creation dependencies.
    window.localStorage.setItem(pendingKey, "plan");
    window.localStorage.setItem(pendingAtKey, String(Date.now()));
  }, { pendingKey: PENDING_KEY, pendingAtKey: PENDING_AT_KEY });

  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({}),
    });
  });
  await page.route("**/api/email-subscribers**", async (route) => {
    subscriberRequests.push(route.request().method());
    await route.continue();
  });
  await page.route("**/api/events", async (route) => {
    const raw = route.request().postData();
    if (raw) {
      const body = JSON.parse(raw) as { name?: unknown };
      if (typeof body.name === "string") analyticsEvents.push(body.name);
    }
    await route.fulfill({ status: 204, headers: { "cache-control": "no-store" } });
  });

  await page.goto("/plan");
  await expect(page.locator("#plan-composer")).toBeVisible();

  const primaryNav = page.getByRole("navigation", { name: "Primary" });
  const focusOrigin = primaryNav.getByRole("link", { name: "Map" });
  await focusOrigin.focus();
  await expect(focusOrigin).toBeFocused();

  // Clear grace without navigating away from Plan. Focus origin lets the test
  // prove modal teardown returns the keyboard user to the exact prior control.
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });

  const dialog = page.getByRole("dialog", { name: "Keep your nights" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(primaryNav).toHaveAttribute("inert", "");
  expect(await page.evaluate(() => {
    const target = document.elementFromPoint(window.innerWidth / 2, window.innerHeight - 12);
    return Boolean(target?.closest(".identityNudgeBackdrop"));
  })).toBe(true);

  await expect(dialog.locator('input[type="email"]')).toHaveCount(1);
  await expect(dialog).toContainText("Continue with email");
  await expect(dialog).toContainText("Email me a link");
  await expect(dialog).not.toContainText(/weekly pint digest|Get the digest/iu);
  await expect(dialog.locator(".identityNudgeEmail")).toHaveCount(0);

  const firstAction = dialog.locator('input[type="email"]');
  const lastAction = dialog.getByRole("button", { name: "Not now" });
  await lastAction.focus();
  await page.keyboard.press("Tab");
  await expect(firstAction).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(lastAction).toBeFocused();

  const actions = dialog.locator("button:visible");
  for (let index = 0; index < await actions.count(); index += 1) {
    const box = await actions.nth(index).boundingBox();
    expect(box, `identity action ${index + 1} should have a layout box`).not.toBeNull();
    expect(Math.round(box!.width), `identity action ${index + 1} width`).toBeGreaterThanOrEqual(44);
    expect(Math.round(box!.height), `identity action ${index + 1} height`).toBeGreaterThanOrEqual(44);
  }

  await expect(lastAction).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
  }))).toEqual({
    viewportWidth: VIEWPORT.width,
    scrollWidth: VIEWPORT.width,
    bodyScrollWidth: VIEWPORT.width,
  });

  await page.screenshot({
    path: testInfo.outputPath("identity-nudge-390-light.png"),
    fullPage: false,
  });

  await lastAction.click();
  await expect(dialog).toHaveCount(0);
  await expect(primaryNav).not.toHaveAttribute("inert", "");
  await expect(focusOrigin).toBeFocused();
  expect(subscriberRequests).toEqual([]);
  expect(analyticsEvents).not.toContain("email_subscribed");
});
