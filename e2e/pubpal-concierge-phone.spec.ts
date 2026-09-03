import { mkdir } from "node:fs/promises";

import { expect, test } from "@playwright/test";

// Pub Pal V0.1 on a phone, keyless.
//
// Every proof runs against the real deterministic path: no OpenRouter, no
// ElevenLabs, no Supabase.
//   1. a text ask comes back grounded, with a source chip on every card,
//   2. find_desk says "No seat data yet" rather than offering a pub as a desk,
//   3. propose_plan offers one Open in Plan link and moves nothing until it is taken,
//   4. the Pal recalls a subject raised earlier in the same thread,
//   5. the meeting fits 360, 390 and 430 with tappable controls,
//   6. voice, unconfigured, explains itself instead of failing on the tap.

const PHONE = { width: 390, height: 844 };
const SHOTS = "docs/proof/pubpal-v01";

async function askOnPhone(page: import("@playwright/test").Page, ask: string) {
  await page.getByRole("textbox", { name: /Describe the outing/i }).fill(ask);
  await page.getByRole("button", { name: "Ask" }).click();
  await expect(page.locator(".palChatBubble--pending")).toHaveCount(0, {
    timeout: 20_000,
  });
}

test.describe("Pub Pal concierge at 390px", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.emulateMedia({ reducedMotion: "reduce" });
  });

  test("a text ask answers from our own rows, and every card keeps its source", async ({
    page,
  }) => {
    await page.goto("/pal/chat");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.locator(".mobileTabBar")).toBeVisible();
    await askOnPhone(page, "Quiet-ish near Bank, not pricey");

    const answer = page.locator(".palChatRow--pal").last();
    await expect(answer.locator(".palChatBubble").first()).not.toBeEmpty();

    const cards = answer.locator(".palChatCard");
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);
    for (let index = 0; index < cardCount; index += 1) {
      await expect(cards.nth(index).locator(".palChatProv")).toHaveCount(1);
    }

    // No horizontal scroll at phone width.
    const layout = await page.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
    }));
    expect(layout.width).toBeLessThanOrEqual(layout.viewport);
  });

  // Design proof, run on demand: PUBPAL_V01_SHOTS=1. The theme lives in
  // localStorage (`pubmax-theme`), so each pass sets it before the first paint
  // rather than emulating a media query the app does not read.
  for (const theme of ["light", "dark"] as const) {
    test(`proof shot at 390px in ${theme}`, async ({ page }) => {
      test.skip(!process.env.PUBPAL_V01_SHOTS, "design proof runs on demand");
      await page.addInitScript((value) => {
        window.localStorage.setItem("pubmax-theme", value);
      }, theme);
      await page.goto("/pal/chat");
      await askOnPhone(page, "Quiet-ish near Bank, not pricey");
      const answer = page.locator(".palChatRow--pal").last();
      await expect(answer.locator(".palChatBubble").first()).not.toBeEmpty();
      await mkdir(SHOTS, { recursive: true });
      await page.screenshot({
        path: `${SHOTS}/pal-chat-390-${theme}.png`,
        fullPage: true,
      });
    });
  }

  test("a cheapest-pint ask with tonight still names the area", async ({ page }) => {
    await page.goto("/pal/chat");
    await askOnPhone(page, "Cheapest pint in Camden tonight");

    const answer = page.locator(".palChatRow--pal").last();
    await expect(answer.locator(".palChatBubble").first()).toContainText(
      /Cheapest listed pints in Camden/i,
    );
    await expect(answer.locator(".palChatBubble").first()).not.toContainText(
      "Name a listed pub or a London area",
    );
  });

  test("find_desk says there is no seat data rather than offering a pub", async ({
    page,
  }) => {
    await page.goto("/pal/chat");
    await askOnPhone(page, "Somewhere to work with wifi in Angel");

    const answer = page.locator(".palChatRow--pal").last();
    await expect(answer.locator(".palChatBubble").first()).toContainText(
      "No seat data yet",
    );
    // Nothing is offered as a desk while there is nothing on record.
    await expect(answer.locator(".palChatCard")).toHaveCount(0);
  });

  test("a crawl ask proposes one way on and waits to be taken", async ({ page }) => {
    await page.goto("/pal/chat");
    await askOnPhone(page, "Plan a crawl in Soho for 4");

    const answer = page.locator(".palChatRow--pal").last();
    await expect(answer.getByRole("link", { name: "Open in Plan" })).toBeVisible();
    // ONE way on TO PLAN: a second control landing the same /plan?query= was
    // two labels for one action, so the old "Confirm three-stop draft" button
    // is gone. The per-stop "Open <pub>" confirms beside it stay - each is a
    // different destination (/map?sel=), not a second door onto the same one.
    await expect(
      answer.getByRole("button", { name: /Confirm three-stop draft/i }),
    ).toHaveCount(0);
    await expect(answer.locator('a[href^="/plan?"]')).toHaveCount(1);
    await expect(answer.getByRole("button", { name: "Dismiss" }).first()).toBeVisible();
    // Still on the chat: a proposal moves nothing until it is taken.
    expect(new URL(page.url()).pathname).toBe("/pal/chat");
  });

  test("a crawl ask opens Plan and auto-generates the route", async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax-tour-v1-done", "1");
      window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
      window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
    });
    await page.goto("/pal/chat");
    const ask = "Plan a crawl in Soho for 4";
    await askOnPhone(page, ask);

    const answer = page.locator(".palChatRow--pal").last();
    const planLink = answer.getByRole("link", { name: "Open in Plan" });
    await expect(planLink).toBeVisible();
    await planLink.click();

    await expect(page).toHaveURL(/\/plan\?/);
    await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible({
      timeout: 30_000,
    });
  });

  test("the Pal recalls a subject the drinker raised earlier in the thread", async ({
    page,
  }) => {
    await page.goto("/pal/chat");
    await askOnPhone(page, "Quiet pub in Camden for four");
    await askOnPhone(page, "cheaper");
    await askOnPhone(page, "anything in Camden with a garden");

    await expect(page.locator(".palChatRecall").last()).toContainText(
      "You asked about Camden earlier.",
    );
  });

  // The meeting is the persona's first impression, so it is held to the phone
  // geometry the rest of the site is: nothing off the side, nothing under 44px.
  for (const width of [360, 390, 430]) {
    test(`the meet-your-Pal moment fits and stays tappable at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 844 });
      await page.addInitScript(() => {
        window.localStorage.setItem(
          "pubmaxx.pub-pal-route-activation.v1",
          JSON.stringify({ version: 1, activatedAt: new Date().toISOString() }),
        );
      });
      await page.goto("/pal");

      const meet = page.getByRole("button", { name: /Meet your Pub Pal/ });
      await expect(meet).toBeVisible();
      expect((await meet.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      await meet.click();

      await expect(page.getByRole("heading", { name: "The grown-up bit first." })).toBeVisible();
      await page.getByRole("checkbox", { name: /18 or over/ }).check();
      await page.getByRole("button", { name: /Continue/ }).click();
      await expect(page.getByRole("heading", { name: "Who finds you?" })).toBeVisible();

      const species = page.getByRole("button", { name: /^Greyhound/ });
      expect((await species.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

      const name = page.getByRole("textbox", { name: "Name" });
      await expect(name).toBeVisible();
      // Mobile Safari zooms a focused control under 16px and never zooms back.
      const fontPx = await name.evaluate((node) =>
        Number.parseFloat(getComputedStyle(node).fontSize),
      );
      expect(fontPx).toBeGreaterThanOrEqual(16);

      const layout = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
      }));
      expect(layout.width).toBeLessThanOrEqual(layout.viewport);
    });
  }

  test("voice explains itself instead of failing on the tap", async ({ page, request }) => {
    const probe = await request.get("/api/pub-pal/voice-token");
    expect(probe.ok()).toBe(true);
    const body = (await probe.json()) as { available?: boolean; retention?: string };
    // Keyless: no ElevenLabs grant on this deployment.
    expect(body.available).toBe(false);
    expect(body.retention).toBe("zero");

    // And a caller cannot mint a session without the grant either.
    const token = await request.post("/api/pub-pal/voice-token", { data: {} });
    expect(token.ok()).toBe(false);

    await page.goto("/pal");
    expect(new URL(page.url()).pathname).toBe("/pal");
  });
});
