import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

test.use({ viewport: { width: 390, height: 844 } });

const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-000000000094";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";

async function seedSignedInSession(page: Page): Promise<void> {
  await page.addInitScript(({ authStorageKey, userId }) => {
    try {
      localStorage.setItem("pubmax-tour-v1-done", "1");
      localStorage.setItem("pubmax:first-run-welcome:v1", "1");
      localStorage.setItem(
        authStorageKey,
        JSON.stringify({
          access_token: "pubmaxx-e2e-access-token",
          refresh_token: "pubmaxx-e2e-refresh-token",
          expires_at: Math.floor(Date.now() / 1000) + 86_400,
          expires_in: 86_400,
          token_type: "bearer",
          user: {
            id: userId,
            aud: "authenticated",
            role: "authenticated",
            email: "step-out-e2e@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-08-08T00:00:00.000Z",
          },
        }),
      );
    } catch {
      // Storage may be blocked.
    }
  }, {
    authStorageKey: E2E_AUTH_STORAGE_KEY,
    userId: E2E_AUTH_USER_ID,
  });
}

async function installPushRuntime(page: Page): Promise<void> {
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

    class FakeNotification {
      static permission: NotificationPermission = "default";
      static async requestPermission(): Promise<NotificationPermission> {
        FakeNotification.permission = "granted";
        return "granted";
      }
    }
    Object.defineProperty(window, "Notification", { configurable: true, value: FakeNotification });
    Object.defineProperty(window, "PushManager", { configurable: true, value: class {} });

    const subscription = {
      toJSON: () => ({
        endpoint: "https://updates.push.services.mozilla.com/wpush/v2/step-out-e2e",
        expirationTime: null,
        keys: {
          p256dh: "e2ePublicKey_material_step_out_nudge_xxxxxxxxxxxxxxxxxxxxxxxxxxx",
          auth: "e2eAuthKey_material_xx",
        },
      }),
      unsubscribe: async () => true,
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
  });
}

async function installStepOutRoutes(page: Page): Promise<{ enabled: boolean }> {
  const state = { enabled: false };
  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "step-out-e2e@example.test",
      }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ complete: true, handle: "step_out" }),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: "step_out" }),
    });
  });
  await page.route("**/api/push-tokens", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true }),
    });
  });
  await page.route("**/api/step-out-nudge", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: state.enabled,
          lastSentAt: null,
          canSend: state.enabled,
          maxPerWeek: 1,
        }),
      });
      return;
    }
    if (method === "POST") {
      const body = route.request().postDataJSON() as { enabled?: boolean; token?: string };
      expect(body.enabled).toBe(true);
      expect(typeof body.token).toBe("string");
      state.enabled = true;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: true,
          lastSentAt: null,
          canSend: true,
          maxPerWeek: 1,
        }),
      });
      return;
    }
    if (method === "DELETE") {
      state.enabled = false;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          enabled: false,
          lastSentAt: null,
          canSend: false,
          maxPerWeek: 1,
        }),
      });
      return;
    }
    await route.fallback();
  });
  // Soften noisy account hub fetches.
  for (const path of [
    "**/api/social-connections",
    "**/api/me/night-profile",
    "**/api/referrals/status",
    "**/api/me/pending-plan-recaps",
  ]) {
    await page.route(path, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({}),
      });
    });
  }
  return state;
}

test.describe("Step Out weekly nudge opt-in (390x844)", () => {
  test("shows the notifications section and completes opt-in then withdraw", async ({
    page,
  }) => {
    await seedSignedInSession(page);
    await installPushRuntime(page);
    const state = await installStepOutRoutes(page);

    await page.goto("/u/you#account-settings", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("step-out-nudge-pref");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(panel.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(page.getByText(/at most one place-bound push a week/i)).toBeVisible();
    // Installed/standalone runtime: iOS install note is hidden.
    await expect(page.getByTestId("step-out-ios-install-note")).toHaveCount(0);

    await page.screenshot({
      path: path.join("/tmp", "step-out-nudge-opt-in-390.png"),
      fullPage: true,
    });

    await panel.getByRole("button", { name: "Turn Step Out on" }).click();
    await expect(panel.getByText(/Step Out on/i)).toBeVisible({ timeout: 10_000 });
    expect(state.enabled).toBe(true);

    await panel.getByRole("button", { name: "Turn Step Out off" }).click();
    await expect(panel.getByText(/Step Out off/i)).toBeVisible({ timeout: 10_000 });
    expect(state.enabled).toBe(false);

    await page.screenshot({
      path: path.join("/tmp", "step-out-nudge-withdrawn-390.png"),
      fullPage: true,
    });
  });

  test("documents Home Screen install when not standalone", async ({ page }) => {
    await seedSignedInSession(page);
    await installStepOutRoutes(page);
    await page.goto("/u/you#account-settings", { waitUntil: "domcontentloaded" });
    const panel = page.getByTestId("step-out-nudge-pref");
    await expect(panel).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("step-out-ios-install-note")).toBeVisible();
    await expect(
      page.getByText(/web push needs the Home Screen install/i),
    ).toBeVisible();
    await page.screenshot({
      path: path.join("/tmp", "step-out-nudge-ios-note-390.png"),
      fullPage: true,
    });
  });
});
