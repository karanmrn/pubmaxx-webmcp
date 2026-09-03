import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const INTENT_KEY = "pubmax:planning-intent:v1";
const CARRIED = "Carried over from what you accepted";

async function firstVenue(request: APIRequestContext) {
  const venues = ((await (await request.get("/data/venues_slim.json")).json()) as { rows: Array<{
    id: string;
    name: string;
  }> }).rows;
  const venue = venues[0];
  expect(venue).toBeTruthy();
  return venue!;
}

async function seedAcceptedVenue(
  page: Page,
  venue: { id: string; name: string },
) {
  await page.addInitScript(
    ([accepted, key]) => {
      const now = Date.now();
      window.sessionStorage.setItem(key, JSON.stringify({
        version: 1,
        source: "near",
        cityId: "london",
        acceptedVenueId: accepted.id,
        acceptedArea: { kind: "night-patch", id: "soho" },
        startsAt: null,
        displayEvidence: { kind: "price", observedAt: null },
        acceptedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
      }));
    },
    [venue, INTENT_KEY] as const,
  );
}

test("accepted Venue becomes visible Stop 1 on the permanent Plan path", async ({ page, request }) => {
  const venue = await firstVenue(request);
  await seedAcceptedVenue(page, venue);

  await page.goto("/plan");
  await expect(page.getByText(CARRIED)).toBeVisible();
  await expect(page.getByLabel("Venue name").first()).toHaveValue(venue!.name);
  await expect(page.getByText(venue!.name).first()).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Venue name").first()).toHaveValue(venue!.name);
});

test("existing Plan work wins without consuming a newer accepted Venue", async ({ page }) => {
  const existing = { id: "venue-xjf3n0", name: "Arnos Arms" };
  const accepted = { id: "venue-122cuu1", name: "The Queen’s Head" };
  const planId = "22222222-2222-4222-8222-222222222222";
  await page.addInitScript(([intentKey, existingVenue, acceptedVenue]) => {
    const now = Date.now();
    const startTime = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Europe/London",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(now + 3 * 60 * 60 * 1000)).replace(" ", "T");
    sessionStorage.setItem("pubmaxx:plan-draft:v1", JSON.stringify({
      title: "Saved night",
      creatorName: "",
      startTime,
      conciergeQuery: "",
      stops: [
        { key: 1, venueId: existingVenue.id, venueName: existingVenue.name },
        { key: 2, venueId: "venue-phqazo", venueName: "The Lyric" },
        { key: 3, venueId: "venue-11iolkd", venueName: "The Crown" },
      ],
    }));
    sessionStorage.setItem(intentKey, JSON.stringify({
      version: 1,
      source: "near",
      cityId: "london",
      acceptedVenueId: acceptedVenue.id,
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
      acceptedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    }));
  }, [INTENT_KEY, existing, accepted] as const);
  await page.route("**/api/plans", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan: { plan: { id: planId } },
        created: true,
        grounded: false,
      }),
    });
  });

  await page.goto("/plan");
  await expect(page.getByLabel("Venue name").first()).toHaveValue(existing.name);
  await expect(page.getByText(
    "Kept existing Plan work instead of replacing it with a newer Venue acceptance.",
  )).toBeVisible();
  await expect(page.getByLabel("Venue name").first()).not.toHaveValue(accepted.name);
  await page.getByLabel("Your name").fill("Karan");
  await page.getByRole("button", { name: "Lock it in" }).click();

  await expect(page).toHaveURL(new RegExp(`/plan/${planId}`));
  expect(await page.evaluate((key) => sessionStorage.getItem(key), INTENT_KEY)).not.toBeNull();
});

test("successful Plan creation consumes accepted Venue intent", async ({ page, request }) => {
  const venue = await firstVenue(request);
  await seedAcceptedVenue(page, venue);
  const planId = "11111111-1111-4111-8111-111111111111";
  await page.route("**/api/plans", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan: { plan: { id: planId } },
        created: true,
        grounded: false,
      }),
    });
  });

  await page.goto("/plan");
  await expect(page.getByLabel("Venue name").first()).toHaveValue(venue.name);
  await page.getByLabel("Your name").fill("Karan");
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock it in" }).click();

  await expect(page).toHaveURL(new RegExp(`/plan/${planId}`));
  expect(await page.evaluate((key) => sessionStorage.getItem(key), INTENT_KEY)).toBeNull();
});

test("failed Plan creation retains accepted Venue intent", async ({ page, request }) => {
  const venue = await firstVenue(request);
  await seedAcceptedVenue(page, venue);
  await page.route("**/api/plans", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: { message: "Could not create the Plan." } }),
    });
  });

  await page.goto("/plan");
  await expect(page.getByLabel("Venue name").first()).toHaveValue(venue.name);
  await page.getByLabel("Your name").fill("Karan");
  await page.getByRole("button", { name: "Lock it in" }).click();

  await expect(page.locator(".planComposer__error")).toContainText("Could not create the Plan.");
  expect(await page.evaluate((key) => sessionStorage.getItem(key), INTENT_KEY)).not.toBeNull();
});
