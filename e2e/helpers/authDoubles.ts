import { type Page } from "@playwright/test";

export const ACCOUNTS = {
  A: {
    id: "00000000-0000-4000-8000-0000000000a1",
    handle: "karan",
    email: "karan@example.test",
    name: "Karan",
    refreshToken: "pubmaxx-e2e-refresh-token-a",
  },
  B: {
    id: "00000000-0000-4000-8000-0000000000b2",
    handle: "karansznx",
    email: "karanmanoharann@example.test",
    name: "Karan M",
    refreshToken: "pubmaxx-e2e-refresh-token-b",
  },
} as const;

export type AccountKey = keyof typeof ACCOUNTS;
export type Account = (typeof ACCOUNTS)[AccountKey];

export const AUTH_STORAGE_KEY = "sb-pubmaxx-e2e-auth-token";
export const DEVICE_ACCOUNTS_KEY = "pubmax_device_sessions_v1";
export const WHICH_ACCOUNT_KEY = "__e2e_signed_in_account";
export const DEVICE_HANDLE_KEY = "pubmax_handle";
export const RESUME_COOKIE = "pubmax_session_resume";

export type Stub = {
  /** Whose session the init script installs, and whom the doubles answer for. */
  signedInAs: (account: AccountKey | null) => Promise<void>;
  /** The claimed handle the server owns for the signed-in account, or null. */
  setServerHandle: (handle: string | null) => void;
};

/** A cross-origin POST carrying `apikey` needs the preflight answered too. */
export const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
} as const;

export const JWT_EXPIRY_SECONDS = Math.floor(Date.now() / 1000) + 3_600;

export function base64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

/**
 * A structurally valid access token. `setSession` decodes the JWT to read its
 * expiry before it will install a session, so the seeded opaque strings this
 * spec uses elsewhere are not enough for the switch path. Nothing verifies a
 * signature here, and nothing in the app reads a claim out of it.
 */
export function accessJwt(account: Account): string {
  return [
    base64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    base64url(
      JSON.stringify({
        sub: account.id,
        email: account.email,
        exp: JWT_EXPIRY_SECONDS,
        role: "authenticated",
      }),
    ),
    base64url("e2e-signature"),
  ].join(".");
}

/** GoTrue rotates a refresh token on use, so a switch must store the new one. */
export function rotatedToken(account: Account): string {
  return `${account.refreshToken}-rotated`;
}

export function userBody(account: Account) {
  return {
    id: account.id,
    aud: "authenticated",
    role: "authenticated",
    email: account.email,
    app_metadata: {},
    user_metadata: { full_name: account.name },
  };
}

export function accountForRefreshToken(token: string | undefined): Account | null {
  if (!token) return null;
  return (
    Object.values(ACCOUNTS).find(
      (account) =>
        account.refreshToken === token || rotatedToken(account) === token,
    ) ?? null
  );
}

/** Which account an Authorization header speaks for, seeded or minted. */
export function accountForBearer(header: string | undefined): Account | null {
  if (!header) return null;
  const token = header.replace(/^Bearer\s+/i, "");
  for (const [key, account] of Object.entries(ACCOUNTS)) {
    if (token === `pubmaxx-e2e-access-token-${key}`) return account;
    if (token === accessJwt(account)) return account;
  }
  return null;
}

export async function installAuthDoubles(
  page: Page,
  options: { realResumeCookie?: boolean } = {},
): Promise<Stub> {
  let current: Account | null = ACCOUNTS.A;
  /** undefined: derive the handle from the caller. Otherwise force this answer. */
  let handleOverride: string | null | undefined = undefined;

  // The durable resume cookie is the REAL route, and it carries a real per-IP
  // budget (60 persists an hour, app/api/auth/session). Every signed-in page
  // load in every worker spends one from the same budget, so a suite this size
  // exhausted it and the LATER tests then read a cookie the server had refused
  // to write - a rate limit reading as a broken feature. A test that does not
  // ASSERT the cookie has no business spending that budget, so it answers the
  // persist itself and leaves every other action to the real route.
  if (!options.realResumeCookie) {
    await page.route("**/api/auth/session", async (route) => {
      const request = route.request();
      const body =
        request.method() === "POST"
          ? ((request.postDataJSON() ?? {}) as { action?: string })
          : null;
      if (body?.action === "persist") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true }),
        });
        return;
      }
      await route.fallback();
    });
  }

  await page.addInitScript(
    ({ accounts, authStorageKey, whichKey }) => {
      window.localStorage.setItem("pubmaxx:analytics-consent:v1", "denied");
      const which = window.localStorage.getItem(whichKey);
      const account = which ? accounts[which as "A" | "B"] : null;
      if (!account) {
        window.localStorage.removeItem(authStorageKey);
        return;
      }
      window.localStorage.setItem(
        authStorageKey,
        JSON.stringify({
          access_token: `pubmaxx-e2e-access-token-${which}`,
          refresh_token: account.refreshToken,
          expires_at: Math.floor(Date.now() / 1000) + 86_400,
          expires_in: 86_400,
          token_type: "bearer",
          user: {
            id: account.id,
            aud: "authenticated",
            role: "authenticated",
            email: account.email,
            app_metadata: {},
            user_metadata: { full_name: account.name },
            created_at: "2026-07-29T00:00:00.000Z",
          },
        }),
      );
    },
    {
      accounts: ACCOUNTS,
      authStorageKey: AUTH_STORAGE_KEY,
      whichKey: WHICH_ACCOUNT_KEY,
    },
  );

  // GoTrue double.
  //
  // Every answer is keyed on the CREDENTIAL the caller sent, not on which
  // account the test last seeded, because a switch is exactly the moment those
  // two disagree: the page asks for account A while the seeded session is B's.
  // A double answering "whoever is signed in" would hand A's session B's user
  // and hide the very defect this spec is about.
  //
  //   POST /auth/v1/token?grant_type=refresh_token → the account holding that
  //     refresh token, with a ROTATED one, exactly as GoTrue rotates on use.
  //   GET  /auth/v1/user                           → the account whose access
  //     token is in the Authorization header.
  await page.route("https://pubmaxx-e2e.supabase.co/**", async (route) => {
    const request = route.request();
    const url = request.url();
    // A cross-origin POST carrying `apikey` is preflighted by the browser.
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS_HEADERS });
      return;
    }
    if (url.includes("/auth/v1/token")) {
      const sent = (request.postDataJSON() ?? {}) as { refresh_token?: string };
      const account = accountForRefreshToken(sent.refresh_token);
      if (!account) {
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          headers: CORS_HEADERS,
          body: JSON.stringify({ error: "invalid_grant" }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: CORS_HEADERS,
        body: JSON.stringify({
          access_token: accessJwt(account),
          refresh_token: rotatedToken(account),
          expires_in: 3_600,
          expires_at: JWT_EXPIRY_SECONDS,
          token_type: "bearer",
          user: userBody(account),
        }),
      });
      return;
    }
    const bearer = accountForBearer(request.headers().authorization);
    const body =
      url.includes("/auth/v1/user") && (bearer ?? current)
        ? userBody((bearer ?? current) as Account)
        : {};
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: CORS_HEADERS,
      body: JSON.stringify(body),
    });
  });

  // The canonical handle read is keyed on the caller's bearer for the same
  // reason: after a switch the live session is A's, and answering B's handle
  // would let the app name the new account after the previous one.
  await page.route("**/api/identity/handle/current", async (route) => {
    const bearer = accountForBearer(route.request().headers().authorization);
    const handle =
      handleOverride === undefined ? (bearer ?? current)?.handle ?? null : handleOverride;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ handle }),
    });
  });
  await page.route("**/api/identity/onboarding", async (route) => {
    const bearer = accountForBearer(route.request().headers().authorization);
    const handle =
      handleOverride === undefined ? (bearer ?? current)?.handle ?? null : handleOverride;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(handle ? { complete: false, handle } : { complete: false }),
    });
  });

  return {
    async signedInAs(key) {
      current = key ? ACCOUNTS[key] : null;
      handleOverride = undefined;
      await page.evaluate(
        ({ whichKey, value }) => {
          if (value) window.localStorage.setItem(whichKey, value);
          else window.localStorage.removeItem(whichKey);
        },
        { whichKey: WHICH_ACCOUNT_KEY, value: key ?? "" },
      );
    },
    setServerHandle(handle) {
      handleOverride = handle;
    },
  };
}

/** Seed the browser as if the account key had signed in before the first load. */
export async function seedSignedIn(page: Page, key: AccountKey): Promise<void> {
  await page.goto("/today");
  await page.evaluate(
    ({ whichKey, value }) => window.localStorage.setItem(whichKey, value),
    { whichKey: WHICH_ACCOUNT_KEY, value: key },
  );
}

/** The accounts this device remembers, as the switcher's own lane holds them. */
export async function readDeviceAccounts(
  page: Page,
): Promise<Array<{ userId: string; refreshToken: string | null; handle: string | null }>> {
  return page.evaluate((key) => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as Array<Record<string, never>>) : [];
    } catch {
      return [];
    }
  }, DEVICE_ACCOUNTS_KEY) as Promise<
    Array<{ userId: string; refreshToken: string | null; handle: string | null }>
  >;
}

export async function readDeviceIdentity(page: Page): Promise<Record<string, string | null>> {
  return page.evaluate((handleKey) => {
    const read = (key: string) => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    };
    return {
      handle: read(handleKey),
      nightProfile: read("pubmaxx.night-profile.v1:device"),
      roundAnonymous: read("pubmax_round_anonymous_identity_v1"),
      nudgePending: read("pubmax:identityNudge:pending:v1"),
    };
  }, DEVICE_HANDLE_KEY);
}

export async function resumeCookie(page: Page): Promise<string | null> {
  const cookies = await page.context().cookies();
  return cookies.find((cookie) => cookie.name === RESUME_COOKIE)?.value ?? null;
}

export function decodeResumeCookie(value: string | null): { rt?: string; em?: string } | null {
  if (!value) return null;
  try {
    return JSON.parse(
      Buffer.from(decodeURIComponent(value), "base64url").toString("utf8"),
    ) as { rt?: string; em?: string };
  } catch {
    return null;
  }
}
