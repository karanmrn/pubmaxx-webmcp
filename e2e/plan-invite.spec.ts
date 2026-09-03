import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Task: plan-invite-page. Proves the whole public invite feature end to end on
// the production build: a real Plan's member-only invite token (exposed via
// GET /api/plans/[id]'s member branch), the public /invite/[token] render, and
// a genuine handle-free RSVP write driven through the rendered UI - not a bare
// API call - so the client island and the server route are both proven live.

const PLAN_TITLE = "Karan invite spec crawl";
const HOST_NAME = "Karan";

test("public invite page renders a Plan and accepts a handle-free RSVP", async ({ request, page }) => {
  const venues = ((await (await request.get("/data/venues_slim.json")).json() as { rows: Array<{
    id: string;
    name: string;
    cheapestPrice: number | null;
  }> }).rows).slice(0, 3);
  expect(venues.length).toBe(3);

  const created = await request.post("/api/plans", {
    headers: { "idempotency-key": randomUUID() },
    data: {
      title: PLAN_TITLE,
      startTime: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      creatorName: HOST_NAME,
      stops: venues.map((v) => ({ venueId: v.id, venueName: v.name })),
    },
  });
  expect(created.ok()).toBe(true);
  const id: string = (await created.json()).plan.plan.id;

  // The creating request context keeps the HttpOnly plan-member-session
  // cookie, so this read comes back on the "member" branch of
  // resolvePlanProjection and carries the real inviteToken.
  const state = await (await request.get(`/api/plans/${id}`)).json() as { inviteToken?: string | null };
  expect(state.inviteToken).toBeTruthy();
  const token = state.inviteToken as string;

  // The public page itself: a genuinely anonymous browser context, no member
  // cookie, exactly like an uninvited link recipient.
  await page.goto(`/invite/${token}`);
  await expect(page.locator(".invite__title")).toHaveText(PLAN_TITLE);
  await expect(page.locator(".invite__eyebrow")).toContainText(HOST_NAME);
  await expect(page.locator(".invite__stop")).toHaveCount(3);
  for (const venue of venues) {
    await expect(page.locator(".invite__stop", { hasText: venue.name })).toBeVisible();
  }
  // Honesty check: formatPrice(null) returns the literal string "No price",
  // which must never render as if it were a real figure.
  await expect(page.locator(".invite")).not.toContainText("No price");

  // No RSVPs yet - the honest empty state, not a fake number.
  await expect(page.locator(".inviteRsvp__empty")).toHaveText("No RSVPs yet. Be the first.");
  await expect(page.locator(".inviteRsvp__count").first()).toHaveText("0");

  // Drive the actual RSVP write through the rendered client island.
  const guestName = "Priya";
  await page.locator(".inviteRsvp__nameInput").fill(guestName);
  await page.getByRole("button", { name: "Going", exact: true }).click();
  await page.getByRole("button", { name: "RSVP", exact: true }).click();

  const guestRow = page.locator(".inviteRsvp__guest", { hasText: guestName });
  await expect(guestRow).toBeVisible();
  await expect(guestRow.locator(".inviteRsvp__guestStatus")).toHaveText("Going");
  await expect(page.locator(".inviteRsvp__count").first()).toHaveText("1");
  await expect(page.locator(".inviteRsvp__empty")).toHaveCount(0);

  // Reload proves the write actually persisted server-side, not just local state.
  await page.reload();
  await expect(page.locator(".inviteRsvp__guest", { hasText: guestName })).toBeVisible();
  await expect(page.locator(".inviteRsvp__count").first()).toHaveText("1");

  // Emoji reaction round-trip too.
  await page.getByRole("button", { name: "Cheers" }).click();
  await expect(page.getByRole("button", { name: "Cheers" })).toHaveAttribute("aria-pressed", "true");
});

test("an unknown invite token renders the honest not-found state", async ({ page }) => {
  await page.goto("/invite/000000000000000000000000000000ff");
  await expect(page.locator(".invite__emptyTitle")).toHaveText("This invite link isn’t valid");
});

// Task: plan-invite-host-ui. PlanHostInviteLink only ever renders once the
// browser has resolved a live capability AND fetched a real inviteToken
// (components/plan/PlanHostInviteLink.tsx returns null until then) — there is
// no Vitest render harness for UI components in this codebase
// (vitest.config.ts), so this is the proof that the control's gating actually
// holds in a real browser. The host capability only lives in the creating
// tab's in-memory session (lib/planSessionCapability.ts, set client-side at
// plan creation), so the host must be driven through the actual composer UI —
// a Plan created via a bare API call, as the other test in this file does,
// never populates that memory.
async function futureLondonFirstPint(): Promise<string> {
  // datetime-local value in Europe/London, at least an hour ahead so lock stays enabled.
  const when = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(when);
  const lookup = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}T${lookup("hour")}:${lookup("minute")}`;
}

async function openHydratedPlanComposer(page: Page): Promise<void> {
  await page.goto("/plan");
  const stopCount = page
    .getByRole("group", { name: "Number of pub stops" })
    .getByRole("button", { name: "4", exact: true });
  // A tap that lands before React attaches is dropped, and a lone click is
  // therefore not a wait for hydration: under a loaded box the button answered
  // "aria-pressed=false" for the whole assertion budget. Retry the tap itself
  // until the control answers.
  await expect(async () => {
    await stopCount.click();
    await expect(stopCount).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass({ timeout: 20_000 });
}

test("Copy invite link shows for the host's own session and never for an anonymous visitor", async ({
  page,
  browser,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    // The identity nudge (lib/identityNudge.ts) fires after the first
    // qualifying plan action — a real signed-out UX, but noise for this test,
    // which only cares about the invite-link control. Pre-dismissing it keeps
    // the cooldown gate shut, the same way it would for a returning visitor.
    window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
  });
  await openHydratedPlanComposer(page);
  await page.getByLabel("Describe the outing").fill("Quiet in Clapham for 4, not pricey");
  await page.getByRole("button", { name: "Make a plan" }).click();
  await expect(page.getByRole("combobox", { name: /Area/i })).toHaveValue("clapham");
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await page.getByLabel("Your name").fill("Karan");
  // Evening defaults can land in the past after ~19:00 London; a past First
  // pint keeps Lock disabled. Setting a future time marks the route stale, so
  // regenerate before locking.
  await page.getByLabel("First pint").fill(await futureLondonFirstPint());
  await page.getByRole("button", { name: "Regenerate route" }).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}(?:#share)?$/);

  // Inevitable next step: WhatsApp is the primary CTA after lock-in.
  await expect(page.getByRole("link", { name: "Send on WhatsApp" })).toBeVisible();

  // The host's own tab: the control appears once capability + inviteToken resolve.
  const copyButton = page.getByRole("button", { name: "Copy invite link" });
  await expect(copyButton).toBeVisible();
  await copyButton.click();
  await expect(page.locator(".planHostInviteLink__status")).toHaveText("Invite link copied.");

  // A genuinely anonymous visitor to the exact same URL never sees it — no
  // capability in this fresh browser context's memory, and the server page
  // itself only ever carries the privacy-safe preview.
  const anonymous = await browser.newContext();
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto(page.url().replace(/#.*$/, ""));
  await expect(anonymousPage.getByRole("heading", { name: /Who.s in/ })).toBeVisible();
  await expect(anonymousPage.getByRole("button", { name: "Copy invite link" })).toHaveCount(0);
  await anonymous.close();
});

test("invite loop: guest RSVP, host Remove via cookie path, guest map handoff", async ({
  page,
  browser,
}) => {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmax:identityNudge:dismissedAt:v1", String(Date.now()));
  });
  await openHydratedPlanComposer(page);
  await page.getByLabel("Describe the outing").fill("Quiet in Clapham for 4, not pricey");
  await page.getByRole("button", { name: "Make a plan" }).click();
  await expect(page.getByRole("combobox", { name: /Area/i })).toHaveValue("clapham");
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await page.getByLabel("Your name").fill("Karan");
  await page.getByLabel("First pint").fill(await futureLondonFirstPint());
  await page.getByRole("button", { name: "Regenerate route" }).click();
  await expect(page.getByText("Route refreshed. Review the preview")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}/);

  const copyButton = page.getByRole("button", { name: "Copy invite link" });
  await expect(copyButton).toBeVisible();
  await copyButton.click();
  await expect(page.locator(".planHostInviteLink__status")).toHaveText("Invite link copied.");

  // Read the invite URL from the host's capability projection (same cookie path
  // the Remove button will later use).
  const planUrl = page.url().replace(/#.*$/, "");
  const planId = planUrl.split("/plan/")[1]!;
  const state = await page.evaluate(async (id) => {
    const res = await fetch(`/api/plans/${id}`);
    return res.json() as Promise<{ inviteToken?: string | null }>;
  }, planId);
  expect(state.inviteToken).toBeTruthy();
  const token = state.inviteToken as string;

  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(`/invite/${token}`);
  // The page-level link moved into the RSVP island. It is still unconditional
  // there, so arriving without an RSVP still reaches the stops, and there is
  // exactly one of it.
  await expect(guestPage.locator(".invite__mapLink")).toHaveCount(1);
  await expect(
    guestPage.getByRole("link", { name: "Open these stops on the map" }),
  ).toBeVisible();

  await guestPage.locator(".inviteRsvp__nameInput").fill("Priya");
  await guestPage.getByRole("button", { name: "Going", exact: true }).click();
  await guestPage.getByRole("button", { name: "RSVP", exact: true }).click();
  await expect(guestPage.locator(".inviteRsvp__guest", { hasText: "Priya" })).toBeVisible();
  const joinedSession = await guestPage.evaluate(async (id) => {
    const response = await fetch(`/api/plans/${id}/session`, { cache: "no-store" });
    return response.json() as Promise<{ active?: boolean; role?: string }>;
  }, planId);
  expect(joinedSession).toMatchObject({ active: true, role: "guest" });

  await guestPage.getByRole("button", { name: "Maybe", exact: true }).click();
  await Promise.all([
    guestPage.waitForResponse((response) =>
      response.request().method() === "POST"
      && /\/api\/(?:invite\/[^/]+\/rsvp|plans\/[^/]+\/invite-rsvp)$/.test(new URL(response.url()).pathname),
    ),
    guestPage.getByRole("button", { name: "RSVP", exact: true }).click(),
  ]);
  const maybeSession = await guestPage.evaluate(async (id) => {
    const response = await fetch(`/api/plans/${id}/session`, { cache: "no-store" });
    return response.json() as Promise<{ active?: boolean }>;
  }, planId);
  expect(maybeSession.active).toBe(false);

  await guestPage.getByRole("button", { name: "Going", exact: true }).click();
  await Promise.all([
    guestPage.waitForResponse((response) =>
      response.request().method() === "POST"
      && /\/api\/(?:invite\/[^/]+\/rsvp|plans\/[^/]+\/invite-rsvp)$/.test(new URL(response.url()).pathname),
    ),
    guestPage.getByRole("button", { name: "RSVP", exact: true }).click(),
  ]);
  const rejoinedSession = await guestPage.evaluate(async (id) => {
    const response = await fetch(`/api/plans/${id}/session`, { cache: "no-store" });
    return response.json() as Promise<{ active?: boolean; role?: string }>;
  }, planId);
  expect(rejoinedSession).toMatchObject({ active: true, role: "guest" });

  // Guest map handoff.
  const mapLink = guestPage.getByRole("link", { name: "Open these stops on the map" });
  await expect(mapLink).toBeVisible();
  const mapHref = await mapLink.getAttribute("href");
  // Multi-stop invites open the ordered crawl; a single stop uses ?sel=.
  expect(mapHref).toMatch(/^\/map\?(?:mode=build&.*pubs=|sel=)/);
  await mapLink.click();
  await expect(guestPage).toHaveURL(/\/map\?(?:mode=build&.*pubs=|sel=)/);

  // Host revisits the invite page in the same context that created the plan
  // (HttpOnly member cookie Path=/api/plans/$id + in-memory capability).
  await page.goto(`/invite/${token}`);
  const removeButton = page.getByRole("button", { name: "Remove Priya" });
  await expect(removeButton).toBeVisible();
  await removeButton.click();
  await expect(page.locator(".inviteRsvp__guest", { hasText: "Priya" })).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".inviteRsvp__guest", { hasText: "Priya" })).toHaveCount(0);

  const removedSession = await guestPage.evaluate(async (id) => {
    const response = await fetch(`/api/plans/${id}/session`, { cache: "no-store" });
    return response.json() as Promise<{ active?: boolean }>;
  }, planId);
  expect(removedSession.active).toBe(false);

  await guestPage.goBack();
  await expect(guestPage).toHaveURL(new RegExp(`/invite/${inviteToken}$`));
  await guestPage.getByRole("button", { name: "Going", exact: true }).click();
  await guestPage.getByRole("button", { name: "RSVP", exact: true }).click();
  await expect(guestPage.locator(".inviteRsvp__guest", { hasText: "Priya" })).toBeVisible();
  const rejoinedAfterRemoval = await guestPage.evaluate(async (id) => {
    const response = await fetch(`/api/plans/${id}/session`, { cache: "no-store" });
    return response.json() as Promise<{ active?: boolean; role?: string }>;
  }, planId);
  expect(rejoinedAfterRemoval).toMatchObject({ active: true, role: "guest" });
  await guest.close();
});
