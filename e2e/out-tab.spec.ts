import { mkdirSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const WIDTHS = [320, 390, 430] as const;
const SHOTS_DIR = "docs/screenshots/out-l1";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
    window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
  });
});

function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

/** Playwright globs match the full URL, so an /api/out pattern also matches /api/outage. */
function isOutListingsRequest(url: URL): boolean {
  return url.pathname === "/api/out";
}

// Three ordinary links behind a disclosure, so they are found as links. Scoped
// to the sheet itself: /out prints its own "Start a plan" way out under Open
// plans, and a page-wide role query matches both.
function createRow(page: Page, name: string) {
  return page.locator(".createFabMenu").getByRole("link", { name, exact: true });
}

async function openCreateMenu(page: Page) {
  const create = page.getByTestId("create-fab");
  await expect(create).toBeVisible();
  // A plain click on purpose: the actionability and occlusion checks ARE the
  // proof that the control and its sheet are clear of the tab bar at every
  // phone width. A forced click would pass through whatever covered them.
  await create.click();
  await expect(createRow(page, "Post a moment")).toBeVisible();
}

for (const width of WIDTHS) {
  test.describe(`out tab @${width}`, () => {
    test.use({ viewport: { width, height: 844 } });

    test("shows the Out tab, renders /out, and the create action reaches each row", async ({
      page,
    }) => {
      test.setTimeout(90_000);
      await page.goto("/out");
      const out = primaryNav(page).getByRole("link", { name: "Out", exact: true });
      await expect(out).toBeVisible();
      await expect(out).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("out-screen")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Out", exact: true })).toBeVisible();
      // The day chips are LINKS, not radios: each is a destination, so they keep
      // the link role and say where they are with aria-current.
      const when = page.getByRole("navigation", { name: "When" });
      const tonightChip = when.getByRole("link", { name: "Tonight", exact: true });
      await expect(tonightChip).toBeVisible();
      await expect(tonightChip).toHaveAttribute("aria-current", "page");
      // Space activates a focused chip the way Enter does.
      const weekendChip = when.getByRole("link", { name: "Weekend", exact: true });
      await weekendChip.focus();
      await page.keyboard.press(" ");
      await page.waitForURL(/\/out\?day=weekend$/);
      await expect(
        when.getByRole("link", { name: "Weekend", exact: true }),
      ).toHaveAttribute("aria-current", "page");
      // The heading names the window the chip selected, so the list never sits
      // under another night's name.
      await expect(
        page.getByRole("heading", { name: "What's on the weekend", exact: true }),
      ).toBeVisible();
      await page.goto("/out");

      // Listings land first; open plans stay a quieter lane below.
      const listings = page.getByRole("region", { name: "What's on tonight" });
      await expect(listings).toBeVisible();
      await expect(
        listings.getByRole("heading", { name: "What's on tonight", exact: true }),
      ).toBeVisible();

      // Open plans stays hidden when no sendable plan lands.
      await expect(page.getByRole("region", { name: "Open plans" })).toHaveCount(0);

      // /out is not a crawlable family yet: it duplicates /tonight's baseline
      // rows, so it ships noindex with no canonical of its own.
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        /noindex/,
      );
      await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);

      await openCreateMenu(page);
      await createRow(page, "Post a moment").click();
      await page.waitForURL(/\/moment\?returnTo=/);

      await page.goto("/out");
      await openCreateMenu(page);
      await createRow(page, "Log a price").click();
      await page.waitForURL(/\/map\?log=1/, { timeout: 45_000 });

      await page.goto("/out");
      await openCreateMenu(page);
      await createRow(page, "Start a plan").click();
      await page.waitForURL(/\/plan$/);
      // The action is mounted in the root layout, so a client-side navigation
      // leaves it mounted: a sheet nobody closed stays painted over wherever it
      // sent you.
      await expect(createRow(page, "Start a plan")).toHaveCount(0);
    });
  });
}

const PLAYHOUSE_EVENT = {
  id: "events-tm-playhouse",
  placeName: "Soho Theatre",
  kind: "event",
  startsAt: "2026-08-16T19:00:00.000Z",
  title: "A Night at the Playhouse",
  source: { label: "Ticketmaster", url: "https://www.ticketmaster.co.uk/event/1" },
  observedAt: "2026-08-16T09:00:00.000Z",
  confidence: "listed",
  sourceId: "1",
};

test(
  "shows matched event cards and drops unmatched rows when GET /api/out is ready",
  async ({ page }) => {
    await page.route(isOutListingsRequest, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ready",
          events: [
            {
              ...PLAYHOUSE_EVENT,
              venueId: "venue-playhouse",
            },
            {
              ...PLAYHOUSE_EVENT,
              id: "events-tm-unmatched-playhouse",
              title: "Unmatched Playhouse",
              placeName: "The O2",
            },
          ],
          openPlans: [],
          attribution: [],
          observedAt: {},
          providers: [{ name: "ticketmaster", configured: true, rows: 2, status: "ready" }],
          venueMatch: "ready",
        }),
      }),
    );

    await page.goto("/out");
    await expect(page.getByTestId("out-screen")).toBeVisible();
    await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "A Night at the Playhouse" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Unmatched Playhouse" })).toHaveCount(0);
    // The hidden row is counted and credited, while place names stay hidden
    // beside the matched venue card.
    const notice = page.getByTestId("out-unmatched-notice");
    await expect(notice).toContainText(
      "1 more listing tonight is at a place we don't list yet.",
    );
    await expect(notice).not.toContainText("The O2");
    const listings = page.getByRole("region", { name: "What's on tonight" });
    await expect(listings).toBeVisible();
    await expect(page.getByRole("region", { name: "Open plans" })).toHaveCount(0);
  },
);

// The supply truth on a phone: rows exist, none is at a listed pub. The page
// has to say how many, name the places, credit the provider, and hand the
// reader somewhere to go - and say something different again when the match
// could not run, or when the providers returned nothing at all.
test.describe("out supply honesty @390", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  const ARENAS = ["Jazz Cafe", "Up The Creek", "Soul Mama", "The Comedy Store"];

  function unmatchedPayload(venueMatch: "ready" | "unavailable" | undefined) {
    return {
      status: "ready",
      listingsStatus: "ready",
      events: ARENAS.map((placeName, index) => ({
        ...PLAYHOUSE_EVENT,
        id: `events-tm-arena-${index}`,
        sourceId: `arena-${index}`,
        title: `Show ${index + 1}`,
        placeName,
      })),
      openPlans: [],
      attribution: [{ label: "Ticketmaster", logoRequired: false, url: "https://www.ticketmaster.co.uk/" }],
      observedAt: {},
      providers: [{ name: "ticketmaster", configured: true, rows: 4, status: "ready" }],
      ...(venueMatch ? { venueMatch } : {}),
    };
  }

  test("counts and names the unlisted places, credits the provider, and offers a way out", async ({
    page,
  }) => {
    await page.route(isOutListingsRequest, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(unmatchedPayload("ready")),
      }),
    );

    await page.goto("/out");
    await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
    const notice = page.getByTestId("out-unmatched-notice");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("4 listings tonight are at places we don't list yet.");
    await expect(notice).toContainText("Jazz Cafe, Up The Creek, Soul Mama and The Comedy Store.");
    await expect(notice.getByRole("link", { name: "Ticketmaster", exact: true })).toHaveAttribute(
      "href",
      "https://www.ticketmaster.co.uk/",
    );
    await expect(
      notice.getByRole("link", { name: "See what else is on tonight", exact: true }),
    ).toHaveAttribute("href", "/tonight");
    // No card for a row with no pub, and no bare status line either.
    await expect(page.getByRole("heading", { name: "Show 1" })).toHaveCount(0);
    await expect(page.getByText("No listings for this day yet.")).toHaveCount(0);
    await expect(page.getByText(/^Some /)).toHaveCount(0);
    // The notice fits the phone: nothing pushes the page wider than the viewport.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("says the check could not run rather than calling the places unlisted", async ({ page }) => {
    await page.route(isOutListingsRequest, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(unmatchedPayload("unavailable")),
      }),
    );

    await page.goto("/out");
    await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
    const notice = page.getByTestId("out-unmatched-notice");
    await expect(notice).toContainText(
      "We couldn't check which of tonight's 4 listings are at a pub we list.",
    );
    await expect(notice).not.toContainText("don't list yet");
  });

  test("keeps the honest empty state when the providers return nothing", async ({ page }) => {
    await page.route(isOutListingsRequest, (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "ready",
          listingsStatus: "ready",
          events: [],
          openPlans: [],
          attribution: [],
          observedAt: {},
          providers: [{ name: "ticketmaster", configured: true, rows: 0, status: "ready" }],
          venueMatch: "ready",
        }),
      }),
    );

    await page.goto("/out");
    await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText("No listings for this day yet.")).toBeVisible();
    await expect(page.getByTestId("out-unmatched-notice")).toHaveCount(0);
  });
});

function sendableOpenPlan(id: string, title: string) {
  return {
    crewId: id,
    title,
    startTime: "2026-08-16T19:00:00.000Z",
    stopVenueId: "venue-test",
    stopVenueName: "The Test Arms",
    hostHandle: "karan",
    memberCount: 2,
    meetingPoint: {
      kind: "venue",
      name: "The Test Arms",
      lat: 51.5,
      lng: -0.1,
    },
  };
}

const PUBLIC_CREW_ID = "50000000-0000-4000-8000-000000000001";

test("shows Open plans when one sendable plan exists", async ({ page }) => {
  await page.route(isOutListingsRequest, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [],
        openPlans: [sendableOpenPlan(PUBLIC_CREW_ID, "Camden crawl")],
        attribution: [],
        observedAt: {},
        providers: [{ name: "ticketmaster", configured: true, rows: 0, status: "ready" }],
      }),
    }),
  );

  await page.goto("/out");
  const plans = page.getByRole("region", { name: "Open plans" });
  await expect(plans).toBeVisible();
  await expect(plans.getByRole("heading", { name: "Camden crawl" })).toBeVisible();
  await expect(plans.getByRole("link", { name: "Start a plan", exact: true })).toHaveAttribute(
    "href",
    "/plan",
  );

  await page.route(`**/api/social/crews/${PUBLIC_CREW_ID}/public`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        kind: "public",
        crewId: PUBLIC_CREW_ID,
        title: "Camden crawl",
        hostHandle: "karan",
        startsAt: "2026-08-16T19:00:00.000Z",
        meetingPoint: {
          kind: "venue",
          name: "The Test Arms",
          lat: 51.5,
          lng: -0.1,
        },
      }),
    }),
  );
  await plans.getByRole("link", { name: /Camden crawl/ }).click();
  await expect(page.getByRole("heading", { name: "Camden crawl", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Meet at", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Ask to join", exact: true })).toBeVisible();
});

test("groups desktop listings and pairs a pub beside each gig", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route(isOutListingsRequest, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [
          {
            ...PLAYHOUSE_EVENT,
            venueId: "venue-soho-theatre",
          },
        ],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [{ name: "ticketmaster", configured: true, rows: 1, status: "ready" }],
      }),
    }),
  );

  await page.goto("/out");
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: "Soho Theatre", exact: true })).toBeVisible();
  await expect(page.getByText("No matching pub in PUBMAXX yet.")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open on map", exact: true })).toHaveAttribute(
    "href",
    /\/map\?sel=venue-soho-theatre/,
  );
});

test("starts each desktop listing group at the top of its grid row", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(isOutListingsRequest, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ready",
        events: [
          {
            ...PLAYHOUSE_EVENT,
            id: "events-tm-marylebone",
            title: "Marylebone one-off",
            placeName: "The Arts at Marble Arch",
            venueId: "venue-marylebone",
          },
          ...Array.from({ length: 5 }, (_, index) => ({
            ...PLAYHOUSE_EVENT,
            id: `events-tm-soho-${index}`,
            sourceId: `soho-${index}`,
            title: `Soho event ${index + 1}`,
            venueId: "venue-soho-theatre",
          })),
        ],
        openPlans: [],
        attribution: [],
        observedAt: {},
        providers: [{ name: "ticketmaster", configured: true, rows: 6, status: "ready" }],
      }),
    }),
  );

  await page.goto("/out");
  await expect(page.getByTestId("listings-skeleton")).toHaveCount(0, { timeout: 10_000 });

  const maryleboneTop = await page
    .getByRole("heading", { name: "Marylebone one-off", exact: true })
    .boundingBox();
  const sohoTop = await page
    .getByRole("heading", { name: "Soho event 1", exact: true })
    .boundingBox();

  expect(maryleboneTop).not.toBeNull();
  expect(sohoTop).not.toBeNull();
  expect(Math.abs(maryleboneTop!.y - sohoTop!.y)).toBeLessThan(24);
});

test.describe("out tab screenshots @390", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test.setTimeout(60_000);

  test("commits light and dark 390 frames", async ({ page }) => {
    mkdirSync(SHOTS_DIR, { recursive: true });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/out");
    await expect(page.getByTestId("out-screen")).toBeVisible();
    await page.screenshot({ path: `${SHOTS_DIR}/out-390-light.png`, fullPage: false });

    const theme = page.getByRole("button", { name: /switch to dark theme/i });
    if (await theme.isVisible()) {
      await theme.click();
    }
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.getByTestId("out-screen")).toBeVisible();
    await page.screenshot({ path: `${SHOTS_DIR}/out-390-dark.png`, fullPage: false });
  });
});
