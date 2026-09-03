import { test, expect, type Page } from "@playwright/test";

// /u/you signed-out identity invitation (spec #393) + notifications bell/activity
// (story 34). Fresh-context (no localStorage `pubmax_handle`), so /u/you never
// redirects and renders the honest invitation — NOT a "@you" pseudo-profile. Also
// re-asserts the PRD's two regression guards on the SAME fresh page: no raw
// "venue-…" id and no "@@" doubled handle ever leak as visible text.
//
// Style matches the other new specs: watchPageErrors, web-first assertions, no
// waitForTimeout, .count()-guarded branches for populated-vs-empty states.

function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

const RAW_VENUE_ID = /venue-[a-z0-9]+/;

test.describe("/u/you — signed-out identity invitation (fresh context, no localStorage)", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("renders the honest invitation, not a pseudo-profile, with one primary CTA + quiet secondary", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/u/you");
    expect(response?.status()).toBe(200);

    // No device handle in localStorage → /u/you never redirects (guarded in
    // app/u/[handle]/page.tsx's isYouRoute effect); it stays on this route and
    // renders the signed-out invitation (spec #393: no fake "@you" profile).
    await expect(page).toHaveURL(/\/u\/you$/);

    const invite = page.locator(".youIdentityIntro");
    await expect(invite).toBeVisible();
    await expect(invite.getByRole("heading", { name: "Make the night yours." })).toBeVisible();

    // One primary CTA (start identity) + one quiet secondary — no more.
    const actions = invite.locator(".youIdentityActions a");
    await expect(actions).toHaveCount(2);
    await expect(actions.nth(0)).toHaveAttribute("href", "#account-settings");
    await expect(actions.nth(1)).toHaveAttribute("href", "/pal");

    // No pseudo-profile scaffolding: the "@you" passport header, timeline and
    // saved list are all suppressed when signed out.
    await expect(page.locator(".pintPassport")).toHaveCount(0);
    await expect(page.locator("#timeline")).toHaveCount(0);
    await expect(page.locator(".youProfileTabs")).toHaveCount(0);

    // No fake handle leaks anywhere on the page.
    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toContain("@you");

    // No "Claim this handle" button — "you" is a sentinel, not a real handle to
    // adopt (app/u/[handle]/page.tsx: isYouRoute ? null : ...).
    await expect(page.getByRole("button", { name: /claim this handle/i })).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("mobile invitation CTAs stay thumb-sized and within the viewport", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });

    const response = await page.goto("/u/you");
    expect(response?.status()).toBe(200);

    const actions = page.locator(".youIdentityActions");
    await expect(actions).toBeVisible();

    const result = await page.evaluate(() => {
      const links = Array.from(
        document.querySelectorAll<HTMLElement>(".youIdentityActions a"),
      ).map((link) => {
        const rect = link.getBoundingClientRect();
        return {
          height: rect.height,
          width: rect.width,
          left: rect.left,
          right: rect.right,
        };
      });

      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        links,
      };
    });

    expect(result.overflow).toBeLessThanOrEqual(1);
    expect(result.links).toHaveLength(2);
    for (const link of result.links) {
      expect(link.height).toBeGreaterThanOrEqual(44);
      expect(link.width).toBeGreaterThan(44);
      expect(link.left).toBeGreaterThanOrEqual(0);
      expect(link.right).toBeLessThanOrEqual(390);
    }

    expect(errors).toEqual([]);
  });

  test("regression guards: no raw 'venue-' id and no '@@' doubled handle anywhere in the page text", async ({
    page,
  }) => {
    await page.goto("/u/you");
    await expect(page.locator(".youIdentityIntro")).toBeVisible();

    const bodyText = await page.locator("body").innerText();
    expect(bodyText).not.toMatch(RAW_VENUE_ID);
    expect(bodyText).not.toContain("@@");
  });
});

// ---------------------------------------------------------------------------
// Notifications bell (nav) + /activity (story 34).
test.describe("notifications — bell + activity feed", () => {
  test("the notification bell renders in the site nav", async ({ page }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/feed", { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);

    const bell = page.locator(".siteNavBell").first();
    await expect(bell).toBeVisible();
    await expect(bell).toHaveAttribute("href", "/activity");

    expect(errors).toEqual([]);
  });

  test("/activity renders the EmptyState when signed out (no device handle)", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);

    const response = await page.goto("/activity");
    expect(response?.status()).toBe(200);

    await expect(page.locator("h1")).toContainText("Activity");

    // No `pubmax_handle` in a fresh context: the page renders the "claim a
    // handle" EmptyState rather than a populated list or a loading spinner
    // stuck forever.
    const empty = page.locator(".emptyState");
    await expect(empty).toBeVisible();
    await expect(empty.locator(".emptyStateTitle")).toContainText(/this corner is yours\. claim it\./i);
    await expect(empty.locator(".emptyStateBody")).toContainText(/sign in and choose a handle/i);
    await expect(empty.locator(".emptyStateAction :is(a, button)")).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("/activity with a claimed handle shows an empty state or populated list without hydration errors", async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    // Seed a device handle so the page attempts the authenticated load path,
    // then guard both outcomes (no notifications yet vs some exist) with
    // .count() — an empty inbox for a brand-new demo handle is the expected,
    // valid state, never a failure.
    await page.addInitScript(() => {
      window.localStorage.setItem("pubmax_handle", "e2e-passport-check");
    });

    const response = await page.goto("/activity");
    expect(response?.status()).toBe(200);

    const emptyNothingYet = page.locator(".emptyState");
    const list = page.locator(".activityList");
    await expect
      .poll(async () => (await emptyNothingYet.count()) + (await list.count()))
      .toBeGreaterThan(0);

    if ((await list.count()) > 0) {
      await expect(list.locator(".activityItem").first()).toBeVisible();
    } else {
      await expect(emptyNothingYet.first()).toBeVisible();
    }

    expect(errors).toEqual([]);
  });
});
