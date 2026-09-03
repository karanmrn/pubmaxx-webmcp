import { expect, test, type Page } from "@playwright/test";

async function installPwaPushRuntime(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalMatchMedia = window.matchMedia.bind(window);
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => query === "(display-mode: standalone)"
        ? {
            matches: true,
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent: () => false,
          }
        : originalMatchMedia(query),
    });

    let permissionRequests = 0;
    class FakeNotification {
      static permission: NotificationPermission = "default";
      static async requestPermission(): Promise<NotificationPermission> {
        permissionRequests += 1;
        FakeNotification.permission = "granted";
        return "granted";
      }
    }
    Object.defineProperty(window, "Notification", { configurable: true, value: FakeNotification });
    Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });

    const subscription = {
      toJSON: () => ({
        endpoint: "https://updates.push.services.mozilla.com/wpush/v2/e2e-token",
        expirationTime: null,
        keys: {
          p256dh: "e2ePublicKey_material",
          auth: "e2eAuthKey_material",
        },
      }),
    };
    const registration = {
      addEventListener() {},
      pushManager: {
        getSubscription: async () => null,
        subscribe: async () => subscription,
      },
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        ready: Promise.resolve(registration),
        register: async () => registration,
      },
    });
    Object.defineProperty(window, "__webPushPermissionRequests", {
      configurable: true,
      get: () => permissionRequests,
    });
  });
}

async function installSuccessfulPlanRoute(page: Page): Promise<void> {
  await page.route("**/api/plans/generate", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        stops: [
          { venueId: "venue-lrz4u2", venueName: "First Pub" },
          { venueId: "venue-1f5ygjb", venueName: "Second Pub" },
          { venueId: "venue-3h52h", venueName: "Third Pub" },
        ],
        inferredContext: {
          nightArea: "clapham",
          daypart: "evening",
          partyType: "friends",
          groupSize: 4,
          budget: "standard",
          budgetLimitPence: null,
          zeroProof: false,
          wetherspoonsPreferred: false,
          atmosphere: [],
          foodNeeds: [],
          accessibility: [],
          transportConstraints: [],
        },
        planningConfidence: {
          level: "high",
          score: 90,
          routeReady: true,
          missingEvidence: [],
          warnings: [],
          provenance: [{ kind: "night_area_review", label: "Reviewed Night Area" }],
        },
        budgetSummary: {
          currency: "GBP",
          limitPence: null,
          estimatedPerPersonPence: 1800,
          estimatedCrewPence: 7200,
          withinLimit: null,
          basis: "one-recorded-pint-per-stop",
        },
        routeTotals: {
          stopCount: 3,
          straightLineWalkingKm: 1.4,
          estimatedWalkingMinutes: 18,
          distanceBasis: "straight-line",
        },
        endingRecommendations: ["food", "get_home", "keep_going"].map((kind, index) => ({
          kind,
          label: ["Find food", "Get home", "Keep going"][index],
          reason: "Review the route ending before you commit.",
          preselected: kind === "get_home",
          requiresConfirmation: true,
          confidence: "high",
          warnings: [],
          options: [],
        })),
      }),
    });
  });
}

test("installed PWA asks for the honest London brief only after a useful plan action", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await installPwaPushRuntime(page);
  await installSuccessfulPlanRoute(page);

  let registrationBody: unknown = null;
  await page.route("**/api/push-tokens", async (route) => {
    registrationBody = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: "application/json", body: "{\"ok\":true}" });
  });

  await page.goto("/about");
  await page.evaluate(() => {
    window.localStorage.setItem("pubmax-tour-v1-done", "1");
    window.localStorage.removeItem("pubmax:webPush:enabled:v1");
    window.localStorage.removeItem("pubmax:webPush:dismissedSeq:v1");
    window.localStorage.removeItem("pubmax:webPush:actionSeq:v1");
    window.sessionStorage.clear();
  });

  await page.goto("/map?plan=1");
  const webPrompt = page.getByRole("dialog", { name: "Get the London brief" });
  await expect(page.getByRole("heading", { name: "Describe the outing" })).toBeVisible({ timeout: 30_000 });
  await expect(webPrompt).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Stay in the loop" })).toHaveCount(0);

  await page.getByRole("button", { name: "Make a plan" }).click();
  await expect(webPrompt).toBeVisible();
  await expect(page.getByText("Weather verdict and one sourced pick for tonight. No crew or personal alerts yet.")).toBeVisible();
  await expect(page.getByText("Get pinged when your crew votes or the get-in closes.")).toHaveCount(0);

  await webPrompt.getByRole("button", { name: "Enable" }).click();
  await expect(webPrompt).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __webPushPermissionRequests: number }).__webPushPermissionRequests)).toBe(1);
  expect(registrationBody).toMatchObject({ platform: "web", token: expect.stringMatching(/^webpush:/) });

  await page.reload();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible({ timeout: 30_000 });
  await expect(webPrompt).toHaveCount(0);
});
