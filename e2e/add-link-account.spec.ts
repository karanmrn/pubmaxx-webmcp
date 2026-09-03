import { expect, test, type Page } from "@playwright/test";

// The captain's growth link, /add/<handle>, from the browser's side.
//
// WHAT THIS CAN AND CANNOT REHEARSE, the same split e2e/account-password.spec.ts
// names: creating the account itself is GoTrue's own call and signing in with a
// handle and password is our route calling GoTrue from the SERVER, so neither
// half is reachable from a browser test. What IS reachable, and what actually
// broke before this change, is the two ends of the journey: a stranger meets one
// way in that carries the add link, and an account landing back on that link
// performs the add ONCE and is shown the receipt. The password form's own
// destination is asserted where it is decided (__tests__/addLink.test.ts).

const PHONE = { width: 390, height: 844 };
const TARGET = "karan";
const TARGET_NAME = `@${TARGET}`;
const RETURN_TO = "%2Fadd%2Fkaran%3Fauto%3D1";
const E2E_AUTH_USER_ID = "00000000-0000-4000-8000-00000000000e";
const E2E_AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
const VIEWER_HANDLE = "addlinkproof";
// One marker per target handle, on the DEVICE: a magic link finishes the
// sign-up in a fresh tab, so a per-tab marker would never survive the journey.
const ADD_LINK_DOOR_MARKER_KEY = `pubmax:add-link-door:v1:${TARGET}`;

async function seedSignedInSession(page: Page, options?: { doorTaken?: boolean }): Promise<void> {
  await page.addInitScript(
    ({ authStorageKey, userId, doorTaken, doorKey }) => {
      window.localStorage.setItem(
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
            email: "add-link-e2e@example.test",
            app_metadata: {},
            user_metadata: {},
            created_at: "2026-08-01T00:00:00.000Z",
          },
        }),
      );
      if (doorTaken) {
        window.localStorage.setItem(doorKey, JSON.stringify({ at: Date.now() }));
      }
    },
    {
      authStorageKey: E2E_AUTH_STORAGE_KEY,
      userId: E2E_AUTH_USER_ID,
      doorTaken: options?.doorTaken === true,
      doorKey: ADD_LINK_DOOR_MARKER_KEY,
    },
  );
}

test.use({ viewport: PHONE });

test("a stranger meets one way in, and it carries the add link", async ({ page }) => {
  await page.goto(`/add/${TARGET}`);

  const create = page.getByRole("link", { name: `Create account and add ${TARGET_NAME}` });
  await expect(create).toBeVisible();
  await expect(create).toHaveAttribute("href", `/login?mode=signup&from=${RETURN_TO}`);

  const signIn = page.getByRole("link", { name: "I have an account, sign in" });
  await expect(signIn).toBeVisible();
  await expect(signIn).toHaveAttribute("href", `/login?mode=signin&from=${RETURN_TO}`);

  // Thumb-sized at 390, and the page does not scroll sideways.
  for (const control of [create, signIn]) {
    const box = await control.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const avatar = page.locator(".confirmFollowAvatar");
  await expect(avatar).toBeVisible();
  const avatarBox = await avatar.boundingBox();
  expect(avatarBox?.width ?? 0).toBeGreaterThanOrEqual(56);
  expect(avatarBox?.height ?? 0).toBeGreaterThanOrEqual(56);
  const avatarChrome = await avatar.evaluate((node) => {
    const style = getComputedStyle(node);
    return { radius: style.borderRadius, width: style.width, height: style.height };
  });
  expect(avatarChrome.width).toBe("56px");
  expect(avatarChrome.height).toBe("56px");
  expect(avatarChrome.radius === "50%" || avatarChrome.radius === "28px").toBe(true);

  const paddingLeft = await create.evaluate((node) => getComputedStyle(node).paddingLeft);
  const paddingRight = await create.evaluate((node) => getComputedStyle(node).paddingRight);
  expect(paddingLeft).toBe("18px");
  expect(paddingRight).toBe("18px");
});

test("the sign-up door opens the account form with the add link still on it", async ({
  page,
}) => {
  await page.goto(`/add/${TARGET}`);
  await page
    .getByRole("link", { name: `Create account and add ${TARGET_NAME}` })
    .click();

  await expect(page).toHaveURL(new RegExp(`/login\\?mode=signup&from=${RETURN_TO}`));
  // The new-account door, and the handle+password form beside it: both are the
  // real ways in, and both are reached with the add link intact.
  await expect(page.getByRole("heading", { name: "Let's get you in" })).toBeVisible();
  await expect(page.getByTestId("e2e-login-toggle")).toHaveCount(0);
  await page.getByRole("tab", { name: "Sign in" }).click();
  await expect(page.getByTestId("e2e-login-toggle")).toBeVisible();
});

test("landing back with an account adds them once and shows the receipt", async ({
  page,
}) => {
  await seedSignedInSession(page, { doorTaken: true });

  let follows = 0;
  // The non-routable auth boundary, answered the way the identity specs answer it.
  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "add-link-e2e@example.test",
      }),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: VIEWER_HANDLE, hasPassword: true }),
    });
  });
  await page.route(`**/api/profiles/${TARGET}/follow`, async (route) => {
    follows += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ following: true, counts: { followers: 1, following: 0 } }),
    });
  });

  await page.goto(`/add/${TARGET}?auto=1`);

  await expect(
    page.getByRole("heading", { name: `${TARGET_NAME} is in your lot.` }),
  ).toBeVisible();
  // No button to press: the add the person chose before they had an account is
  // the thing that just happened.
  await expect(page.getByRole("button", { name: `Add ${TARGET_NAME}` })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open the map" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Find a pint" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Send them a message" })).toHaveAttribute(
    "href",
    `/u/${TARGET}`,
  );

  // ONCE. A second write would be idempotent on the server, but this surface
  // must not ask for it twice.
  expect(follows).toBe(1);
});

test("a crafted auto=1 with no door taken does not add them", async ({ page }) => {
  await seedSignedInSession(page);

  let follows = 0;
  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify({
        id: E2E_AUTH_USER_ID,
        aud: "authenticated",
        role: "authenticated",
        email: "add-link-e2e@example.test",
      }),
    });
  });
  await page.route("**/api/identity/handle/current", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle: VIEWER_HANDLE, hasPassword: true }),
    });
  });
  await page.route(`**/api/profiles/${TARGET}/follow`, async (route) => {
    follows += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ following: true, counts: { followers: 1, following: 0 } }),
    });
  });

  await page.goto(`/add/${TARGET}?auto=1`);

  await expect(page.getByRole("button", { name: `Add ${TARGET_NAME}` })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: `${TARGET_NAME} is in your lot.` }),
  ).toHaveCount(0);
  expect(follows).toBe(0);
});
