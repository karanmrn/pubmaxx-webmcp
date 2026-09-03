import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

type Venue = {
  id: string;
  name: string;
};

const UPDATE_PROOF = process.env.PUBMAX_UPDATE_INVITE_MAP_PROOF === "1";
const PROOF_DIR = "docs/proof/mobile-invite-map-handoff";

type Rgb = [number, number, number];

function cssRgb(value: string): Rgb {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported colour: ${value}`);
  return channels as Rgb;
}

function relativeLuminance([red, green, blue]: Rgb): number {
  const channel = (value: number) => {
    const normal = value / 255;
    return normal <= 0.04045 ? normal / 12.92 : ((normal + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);
}

function contrastRatio(foreground: Rgb, background: Rgb): number {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
    (left, right) => right - left,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

async function createInvite(
  request: APIRequestContext,
  stopCount = 3,
): Promise<{ token: string; venues: Venue[] }> {
  const venues = ((await (await request.get("/data/venues_slim.json")).json()) as Venue[]).slice(0, stopCount);
  expect(venues).toHaveLength(stopCount);

  const created = await request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: "Mobile invite map handoff",
      startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      creatorName: "Karan",
      stops: venues.map((venue) => ({ venueId: venue.id, venueName: venue.name })),
    },
  });
  expect(created.ok()).toBe(true);

  const id: string = ((await created.json()) as { plan: { plan: { id: string } } }).plan.plan.id;
  const state = (await (await request.get(`/api/plans/${id}`)).json()) as { inviteToken?: string | null };
  expect(state.inviteToken).toBeTruthy();

  return { token: state.inviteToken as string, venues };
}

async function captureAnalytics(page: Page): Promise<unknown[]> {
  const payloads: unknown[] = [];
  await page.route("**/api/events", async (route) => {
    const raw = route.request().postData();
    if (raw) payloads.push(JSON.parse(raw));
    await route.fulfill({ status: 204, headers: { "cache-control": "no-store" } });
  });
  return payloads;
}

test("guest RSVP reveals one ordered map handoff that fits mobile", async ({ request, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmaxx:analytics-consent:v1", "granted");
  });
  const analytics = await captureAnalytics(page);
  const { token, venues } = await createInvite(request);

  await page.goto(`/invite/${token}`);
  // Exactly one map link on the page, and it is the RSVP island's. The stops
  // are why the invite was opened, so the way to them is never gated on an
  // RSVP; only the "RSVP saved." emphasis waits for an answer.
  await expect(page.locator(".invite__mapLink")).toHaveCount(1);
  await expect(page.getByRole("link", { name: "Open these stops on the map" })).toHaveCount(1);
  await expect(page.getByText("RSVP saved.", { exact: true })).toHaveCount(0);
  if (UPDATE_PROOF) {
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
    await page.screenshot({ path: `${PROOF_DIR}/invite-before-rsvp-390-light.png`, fullPage: true });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
    });
  }

  await page.locator(".inviteRsvp__nameInput").fill("Priya");
  await page.getByRole("button", { name: "Going", exact: true }).click();
  await page.getByRole("button", { name: "RSVP", exact: true }).click();

  const guestRow = page.locator(".inviteRsvp__guest", { hasText: "Priya" });
  await expect(guestRow).toBeVisible();
  await expect(page.locator(".inviteRsvp__count").first()).toHaveText("1");

  const handoff = page.getByRole("link", { name: "Open these stops on the map" });
  await expect(handoff).toBeVisible();
  const handoffHref = await handoff.getAttribute("href");
  expect(handoffHref).not.toBeNull();
  const handoffUrl = new URL(handoffHref!, "http://localhost");
  expect(handoffUrl.pathname).toBe("/map");
  expect(handoffUrl.searchParams.get("mode")).toBe("build");
  expect(handoffUrl.searchParams.get("pubs")).toBe(
    venues.map((venue) => venue.id).join(","),
  );
  const handoffColours = await handoff.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor };
  });
  expect(
    contrastRatio(cssRgb(handoffColours.foreground), cssRgb(handoffColours.background)),
  ).toBeGreaterThanOrEqual(4.5);
  if (UPDATE_PROOF) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await handoff.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${PROOF_DIR}/invite-after-rsvp-390-dark.png` });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "light";
    });
  }

  for (const width of [390, 320, 430]) {
    await page.setViewportSize({ width, height: 844 });
    const handoffBox = await handoff.boundingBox();
    const formBox = await page.locator(".inviteRsvp__form").boundingBox();
    expect(handoffBox).not.toBeNull();
    expect(formBox).not.toBeNull();
    expect(handoffBox!.height).toBeGreaterThanOrEqual(44);
    expect(handoffBox!.width).toBeCloseTo(formBox!.width, 0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    if (UPDATE_PROOF) {
      await handoff.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${PROOF_DIR}/invite-after-rsvp-${width}-light.png` });
    }
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Maybe", exact: true }).click();
  await page.getByRole("button", { name: "RSVP", exact: true }).click();
  await expect(page.locator(".inviteRsvp__guest", { hasText: "Priya" })).toContainText("Maybe");
  await expect(page.locator(".inviteRsvp__count").first()).toHaveText("0");
  await expect(page.locator(".inviteRsvp__count").nth(1)).toHaveText("1");
  await expect(page.getByText("RSVP saved.", { exact: true })).toBeVisible();
  await expect(handoff).toBeVisible();
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  await page.getByRole("button", { name: "RSVP", exact: true }).press("Tab");
  await expect(handoff).toBeFocused();
  const focusColours = await handoff.evaluate((element) => {
      const style = window.getComputedStyle(element);
      const card = element.closest(".invite__mat");
      return {
        visible: style.outlineStyle !== "none" && style.outlineWidth !== "0px",
        outline: style.outlineColor,
        shadow: style.boxShadow,
        surface: card ? window.getComputedStyle(card).backgroundColor : "",
      };
    });
  expect(focusColours.visible).toBe(true);
  expect(contrastRatio(cssRgb(focusColours.outline), cssRgb(focusColours.surface))).toBeGreaterThanOrEqual(3);
  expect(focusColours.shadow).toContain("rgb(255, 90, 95)");
  if (UPDATE_PROOF) {
    await handoff.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${PROOF_DIR}/invite-map-focus-390-light.png` });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await handoff.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${PROOF_DIR}/invite-after-rsvp-390-reduced-motion.png` });
  }

  await handoff.click();
  await expect(page).toHaveURL((url) =>
    url.pathname === "/map" &&
    url.searchParams.get("mode") === "build" &&
    url.searchParams.get("pubs") === venues.map((venue) => venue.id).join(","),
  );
  await expect.poll(() => analytics.filter((payload) => (
    payload && typeof payload === "object"
    && (payload as { name?: unknown }).name === "invite_map_opened"
  )).length).toBe(1);

  // Returning guest: the answer is remembered on this device, so the saved
  // emphasis comes back with the link rather than the page reading as if they
  // had never RSVP'd.
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/invite/${token}$`));
  await expect(handoff).toHaveCount(1);
  await expect(page.getByText("RSVP saved.", { exact: true })).toBeVisible();

  // A fresh device has no memory of the answer, and still reaches the stops.
  const stranger = await page.context().browser()!.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.setViewportSize({ width: 390, height: 844 });
  await strangerPage.goto(`/invite/${token}`);
  await expect(
    strangerPage.getByRole("link", { name: "Open these stops on the map" }),
  ).toHaveCount(1);
  await expect(strangerPage.getByText("RSVP saved.", { exact: true })).toHaveCount(0);
  await stranger.close();
});

test("Maybe RSVP reveals the canonical one-stop map handoff", async ({ request, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { token, venues } = await createInvite(request, 1);

  await page.goto(`/invite/${token}`);
  await page.locator(".inviteRsvp__nameInput").fill("Sam");
  await page.getByRole("button", { name: "Maybe", exact: true }).click();
  await page.getByRole("button", { name: "RSVP", exact: true }).click();

  await expect(page.getByText("RSVP saved.", { exact: true })).toBeVisible();
  const handoff = page.getByRole("link", { name: "Open these stops on the map" });
  await expect(handoff).toHaveAttribute("href", `/map?sel=${encodeURIComponent(venues[0]!.id)}`);
});

test("failed guest RSVP stays on invite without a map handoff", async ({ request, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { token } = await createInvite(request);

  await page.route(/\/api\/invite\/[^/]+\/rsvp$/, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "temporarily unavailable" }),
    });
  });

  await page.goto(`/invite/${token}`);
  await expect(page.locator(".invite__mapLink")).toHaveCount(1);
  await page.locator(".inviteRsvp__nameInput").fill("Priya");
  await page.getByRole("button", { name: "Maybe", exact: true }).click();
  await page.getByRole("button", { name: "RSVP", exact: true }).click();

  await expect(page.locator(".inviteRsvp__error")).toHaveText("Couldn't save that RSVP.");
  // The refusal takes the saved emphasis, never the way to the stops.
  await expect(page.getByText("RSVP saved.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open these stops on the map" })).toHaveCount(1);
  await expect(page.locator(".inviteRsvp__guest", { hasText: "Priya" })).toHaveCount(0);
});

test("guest RSVP rejects a success response without a valid summary", async ({ request, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { token } = await createInvite(request);

  await page.route(/\/api\/invite\/[^/]+\/rsvp$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ summary: {} }),
    });
  });

  await page.goto(`/invite/${token}`);
  await page.locator(".inviteRsvp__nameInput").fill("Priya");
  await page.getByRole("button", { name: "Going", exact: true }).click();
  await page.getByRole("button", { name: "RSVP", exact: true }).click();

  await expect(page.locator(".inviteRsvp__error")).toHaveText("Couldn't save that RSVP.");
  // The refusal takes the saved emphasis, never the way to the stops.
  await expect(page.getByText("RSVP saved.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open these stops on the map" })).toHaveCount(1);
  await expect(page.locator(".inviteRsvp__guest", { hasText: "Priya" })).toHaveCount(0);
});
