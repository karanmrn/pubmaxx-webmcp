import { expect, test } from "@playwright/test";

const INTENT_KEY = "pubmax:planning-intent:v1";
const ROUTE_DRAFT_KEY = "pubmaxx:plan-route-draft:v1";
const VIEWPORT = { width: 390, height: 844 };

function futureLondonFirstPint(): string {
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
  const lookup = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${lookup("year")}-${lookup("month")}-${lookup("day")}T${lookup("hour")}:${lookup("minute")}`;
}

test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize(VIEWPORT);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    localStorage.setItem("pubmax-tour-v1-done", "1");
    localStorage.setItem("pubmax_onboarding_dismissed", "1");
    sessionStorage.setItem("pubmax_onboarding_dismissed", "1");
  });
});

test("held pub shows one describe box, names the area, and release un-anchors while keeping the city", async ({ page }) => {
  const creates: unknown[] = [];
  await page.route("**/api/plans", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const raw = route.request().postData();
    if (raw) creates.push(JSON.parse(raw));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan: {
          plan: { id: "11111111-1111-4111-8111-111111111111" },
          stops: [],
        },
        created: true,
        grounded: false,
      }),
    });
  });

  await page.addInitScript(([intentKey, routeKey]) => {
    const now = Date.now();
    sessionStorage.setItem(intentKey, JSON.stringify({
      version: 1,
      source: "near",
      cityId: "manchester",
      acceptedVenueId: "venue-held",
      acceptedArea: { kind: "night-patch", id: "clapham" },
      startsAt: new Date(now + 60 * 60 * 1000).toISOString(),
      displayEvidence: { kind: "directory", observedAt: null },
      acceptedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
    }));
    localStorage.setItem(routeKey, JSON.stringify({
      stops: [
        { key: 1, venueId: "venue-held", venueName: "The Coach & Horses", alternatives: [] },
        { key: 2, venueId: "venue-two", venueName: "Second Stop", alternatives: [] },
        { key: 3, venueId: "venue-three", venueName: "Third Stop", alternatives: [] },
      ],
      nightContext: null,
      routeRevision: 1,
      routeStale: false,
      groundingProof: "signed-proof",
      createOperationKey: "operation-key",
      planAnchor: { venueId: "venue-held", source: "near", outcome: "route" },
    }));
  }, [INTENT_KEY, ROUTE_DRAFT_KEY] as const);

  await page.goto("/plan");
  await expect(page.getByRole("region", { name: "Accepted plan context" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Accepted plan context" }).getByText("Clapham")).toBeVisible();
  await expect(page.getByRole("region", { name: "Accepted plan context" }).getByText("clapham", { exact: true })).toHaveCount(0);

  await expect(page.getByRole("textbox", { name: "Describe the outing" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Make a plan" })).toHaveCount(1);

  await page.getByRole("button", { name: "Release this pub" }).click();
  await expect(page.locator("#plan-route-status")).toHaveText(
    "Released The Coach & Horses. Stop 1 is yours to change.",
  );
  await expect(page.locator("#plan-route-status")).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Describe the outing" })).toHaveCount(2);

  await expect.poll(async () => {
    const raw = await page.evaluate((routeKey) => localStorage.getItem(routeKey), ROUTE_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { planAnchor?: unknown; groundingProof?: unknown };
    return {
      planAnchor: parsed.planAnchor ?? null,
      groundingProof: parsed.groundingProof ?? null,
    };
  }).toEqual({ planAnchor: null, groundingProof: null });

  await page.getByLabel("Your name").fill("Karan");
  await page.getByLabel("First pint").fill(futureLondonFirstPint());
  await expect(page.getByRole("button", { name: "Lock it in" })).toBeEnabled();
  await page.getByRole("button", { name: "Lock it in" }).click();
  await expect.poll(() => creates.length).toBeGreaterThan(0);
  expect(creates[0]).toMatchObject({ cityId: "manchester" });
  expect(creates[0]).not.toHaveProperty("anchor");
  expect(creates[0]).not.toHaveProperty("groundingProof");
  expect((creates[0] as { stops: unknown[] }).stops).toHaveLength(3);
});

test("Keep on Near then Make it Stop 1 shows one describe box and names the area", async ({ page }) => {
  await page.goto("/near?patch=clapham");
  await expect(page.locator(".nmnAccept").first()).toBeVisible();
  await page.locator(".nmnAccept").first().click();
  await expect(page).toHaveURL(/[?&]accept=1(&|$)/);

  const acceptStop1 = page
    .locator('.mobileSheetPortal[data-sheet-kind="venue"]')
    .getByRole("button", { name: /^Make .+ Stop 1$/ });
  await expect(acceptStop1).toBeVisible({ timeout: 30_000 });
  await acceptStop1.click();
  await expect(page).toHaveURL(/\/plan$/);

  const accepted = page.getByRole("region", { name: "Accepted plan context" });
  await expect(accepted).toBeVisible();
  await expect(accepted.getByText("Clapham")).toBeVisible();
  await expect(accepted.getByText("clapham", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Describe the outing" })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Make a plan" })).toHaveCount(1);

  await page.getByRole("button", { name: "Release this pub" }).click();
  await expect(page.locator("#plan-route-status")).toContainText(
    "Stop 1 is yours to change.",
  );
  await expect(page.locator("#plan-route-status")).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Describe the outing" })).toHaveCount(2);
});
