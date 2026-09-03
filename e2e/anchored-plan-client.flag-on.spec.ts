import { test, expect } from "@playwright/test";

// Historical flag-on project coverage retained as a second permanent-path
// check. PlanningIntent is now always consumed by the composer as the editable
// "Carried over" summary before intake.

const INTENT_KEY = "pubmax:planning-intent:v1";
const CARRIED = "Carried over from what you accepted";

test("permanent path: a seeded acceptance surfaces as the carried-over panel", async ({ page, request }) => {
  const venues = ((await (await request.get("/data/venues_slim.json")).json()) as { rows: Array<{ id: string; name: string }> }).rows;
  const venueId = venues[0]?.id;
  const venueName = venues[0]?.name;
  expect(typeof venueId).toBe("string");
  expect(typeof venueName).toBe("string");

  await page.addInitScript(
    ([id, key]) => {
      const now = Date.now();
      window.sessionStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          source: "near",
          cityId: "london",
          acceptedVenueId: id,
          acceptedArea: { kind: "night-patch", id: "soho" },
          startsAt: null,
          displayEvidence: { kind: "price", observedAt: null },
          acceptedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
        }),
      );
    },
    [venueId, INTENT_KEY] as const,
  );

  await page.goto("/plan");
  // The accepted context is consumed as an editable summary before intake.
  await expect(page.getByText(CARRIED)).toBeVisible();
  // The accepted Venue is carried into the summary (pre-answered, not re-asked).
  await expect(page.locator("body")).toContainText(venueName as string);
  await expect(page.locator("body")).not.toContainText(venueId as string);
});
