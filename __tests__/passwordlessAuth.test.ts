import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_ATTEMPT_PARAM,
  AUTH_CALLBACK_MARKER,
  AUTH_COORDINATION_UNAVAILABLE_MESSAGE,
  AUTH_ATTEMPT_IN_PROGRESS_MESSAGE,
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT,
  AUTH_STORAGE_UNAVAILABLE_MESSAGE,
  beginAuthAttempt,
  beginCanonicalAuthAttempt,
  beginCoordinatedAuthAttempt,
  buildAuthCallbackUrl,
  cancelAuthAttempt,
  captureAuthCallback,
  defaultEmailAuthNext,
  readAuthCallbackAttempt,
  releaseAuthAttempt,
  scrubAuthCallback,
  scrubLingeringAuthCallback,
  subscribeToAuthFragmentRestored,
  type AuthAttemptOptions,
  type AuthAttemptStart,
} from "@/lib/authRedirect";
import { establishAuthCallbackSession } from "@/lib/authCallbackClient";
import { withAuthFetchTimeout } from "@/lib/authFetch";
import {
  MAGIC_LINK_ERROR_MESSAGE,
  MAGIC_LINK_RATE_LIMIT_MESSAGE,
  MAGIC_LINK_SENT_MESSAGE,
  requestMagicLink,
  type PasswordlessAuthClient,
} from "@/lib/passwordlessAuth";

describe("passwordless magic-link auth", () => {
  it("requests a magic link and returns the same neutral success copy", async () => {
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null });
    const redirect = "https://pubmaxxing.com/auth/callback?next=%2Fmap%3Farea%3Dsoho";

    await expect(
      requestMagicLink({ signInWithOtp }, "  Night.Out@Example.COM ", redirect),
    ).resolves.toEqual({ status: "sent", message: MAGIC_LINK_SENT_MESSAGE });
    expect(signInWithOtp).toHaveBeenCalledWith({
      email: "night.out@example.com",
      options: { emailRedirectTo: redirect, shouldCreateUser: true },
    });
  });

  it("makes account-specific failures indistinguishable from a successful send", async () => {
    const errors = [
      { status: 400, message: "User not found" },
      { status: 422, message: "Signups not allowed for this instance" },
      { status: 422, message: "Account already registered" },
    ];

    for (const error of errors) {
      const auth: PasswordlessAuthClient = {
        signInWithOtp: vi.fn().mockResolvedValue({ error }),
      };
      await expect(requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"))
        .resolves.toEqual({ status: "sent", message: MAGIC_LINK_SENT_MESSAGE });
    }
  });

  it("neutralizes stable account-state codes even when provider prose changes", async () => {
    for (const code of [
      "email_exists",
      "identity_already_exists",
      "signup_disabled",
      "user_banned",
      "user_not_found",
    ]) {
      const auth: PasswordlessAuthClient = {
        signInWithOtp: vi.fn().mockResolvedValue({
          error: { code, message: "Provider wording changed" },
        }),
      };
      await expect(
        requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"),
      ).resolves.toEqual({ status: "sent", message: MAGIC_LINK_SENT_MESSAGE });
    }
  });

  it("neutralizes unknown client policy errors rather than exposing an oracle", async () => {
    const auth: PasswordlessAuthClient = {
      signInWithOtp: vi.fn().mockResolvedValue({
        error: { status: 422, code: "future_account_policy", message: "Policy denied" },
      }),
    };

    await expect(
      requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"),
    ).resolves.toEqual({ status: "sent", message: MAGIC_LINK_SENT_MESSAGE });
  });

  it("keeps transport, authorization, and configuration failures actionable", async () => {
    for (const error of [
      { status: 408, code: "request_timeout" },
      { status: 425, code: "too_early" },
      { status: 401, code: "not_authorized" },
      { status: 403, code: "forbidden" },
      { status: 400, code: "email_provider_disabled" },
      { status: 400, code: "email_address_not_authorized" },
    ]) {
      const auth: PasswordlessAuthClient = {
        signInWithOtp: vi.fn().mockResolvedValue({ error }),
      };
      await expect(
        requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"),
      ).resolves.toEqual({ status: "error", message: MAGIC_LINK_ERROR_MESSAGE });
    }
  });

  it("keeps stable account-state codes neutral even when they use 401 or 403", async () => {
    for (const error of [
      { status: 401, code: "user_not_found" },
      { status: 403, code: "user_banned" },
    ]) {
      const auth: PasswordlessAuthClient = {
        signInWithOtp: vi.fn().mockResolvedValue({ error }),
      };
      await expect(
        requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"),
      ).resolves.toEqual({ status: "sent", message: MAGIC_LINK_SENT_MESSAGE });
    }
  });

  it("normalizes provider failures that are not account-specific", async () => {
    const auth: PasswordlessAuthClient = {
      signInWithOtp: vi.fn().mockResolvedValue({
        error: { status: 500, message: "SMTP temporarily unavailable" },
      }),
    };

    await expect(requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"))
      .resolves.toEqual({ status: "error", message: MAGIC_LINK_ERROR_MESSAGE });
  });

  it("gives a retry-safe rate-limit message without exposing provider wording", async () => {
    const auth: PasswordlessAuthClient = {
      signInWithOtp: vi.fn().mockResolvedValue({
        error: { status: 429, message: "email rate limit exceeded for user 123" },
      }),
    };

    await expect(requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"))
      .resolves.toEqual({ status: "rate_limited", message: MAGIC_LINK_RATE_LIMIT_MESSAGE });
  });

  it("turns network failures into a normalized retryable error", async () => {
    const auth: PasswordlessAuthClient = {
      signInWithOtp: vi.fn().mockRejectedValue(new Error("offline")),
    };

    await expect(requestMagicLink(auth, "person@example.com", "https://pubmaxxing.com/auth/callback"))
      .resolves.toEqual({ status: "error", message: MAGIC_LINK_ERROR_MESSAGE });
  });
});

describe("auth callback URL safety", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const ATTEMPT_A = "a".repeat(32);
  const ATTEMPT_B = "b".repeat(32);
  // Implicit-flow response fragment: the browser carries it across the server
  // callback redirect, so ANY browser can complete an emailed sign-in link.
  const TOKEN_FRAGMENT =
    "#access_token=header.payload.signature&refresh_token=refresh-token-1&expires_in=3600&token_type=bearer&type=magiclink";
  const TOKENS = {
    accessToken: "header.payload.signature",
    refreshToken: "refresh-token-1",
  };

  function memoryStorage() {
    const values = new Map<string, string>();
    return {
      values,
      storage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    };
  }

  function authStores() {
    const persistent = memoryStorage();
    const tab = memoryStorage();
    return {
      persistentStorage: persistent.storage,
      persistentValues: persistent.values,
      tabStorage: tab.storage,
      tabValues: tab.values,
    };
  }

  function fixedCrypto(hexPair: number) {
    return {
      getRandomValues: <T extends ArrayBufferView | null>(array: T): T => {
        if (array instanceof Uint8Array) array.fill(hexPair);
        return array;
      },
    };
  }

  const immediateLocks = {
    request: async (_name: string, callback: () => AuthAttemptStart) => callback(),
  } as unknown as NonNullable<AuthAttemptOptions["lockManager"]>;

  function claimCallback(
    currentUrl: string,
    persistentStorage: AuthAttemptOptions["persistentStorage"],
    tabStorage: AuthAttemptOptions["tabStorage"],
    now: number,
    lockManager: AuthAttemptOptions["lockManager"] = immediateLocks,
  ) {
    return captureAuthCallback(currentUrl, {
      persistentStorage,
      tabStorage,
      lockManager,
      now,
    });
  }

  function queuedLocks() {
    let tail = Promise.resolve<unknown>(undefined);
    return {
      request: (_name: string, callback: () => unknown) => {
        const result = tail.then(callback);
        tail = result.then(
          () => undefined,
          () => undefined,
        );
        return result;
      },
    } as unknown as NonNullable<AuthAttemptOptions["lockManager"]>;
  }

  it("preserves a same-origin deep link", () => {
    expect(buildAuthCallbackUrl("https://pubmaxxing.com/map?area=soho#venue", undefined, ATTEMPT_A))
      .toBe(
        `https://pubmaxxing.com/auth/callback?next=%2Fmap%3Farea%3Dsoho&_authAttempt=${ATTEMPT_A}`,
      );
  });

  it("uses the canonical site for deployed auth callbacks", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pubmaxxing.com");

    expect(
      buildAuthCallbackUrl(
        "https://chengdu-pubmax69.vercel.app/map?area=soho",
        undefined,
        ATTEMPT_A,
      ),
    ).toBe(
      `https://pubmaxxing.com/auth/callback?next=%2Fmap%3Farea%3Dsoho&_authAttempt=${ATTEMPT_A}`,
    );
  });

  it("falls back to the canonical site when production is misconfigured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "NEXT_PUBLIC_SITE_URL",
      "https://chengdu-pubmax69.vercel.app",
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      buildAuthCallbackUrl(
        "https://preview-team.vercel.app/map",
        undefined,
        ATTEMPT_A,
      ),
    ).toBe(
      `https://pubmaxxing.com/auth/callback?next=%2Fmap&_authAttempt=${ATTEMPT_A}`,
    );
  });

  it("falls back to the canonical site from an insecure production setting", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://pubmaxxing.com");
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      buildAuthCallbackUrl(
        "https://preview-team.vercel.app/map",
        undefined,
        ATTEMPT_A,
      ),
    ).toBe(
      `https://pubmaxxing.com/auth/callback?next=%2Fmap&_authAttempt=${ATTEMPT_A}`,
    );
  });

  it("falls back to the canonical site from another production origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://example.com");
    vi.spyOn(console, "error").mockImplementation(() => {});

    expect(
      buildAuthCallbackUrl(
        "https://pubmaxxing.com/map",
        undefined,
        ATTEMPT_A,
      ),
    ).toBe(
      `https://pubmaxxing.com/auth/callback?next=%2Fmap&_authAttempt=${ATTEMPT_A}`,
    );
  });

  it("keeps auth callbacks on localhost during development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://pubmaxxing.com");

    expect(
      buildAuthCallbackUrl("http://localhost:3000/map", undefined, ATTEMPT_A),
    ).toBe(
      `http://localhost:3000/auth/callback?next=%2Fmap&_authAttempt=${ATTEMPT_A}`,
    );
  });

  it("never nests callback credentials into a retry when history scrubbing was blocked", () => {
    expect(
      buildAuthCallbackUrl(
        `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
        undefined,
        ATTEMPT_B,
      ),
    ).toBe(
      `https://pubmaxxing.com/auth/callback?next=%2Fmap&_authAttempt=${ATTEMPT_B}`,
    );
  });

  it("navigates to the apex before touching auth coordination on a preview", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const navigation = vi.fn();
    const storageAccess = vi.fn(() => {
      throw new Error("auth state must not be touched on the preview");
    });
    const lockRequest = vi.fn();

    const result = await beginCanonicalAuthAttempt(
      "https://preview-team.vercel.app/plan/abc?area=soho#invite=SECRET-A",
      undefined,
      {
        persistentStorage: {
          getItem: storageAccess,
          setItem: storageAccess,
          removeItem: storageAccess,
        },
        tabStorage: {
          getItem: storageAccess,
          setItem: storageAccess,
          removeItem: storageAccess,
        },
        lockManager: { request: lockRequest } as unknown as LockManager,
      },
      navigation,
    );

    expect(result).toEqual({ ok: false, navigationStarted: true });
    expect(navigation).toHaveBeenCalledWith(
      "https://pubmaxxing.com/plan/abc?area=soho#invite=SECRET-A",
    );
    expect(lockRequest).not.toHaveBeenCalled();
    expect(storageAccess).not.toHaveBeenCalled();
  });

  it("scrubs callback credentials before canonical navigation", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const navigation = vi.fn();

    await beginCanonicalAuthAttempt(
      `https://preview-team.vercel.app/map?area=soho&${AUTH_ATTEMPT_PARAM}=${ATTEMPT_A}&${AUTH_CALLBACK_MARKER}=1${TOKEN_FRAGMENT}`,
      undefined,
      {
        persistentStorage: memoryStorage().storage,
        tabStorage: memoryStorage().storage,
        lockManager: immediateLocks,
      },
      navigation,
    );

    // The one-time token fragment is scrubbed with the marker parameters.
    expect(navigation).toHaveBeenCalledWith(
      "https://pubmaxxing.com/map?area=soho",
    );
  });

  it("locks the browser-wide attempt without losing tab A's invite", async () => {
    const { persistentStorage, tabStorage } = authStores();
    const first = beginAuthAttempt(
      "https://pubmaxxing.com/plan/abc#invite=SECRET-A",
      undefined,
      { persistentStorage, tabStorage, cryptoProvider: fixedCrypto(0xaa), now: 1_000 },
    );
    const second = beginAuthAttempt(
      "https://pubmaxxing.com/map#venue-b",
      undefined,
      // A different tab cannot present tab A's initiating marker.
      {
        persistentStorage,
        tabStorage: memoryStorage().storage,
        cryptoProvider: fixedCrypto(0xbb),
        now: 2_000,
      },
    );

    expect(first).toMatchObject({ ok: true, id: ATTEMPT_A });
    expect(second).toEqual({ ok: false, message: AUTH_ATTEMPT_IN_PROGRESS_MESSAGE });
    const captured = await claimCallback(
      `https://pubmaxxing.com/plan/abc?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
      persistentStorage,
      tabStorage,
      3_000,
    );
    expect(captured?.cleanUrl).toBe("/plan/abc#invite=SECRET-A");
  });

  it("serializes simultaneous tab A/B claims before either can overwrite the attempt", async () => {
    const { storage: persistentStorage } = memoryStorage();
    const { storage: tabAStorage } = memoryStorage();
    const { storage: tabBStorage } = memoryStorage();
    let tail = Promise.resolve();
    const locks = {
      request: (_name: string, callback: () => AuthAttemptStart) => {
        const result = tail.then(callback);
        tail = result.then(() => undefined);
        return result;
      },
    } as unknown as NonNullable<AuthAttemptOptions["lockManager"]>;

    const [first, second] = await Promise.all([
      beginCoordinatedAuthAttempt(
        "https://pubmaxxing.com/plan/abc#invite=SECRET-A",
        undefined,
        {
          persistentStorage,
          tabStorage: tabAStorage,
          cryptoProvider: fixedCrypto(0xaa),
          lockManager: locks,
          now: 1_000,
        },
      ),
      beginCoordinatedAuthAttempt(
        "https://pubmaxxing.com/map#venue-b",
        undefined,
        {
          persistentStorage,
          tabStorage: tabBStorage,
          cryptoProvider: fixedCrypto(0xbb),
          lockManager: locks,
          now: 1_000,
        },
      ),
    ]);

    expect(first).toMatchObject({ ok: true, id: ATTEMPT_A });
    expect(second).toEqual({ ok: false, message: AUTH_ATTEMPT_IN_PROGRESS_MESSAGE });
  });

  it("keeps the browser-wide claim live for exactly 60 minutes", async () => {
    const { storage: persistentStorage } = memoryStorage();
    const { storage: tabAStorage } = memoryStorage();
    const { storage: tabBStorage } = memoryStorage();
    await beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
      persistentStorage,
      tabStorage: tabAStorage,
      cryptoProvider: fixedCrypto(0xaa),
      lockManager: immediateLocks,
      now: 1_000,
    });

    await expect(
      beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
        persistentStorage,
        tabStorage: tabBStorage,
        cryptoProvider: fixedCrypto(0xbb),
        lockManager: immediateLocks,
        now: 3_600_999,
      }),
    ).resolves.toEqual({ ok: false, message: AUTH_ATTEMPT_IN_PROGRESS_MESSAGE });
    await expect(
      beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
        persistentStorage,
        tabStorage: tabBStorage,
        cryptoProvider: fixedCrypto(0xbb),
        lockManager: immediateLocks,
        now: 3_601_000,
      }),
    ).resolves.toMatchObject({ ok: true, id: ATTEMPT_B });
  });

  it("lets a user cancel an abandoned attempt and restart before the TTL", async () => {
    const { storage: persistentStorage } = memoryStorage();
    const { storage: tabAStorage } = memoryStorage();
    const { storage: tabBStorage } = memoryStorage();
    await beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
      persistentStorage,
      tabStorage: tabAStorage,
      cryptoProvider: fixedCrypto(0xaa),
      lockManager: immediateLocks,
      now: 1_000,
    });

    await expect(
      beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
        persistentStorage,
        tabStorage: tabBStorage,
        cryptoProvider: fixedCrypto(0xbb),
        lockManager: immediateLocks,
        now: 2_000,
      }),
    ).resolves.toEqual({ ok: false, message: AUTH_ATTEMPT_IN_PROGRESS_MESSAGE });

    expect(cancelAuthAttempt(persistentStorage, tabAStorage)).toBe(true);
    await expect(
      beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
        persistentStorage,
        tabStorage: tabBStorage,
        cryptoProvider: fixedCrypto(0xbb),
        lockManager: immediateLocks,
        now: 2_500,
      }),
    ).resolves.toMatchObject({ ok: true, id: ATTEMPT_B });
  });

  it("atomically replaces an abandoned attempt when the initiating tab retries", async () => {
    const {
      persistentStorage,
      persistentValues,
      tabStorage,
      tabValues,
    } = authStores();
    const first = await beginCoordinatedAuthAttempt(
      "https://pubmaxxing.com/plan/abc#invite=SECRET-A",
      undefined,
      {
        persistentStorage,
        tabStorage,
        cryptoProvider: fixedCrypto(0xaa),
        lockManager: immediateLocks,
        now: 1_000,
      },
    );
    const restarted = await beginCoordinatedAuthAttempt(
      "https://pubmaxxing.com/map#venue-b",
      undefined,
      {
        persistentStorage,
        tabStorage,
        cryptoProvider: fixedCrypto(0xbb),
        lockManager: immediateLocks,
        now: 2_000,
      },
    );

    expect(first).toMatchObject({ ok: true, id: ATTEMPT_A });
    expect(restarted).toMatchObject({ ok: true, id: ATTEMPT_B });
    expect([...persistentValues.values()].join(" ")).not.toContain("SECRET-A");
    expect([...persistentValues.values()].join(" ")).toContain("#venue-b");
    expect([...tabValues.values()].join(" ")).not.toContain("SECRET-A");
    expect([...tabValues.values()].join(" ")).not.toContain("venue-b");

    // The replaced attempt's tokens are self-authenticating, so it still signs
    // in, but it can no longer touch the live attempt's stored fragment.
    const replacedCallback = await claimCallback(
      `https://pubmaxxing.com/plan/abc?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
      persistentStorage,
      tabStorage,
      3_000,
    );
    expect(replacedCallback).toMatchObject({
      attempt: { attemptId: ATTEMPT_A, tokens: TOKENS, providerError: false },
      cleanUrl: "/plan/abc",
      localAttemptOwned: false,
    });
    expect([...persistentValues.values()].join(" ")).toContain("#venue-b");

    const liveCallback = await claimCallback(
      `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_B}${TOKEN_FRAGMENT}`,
      persistentStorage,
      tabStorage,
      3_000,
    );
    expect(liveCallback).toMatchObject({
      attempt: { attemptId: ATTEMPT_B, tokens: TOKENS, providerError: false },
      cleanUrl: "/map#venue-b",
      localAttemptOwned: true,
    });
  });

  it("completes an emailed callback in a new tab and restores its fragment exactly once", async () => {
    const { storage: persistentStorage, values: persistentValues } = memoryStorage();
    const { storage: tabAStorage, values: tabAValues } = memoryStorage();
    const { storage: tabBStorage, values: tabBValues } = memoryStorage();
    await beginCoordinatedAuthAttempt(
      "https://pubmaxxing.com/plan/abc#invite=SECRET-A",
      undefined,
      {
        persistentStorage,
        tabStorage: tabAStorage,
        cryptoProvider: fixedCrypto(0xaa),
        lockManager: immediateLocks,
        now: 1_000,
      },
    );

    expect([...persistentValues.values()].join(" ")).toContain("SECRET-A");
    expect([...tabAValues.values()].join(" ")).not.toContain("SECRET-A");
    expect(tabBValues.size).toBe(0);
    const callbackUrl =
      `https://pubmaxxing.com/plan/abc?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`;
    const newTabCallback = await claimCallback(
      callbackUrl,
      persistentStorage,
      tabBStorage,
      2_000,
    );
    expect(newTabCallback).toMatchObject({
      attempt: { attemptId: ATTEMPT_A, tokens: TOKENS, providerError: false },
      cleanUrl: "/plan/abc#invite=SECRET-A",
      localAttemptOwned: true,
    });
    expect([...persistentValues.values()].join(" ")).not.toContain("SECRET-A");
    expect(tabAValues.size).toBe(1);
    expect(tabBValues.size).toBe(0);

    // A replayed token callback still signs in (tokens are self-authenticating)
    // but can never restore the already-consumed fragment.
    expect(await claimCallback(callbackUrl, persistentStorage, tabBStorage, 2_000))
      .toMatchObject({
        attempt: { attemptId: ATTEMPT_A, tokens: TOKENS, providerError: false },
        cleanUrl: "/plan/abc",
        localAttemptOwned: false,
      });

    releaseAuthAttempt(ATTEMPT_A, persistentStorage, tabBStorage);
    newTabCallback?.releaseCoordination();
    expect(persistentValues.size).toBe(0);
    expect(tabAValues.size).toBe(1);
    const restarted = await beginCoordinatedAuthAttempt(
      "https://pubmaxxing.com/map#venue-b",
      undefined,
      {
        persistentStorage,
        tabStorage: tabAStorage,
        cryptoProvider: fixedCrypto(0xbb),
        lockManager: immediateLocks,
        now: 3_000,
      },
    );
    expect(restarted).toMatchObject({ ok: true, id: ATTEMPT_B });
    expect(await claimCallback(callbackUrl, persistentStorage, tabBStorage, 4_000))
      .toMatchObject({
        attempt: { attemptId: ATTEMPT_A, tokens: TOKENS, providerError: false },
        cleanUrl: "/plan/abc",
      });
    expect([...persistentValues.values()].join(" ")).toContain("#venue-b");
  });

  it.each([
    "#error=access_denied",
    TOKEN_FRAGMENT,
  ])("does not restore stored auth-response fragment %s after callback scrub", async (hash) => {
    const { persistentStorage, persistentValues, tabStorage } = authStores();
    beginAuthAttempt(
      "https://pubmaxxing.com/plan/abc#invite=SECRET-A",
      undefined,
      { persistentStorage, tabStorage, cryptoProvider: fixedCrypto(0xaa), now: 1_000 },
    );
    const fragmentEntry = [...persistentValues.entries()].find(([key]) =>
      key.startsWith("pubmax_auth_return_fragment:"),
    );
    expect(fragmentEntry).toBeDefined();
    const [fragmentKey, rawFragment] = fragmentEntry!;
    persistentValues.set(
      fragmentKey,
      JSON.stringify({ ...JSON.parse(rawFragment), hash }),
    );

    const captured = await claimCallback(
      `https://pubmaxxing.com/plan/abc?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
      persistentStorage,
      tabStorage,
      2_000,
    );

    expect(captured?.cleanUrl).toBe("/plan/abc");
  });

  it("rolls back a failed same-tab replacement and leaves the original callback live", async () => {
    const { persistentStorage, persistentValues, tabStorage, tabValues } = authStores();
    await beginCoordinatedAuthAttempt(
      "https://pubmaxxing.com/plan/abc#invite=SECRET-A",
      undefined,
      {
        persistentStorage,
        tabStorage,
        cryptoProvider: fixedCrypto(0xaa),
        lockManager: immediateLocks,
        now: 1_000,
      },
    );
    const failingTabStorage = {
      ...tabStorage,
      setItem: () => {
        throw new Error("blocked");
      },
    };

    await expect(
      beginCoordinatedAuthAttempt("https://pubmaxxing.com/map#venue-b", undefined, {
        persistentStorage,
        tabStorage: failingTabStorage,
        cryptoProvider: fixedCrypto(0xbb),
        lockManager: immediateLocks,
        now: 2_000,
      }),
    ).resolves.toEqual({ ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE });
    expect([...persistentValues.values()].join(" ")).toContain(ATTEMPT_A);
    expect([...persistentValues.values()].join(" ")).not.toContain(ATTEMPT_B);
    expect([...persistentValues.values()].join(" ")).toContain("SECRET-A");
    expect([...tabValues.values()].join(" ")).not.toContain("SECRET-A");

    expect(
      (await claimCallback(
        `https://pubmaxxing.com/plan/abc?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
        persistentStorage,
        tabStorage,
        3_000,
      ))?.attempt,
    ).toEqual({ attemptId: ATTEMPT_A, tokens: TOKENS, providerError: false });
  });

  it("does not consume the live persistent fragment for an unrelated attempt B", async () => {
    const {
      persistentStorage,
      persistentValues,
      tabStorage,
      tabValues,
    } = authStores();
    beginAuthAttempt(
      "https://pubmaxxing.com/plan/abc#invite=SECRET-A",
      undefined,
      { persistentStorage, tabStorage, cryptoProvider: fixedCrypto(0xaa), now: 1_000 },
    );
    const beforePersistent = new Map(persistentValues);
    const beforeTab = new Map(tabValues);

    // An unrelated token callback completes (the deliberate cross-browser
    // trade) but must never touch attempt A's stored state or fragment.
    const unrelated = await claimCallback(
      `https://pubmaxxing.com/plan/abc?_authCallback=1&_authAttempt=${ATTEMPT_B}${TOKEN_FRAGMENT}`,
      persistentStorage,
      tabStorage,
      2_000,
    );
    expect(unrelated?.cleanUrl).toBe("/plan/abc");
    expect(unrelated?.attempt).toEqual({
      attemptId: ATTEMPT_B,
      tokens: TOKENS,
      providerError: false,
    });
    // Cross-browser / unrelated attempt: no local claim → confirmation surface.
    expect(unrelated?.localAttemptOwned).toBe(false);
    expect(persistentValues).toEqual(beforePersistent);
    expect(tabValues).toEqual(beforeTab);

    // A token-less unrelated callback still fails closed.
    const unrelatedWithoutTokens = await claimCallback(
      `https://pubmaxxing.com/plan/abc?_authCallback=1&_authAttempt=${ATTEMPT_B}`,
      persistentStorage,
      tabStorage,
      2_000,
    );
    expect(unrelatedWithoutTokens?.attempt).toEqual({
      attemptId: null,
      tokens: null,
      providerError: true,
    });
    expect(persistentValues).toEqual(beforePersistent);

    const original = await claimCallback(
      `https://pubmaxxing.com/plan/abc?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
      persistentStorage,
      tabStorage,
      3_000,
    );
    expect(original?.cleanUrl).toBe("/plan/abc#invite=SECRET-A");
    expect(original?.attempt).toEqual({
      attemptId: ATTEMPT_A,
      tokens: TOKENS,
      providerError: false,
    });
  });

  it("signs in past an expired local attempt without restoring its stale fragment", async () => {
    const {
      persistentStorage,
      persistentValues,
      tabStorage,
      tabValues,
    } = authStores();
    beginAuthAttempt(
      "https://pubmaxxing.com/plan/abc#invite=SECRET-A",
      undefined,
      { persistentStorage, tabStorage, cryptoProvider: fixedCrypto(0xaa), now: 1_000 },
    );
    const beforeTab = new Map(tabValues);

    const expired = await claimCallback(
      `https://pubmaxxing.com/plan/abc?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
      persistentStorage,
      tabStorage,
      3_602_000,
    );

    // Tokens still complete sign-in, but the expired local claim is swept and
    // its stale fragment is never restored.
    expect(expired).toMatchObject({
      attempt: { attemptId: ATTEMPT_A, tokens: TOKENS, providerError: false },
      cleanUrl: "/plan/abc",
    });
    expect(persistentValues.size).toBe(0);
    expect(tabValues).toEqual(beforeTab);
  });

  it("fails closed on a token-less replay after the attempt was released", async () => {
    const { persistentStorage, tabStorage } = authStores();
    beginAuthAttempt(
      "https://pubmaxxing.com/map",
      undefined,
      { persistentStorage, tabStorage, cryptoProvider: fixedCrypto(0xaa), now: 1_000 },
    );
    releaseAuthAttempt(ATTEMPT_A, persistentStorage, tabStorage);

    const replay = await claimCallback(
      `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_A}`,
      persistentStorage,
      tabStorage,
      2_000,
    );

    expect(replay?.attempt).toEqual({ attemptId: null, tokens: null, providerError: true });
  });

  it("rejects a same-tab restart while the first callback completion is in flight", async () => {
    const { persistentStorage, tabStorage } = authStores();
    beginAuthAttempt("https://pubmaxxing.com/map", undefined, {
      persistentStorage,
      tabStorage,
      cryptoProvider: fixedCrypto(0xaa),
      now: 1_000,
    });
    const callbackUrl =
      `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`;

    expect((await claimCallback(callbackUrl, persistentStorage, tabStorage, 2_000))?.attempt)
      .toEqual({ attemptId: ATTEMPT_A, tokens: TOKENS, providerError: false });
    await expect(
      beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
        persistentStorage,
        tabStorage,
        cryptoProvider: fixedCrypto(0xbb),
        lockManager: immediateLocks,
        now: 2_500,
      }),
    ).resolves.toEqual({ ok: false, message: AUTH_ATTEMPT_IN_PROGRESS_MESSAGE });
  });

  it("serializes simultaneous callback tabs so exactly one restores the stored fragment", async () => {
    const { storage: persistentStorage } = memoryStorage();
    const { storage: tabAStorage } = memoryStorage();
    const { storage: tabBStorage } = memoryStorage();
    beginAuthAttempt("https://pubmaxxing.com/map#venue", undefined, {
      persistentStorage,
      tabStorage: tabAStorage,
      cryptoProvider: fixedCrypto(0xaa),
      now: 1_000,
    });
    const locks = queuedLocks();
    const callbackUrl =
      `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`;

    const firstCallbackPromise = claimCallback(
      callbackUrl,
      persistentStorage,
      tabAStorage,
      2_000,
      locks,
    );
    const secondCallbackPromise = claimCallback(
      callbackUrl,
      persistentStorage,
      tabBStorage,
      2_000,
      locks,
    );
    const firstCallback = await firstCallbackPromise;
    expect(firstCallback?.attempt.tokens).toEqual(TOKENS);
    releaseAuthAttempt(ATTEMPT_A, persistentStorage, tabAStorage);
    firstCallback?.releaseCoordination();
    // Both tabs complete sign-in from the same tokens, but the stored return
    // fragment is consumed exactly once.
    const callbacks = [firstCallback, await secondCallbackPromise];
    expect(callbacks.filter((captured) => captured?.attempt.tokens)).toHaveLength(2);
    expect(callbacks.filter((captured) => captured?.attempt.providerError)).toHaveLength(0);
    expect(callbacks.map((captured) => captured?.cleanUrl).sort()).toEqual([
      "/map",
      "/map#venue",
    ]);
  });

  it("holds the attempt lock across completion when a callback is claimed at the TTL boundary", async () => {
    const { storage: persistentStorage } = memoryStorage();
    const { storage: tabAStorage } = memoryStorage();
    const { storage: tabBStorage } = memoryStorage();
    const locks = queuedLocks();
    await beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
      persistentStorage,
      tabStorage: tabAStorage,
      cryptoProvider: fixedCrypto(0xaa),
      lockManager: locks,
      now: 1_000,
    });
    const callback = await claimCallback(
      `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
      persistentStorage,
      tabAStorage,
      3_600_999,
      locks,
    );
    expect(callback?.attempt.tokens).toEqual(TOKENS);

    const events: string[] = [];
    const hangingFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const signal = init?.signal;
      if (!signal) throw new Error("missing abort signal");
      return await new Promise<Response>((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          events.push("underlying-aborted");
          reject(signal.reason);
        }, { once: true });
      });
    }) as typeof fetch;
    const timedFetch = withAuthFetchTimeout(hangingFetch, 10);
    const exchange = establishAuthCallbackSession({
      setSession: async () => {
        await timedFetch("https://auth.example/token");
        return { data: { session: null }, error: null };
      },
    }, TOKENS);

    let restartSettled = false;
    const restart = beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
      persistentStorage,
      tabStorage: tabBStorage,
      cryptoProvider: fixedCrypto(0xbb),
      lockManager: locks,
      now: 3_601_000,
    }).then((result) => {
      restartSettled = true;
      return result;
    });
    await Promise.resolve();
    expect(restartSettled).toBe(false);

    await expect(exchange).resolves.toEqual({ session: null, failed: true });
    expect(events).toEqual(["underlying-aborted"]);
    expect(restartSettled).toBe(false);

    // AuthProvider performs matching cleanup while the callback lease is still
    // held, then releases it only after the aborted exchange has settled.
    releaseAuthAttempt(ATTEMPT_A, persistentStorage, tabAStorage);
    callback?.releaseCoordination();
    await expect(restart).resolves.toMatchObject({ ok: true, id: ATTEMPT_B });
  });

  it("prevents a stale callback claim from overwriting a queued same-tab restart", async () => {
    const { persistentStorage, tabStorage } = authStores();
    await beginCoordinatedAuthAttempt("https://pubmaxxing.com/map#old", undefined, {
      persistentStorage,
      tabStorage,
      cryptoProvider: fixedCrypto(0xaa),
      lockManager: immediateLocks,
      now: 1_000,
    });
    const locks = queuedLocks();
    const restart = beginCoordinatedAuthAttempt("https://pubmaxxing.com/map#fresh", undefined, {
      persistentStorage,
      tabStorage,
      cryptoProvider: fixedCrypto(0xbb),
      lockManager: locks,
      now: 2_000,
    });
    const staleClaim = claimCallback(
      `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
      persistentStorage,
      tabStorage,
      2_000,
      locks,
    );

    await expect(restart).resolves.toMatchObject({ ok: true, id: ATTEMPT_B });
    // The stale claim still signs in from its tokens but cannot claim or
    // disturb the queued restart's stored fragment.
    const staleCaptured = await staleClaim;
    expect(staleCaptured).toMatchObject({
      attempt: { attemptId: ATTEMPT_A, tokens: TOKENS, providerError: false },
      cleanUrl: "/map",
    });
    staleCaptured?.releaseCoordination();
    await expect(
      claimCallback(
        `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_B}${TOKEN_FRAGMENT}`,
        persistentStorage,
        tabStorage,
        3_000,
        locks,
      ),
    ).resolves.toMatchObject({
      attempt: { attemptId: ATTEMPT_B, tokens: TOKENS, providerError: false },
      cleanUrl: "/map#fresh",
    });
  });

  it("supports an attempt with no fragment and releases only its lock", async () => {
    const {
      persistentStorage,
      persistentValues,
      tabStorage,
      tabValues,
    } = authStores();
    const started = beginAuthAttempt(
      "https://pubmaxxing.com/map?area=soho",
      undefined,
      { persistentStorage, tabStorage, cryptoProvider: fixedCrypto(0xbb), now: 1_000 },
    );
    expect(started).toMatchObject({ ok: true, id: ATTEMPT_B });
    const captured = await claimCallback(
      `https://pubmaxxing.com/map?area=soho&_authCallback=1&_authAttempt=${ATTEMPT_B}${TOKEN_FRAGMENT}`,
      persistentStorage,
      tabStorage,
      2_000,
    );
    expect(captured?.cleanUrl).toBe("/map?area=soho");
    releaseAuthAttempt(ATTEMPT_B, persistentStorage, tabStorage);
    captured?.releaseCoordination();
    expect(persistentValues.size).toBe(0);
    expect(tabValues.size).toBe(0);
  });

  it("restores the local fragment on provider error and releases both claims", async () => {
    const {
      persistentStorage,
      persistentValues,
      tabStorage,
      tabValues,
    } = authStores();
    beginAuthAttempt(
      "https://pubmaxxing.com/plan/abc#invite=SECRET-A",
      undefined,
      { persistentStorage, tabStorage, cryptoProvider: fixedCrypto(0xaa), now: 1_000 },
    );

    const callback = await claimCallback(
      `https://pubmaxxing.com/plan/abc?_authCallback=1&_authAttempt=${ATTEMPT_A}&authError=1`,
      persistentStorage,
      tabStorage,
      2_000,
    );
    expect(callback).toMatchObject({
      attempt: { attemptId: ATTEMPT_A, tokens: null, providerError: true },
      cleanUrl: "/plan/abc#invite=SECRET-A",
    });

    releaseAuthAttempt(ATTEMPT_A, persistentStorage, tabStorage);
    callback?.releaseCoordination();
    expect(persistentValues.size).toBe(0);
    expect(tabValues.size).toBe(0);
  });

  it("does not let a replaced attempt's release clear the live retry", async () => {
    const { persistentStorage, tabStorage } = authStores();
    await beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
      persistentStorage,
      tabStorage,
      cryptoProvider: fixedCrypto(0xaa),
      lockManager: immediateLocks,
      now: 1_000,
    });
    await beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
      persistentStorage,
      tabStorage,
      cryptoProvider: fixedCrypto(0xbb),
      lockManager: immediateLocks,
      now: 2_000,
    });

    releaseAuthAttempt(ATTEMPT_A, persistentStorage, tabStorage);
    expect(
      (await claimCallback(
        `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_B}${TOKEN_FRAGMENT}`,
        persistentStorage,
        tabStorage,
        3_000,
      ))?.attempt,
    ).toEqual({ attemptId: ATTEMPT_B, tokens: TOKENS, providerError: false });
  });

  it("fails closed when either browser store or Web Locks is unavailable", async () => {
    const { storage: persistentStorage } = memoryStorage();
    const { storage: tabStorage } = memoryStorage();
    const lockRequest = vi.fn();

    await expect(
      beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
        persistentStorage,
        tabStorage: null,
        cryptoProvider: fixedCrypto(0xaa),
        lockManager: { request: lockRequest } as unknown as NonNullable<
          AuthAttemptOptions["lockManager"]
        >,
      }),
    ).resolves.toEqual({ ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE });
    expect(lockRequest).not.toHaveBeenCalled();

    await expect(
      beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
        persistentStorage,
        tabStorage: persistentStorage,
        cryptoProvider: fixedCrypto(0xaa),
        lockManager: immediateLocks,
      }),
    ).resolves.toEqual({ ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE });

    await expect(
      beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
        persistentStorage,
        tabStorage,
        cryptoProvider: fixedCrypto(0xaa),
        lockManager: null,
      }),
    ).resolves.toEqual({ ok: false, message: AUTH_COORDINATION_UNAVAILABLE_MESSAGE });
  });

  it("cleans a partial claim and reports the storage failure", async () => {
    const { storage: persistentStorage, values: persistentValues } = memoryStorage();
    const failingTabStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota denied");
      },
      removeItem: () => undefined,
    };

    await expect(
      beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
        persistentStorage,
        tabStorage: failingTabStorage,
        cryptoProvider: fixedCrypto(0xaa),
        lockManager: immediateLocks,
        now: 1_000,
      }),
    ).resolves.toEqual({ ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE });
    expect(persistentValues.size).toBe(0);
  });

  it("normalizes a Web Locks failure without claiming local attempt state", async () => {
    const { persistentStorage, persistentValues, tabStorage, tabValues } = authStores();
    const failingLocks = {
      request: () => {
        throw new Error("locks denied");
      },
    } as unknown as NonNullable<AuthAttemptOptions["lockManager"]>;

    await expect(
      beginCoordinatedAuthAttempt("https://pubmaxxing.com/map", undefined, {
        persistentStorage,
        tabStorage,
        cryptoProvider: fixedCrypto(0xaa),
        lockManager: failingLocks,
      }),
    ).resolves.toEqual({ ok: false, message: AUTH_COORDINATION_UNAVAILABLE_MESSAGE });
    expect(persistentValues.size).toBe(0);
    expect(tabValues.size).toBe(0);

    beginAuthAttempt("https://pubmaxxing.com/map#venue", undefined, {
      persistentStorage,
      tabStorage,
      cryptoProvider: fixedCrypto(0xaa),
      now: 1_000,
    });
    // A broken lock cannot hold a token callback hostage: sign-in completes
    // unclaimed, and the stored fragment stays untouched for a working tab.
    await expect(
      claimCallback(
        `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
        persistentStorage,
        tabStorage,
        2_000,
        failingLocks,
      ),
    ).resolves.toMatchObject({
      attempt: { attemptId: ATTEMPT_A, tokens: TOKENS, providerError: false },
      cleanUrl: "/map",
    });
    // A token-less callback under the same broken lock still fails closed.
    await expect(
      claimCallback(
        `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_A}`,
        persistentStorage,
        tabStorage,
        2_000,
        failingLocks,
      ),
    ).resolves.toMatchObject({
      attempt: { attemptId: null, tokens: null, providerError: true },
      cleanUrl: "/map",
    });
    expect([...persistentValues.values()].join(" ")).toContain("#venue");
  });

  it("scrubs callback credentials synchronously before waiting for the claim lock", async () => {
    const { persistentStorage, tabStorage } = authStores();
    beginAuthAttempt(
      "https://pubmaxxing.com/map#venue",
      undefined,
      { persistentStorage, tabStorage, cryptoProvider: fixedCrypto(0xaa), now: 1_000 },
    );
    const replaceUrl = vi.fn();
    let releaseLock = () => {};
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const delayedLocks = {
      request: async (_name: string, callback: () => AuthAttemptStart) => {
        await lockGate;
        return callback();
      },
    } as unknown as NonNullable<AuthAttemptOptions["lockManager"]>;
    const capturedPromise = scrubAuthCallback(
      `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
      replaceUrl,
      { persistentStorage, tabStorage, lockManager: delayedLocks, now: 2_000 },
    );

    // The token fragment leaves the address bar before any lock is awaited.
    expect(replaceUrl).toHaveBeenCalledTimes(1);
    expect(replaceUrl).toHaveBeenLastCalledWith("/map");
    let settled = false;
    void capturedPromise.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    releaseLock();
    const captured = await capturedPromise;
    expect(captured?.attempt.tokens).toEqual(TOKENS);
    expect(replaceUrl).toHaveBeenLastCalledWith("/map#venue");
    releaseAuthAttempt(ATTEMPT_A, persistentStorage, tabStorage);
    captured?.releaseCoordination();
  });

  it("still claims tokens and retries the scrub when the first replaceState throws", async () => {
    // Safari rate-limits history calls during load. A refused scrub must not
    // fail the sign-in closed: that left the credentials in the address bar
    // AND signed nobody in (the founder's /u/you landing).
    const { persistentStorage, tabStorage } = authStores();
    beginAuthAttempt("https://pubmaxxing.com/u/you", undefined, {
      persistentStorage,
      tabStorage,
      cryptoProvider: fixedCrypto(0xaa),
      now: 1_000,
    });
    const scrubs: string[] = [];
    let refusals = 1;
    const replaceUrl = (url: string) => {
      if (refusals > 0) {
        refusals -= 1;
        throw new Error("history rate limited");
      }
      scrubs.push(url);
    };

    const captured = await scrubAuthCallback(
      `https://pubmaxxing.com/u/you?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
      replaceUrl,
      { persistentStorage, tabStorage, lockManager: immediateLocks, now: 2_000 },
    );

    expect(captured?.attempt.tokens).toEqual(TOKENS);
    expect(captured?.attempt.providerError).toBe(false);
    expect(scrubs).toEqual(["/u/you"]);
    releaseAuthAttempt(ATTEMPT_A, persistentStorage, tabStorage);
    captured?.releaseCoordination();
  });

  it("scrubs a lingering callback URL after the exchange settles", () => {
    const replaceUrl = vi.fn();
    expect(
      scrubLingeringAuthCallback(
        `https://pubmaxxing.com/u/you?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
        replaceUrl,
      ),
    ).toBe(true);
    expect(replaceUrl).toHaveBeenCalledWith("/u/you");
  });

  it("leaves clean and app-fragment URLs alone in the lingering sweep", () => {
    const replaceUrl = vi.fn();
    expect(
      scrubLingeringAuthCallback("https://pubmaxxing.com/u/you", replaceUrl),
    ).toBe(false);
    expect(
      scrubLingeringAuthCallback(
        "https://pubmaxxing.com/plan/abc#invite=SECRET-A",
        replaceUrl,
      ),
    ).toBe(false);
    expect(replaceUrl).not.toHaveBeenCalled();
  });

  it("notifies a mounted invite consumer when the fragment is restored after an async claim", async () => {
    const { persistentStorage, tabStorage } = authStores();
    beginAuthAttempt("https://pubmaxxing.com/plan/abc#invite=SECRET-A", undefined, {
      persistentStorage,
      tabStorage,
      cryptoProvider: fixedCrypto(0xaa),
      now: 1_000,
    });
    const fragmentEvents = new EventTarget();
    let visibleUrl = "/plan/abc";
    const consumedInvites: string[] = [];
    const unsubscribe = subscribeToAuthFragmentRestored(() => {
      const hash = new URL(visibleUrl, "https://pubmax.invalid").hash;
      const invite = new URLSearchParams(hash.replace(/^#/, "")).get("invite");
      if (invite) consumedInvites.push(invite);
    }, fragmentEvents);
    let releaseLock = () => {};
    const lockGate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const delayedLocks = {
      request: async (_name: string, callback: () => AuthAttemptStart) => {
        await lockGate;
        return callback();
      },
    } as unknown as NonNullable<AuthAttemptOptions["lockManager"]>;

    const callback = scrubAuthCallback(
      `https://pubmaxxing.com/plan/abc?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
      (cleanUrl) => {
        visibleUrl = cleanUrl;
      },
      {
        persistentStorage,
        tabStorage,
        lockManager: delayedLocks,
        now: 2_000,
        onFragmentRestored: () => {
          fragmentEvents.dispatchEvent(new Event(AUTH_RETURN_FRAGMENT_RESTORED_EVENT));
        },
      },
    );
    expect(consumedInvites).toEqual([]);
    releaseLock();
    const captured = await callback;
    expect(consumedInvites).toEqual(["SECRET-A"]);
    expect(visibleUrl).toBe("/plan/abc#invite=SECRET-A");
    unsubscribe();
    releaseAuthAttempt(ATTEMPT_A, persistentStorage, tabStorage);
    captured?.releaseCoordination();
  });

  it("claims the callback and defers the scrub when synchronous URL scrubbing throws", async () => {
    // The old fail-closed answer dropped the tokens AND left them in the
    // address bar - nobody signed in and the credentials stayed on show. A
    // refused replaceState now defers the scrub to the post-claim retry.
    const { persistentStorage, tabStorage } = authStores();
    beginAuthAttempt("https://pubmaxxing.com/map#venue", undefined, {
      persistentStorage,
      tabStorage,
      cryptoProvider: fixedCrypto(0xaa),
      now: 1_000,
    });
    const scrubs: string[] = [];
    let refusals = 1;
    const replaceUrl = (url: string) => {
      if (refusals > 0) {
        refusals -= 1;
        throw new Error("history denied");
      }
      scrubs.push(url);
    };

    const captured = await scrubAuthCallback(
      `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_A}${TOKEN_FRAGMENT}`,
      replaceUrl,
      { persistentStorage, tabStorage, lockManager: immediateLocks, now: 2_000 },
    );
    expect(captured?.attempt).toMatchObject({
      attemptId: ATTEMPT_A,
      tokens: TOKENS,
      providerError: false,
    });
    // The deferred scrub still lands, carrying the restored return fragment.
    expect(scrubs).toEqual(["/map#venue"]);
    releaseAuthAttempt(ATTEMPT_A, persistentStorage, tabStorage);
    captured?.releaseCoordination();
  });

  it("still returns a claimed callback when fragment restoration replaceState throws", async () => {
    const { persistentStorage, persistentValues, tabStorage } = authStores();
    beginAuthAttempt("https://pubmaxxing.com/map#venue", undefined, {
      persistentStorage,
      tabStorage,
      cryptoProvider: fixedCrypto(0xaa),
      now: 1_000,
    });
    const replaceUrl = vi.fn((cleanUrl: string) => {
      if (cleanUrl.includes("#")) throw new Error("history denied");
    });

    const captured = await scrubAuthCallback(
      `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_A}&_referralSignupProof=signed-proof${TOKEN_FRAGMENT}`,
      replaceUrl,
      { persistentStorage, tabStorage, lockManager: immediateLocks, now: 2_000 },
    );
    expect(captured?.attempt).toEqual({
      attemptId: ATTEMPT_A,
      tokens: TOKENS,
      providerError: false,
      signupProof: "signed-proof",
    });
    releaseAuthAttempt(ATTEMPT_A, persistentStorage, tabStorage);
    expect(persistentValues.size).toBe(0);
  });

  it("recognizes marked callbacks, error fragments, and bare token fragments", () => {
    // An ordinary app URL is never a callback.
    expect(readAuthCallbackAttempt("https://pubmaxxing.com/map?area=soho"))
      .toBeNull();
    expect(readAuthCallbackAttempt("https://pubmaxxing.com/map#venue"))
      .toBeNull();
    expect(
      readAuthCallbackAttempt(
        `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_A}&_referralSignupProof=signed-proof${TOKEN_FRAGMENT}`,
      ),
    ).toEqual({
      attemptId: ATTEMPT_A,
      tokens: TOKENS,
      providerError: false,
      signupProof: "signed-proof",
    });
    // A marked callback without a fragment carries no session to establish.
    expect(
      readAuthCallbackAttempt(
        `https://pubmaxxing.com/map?_authCallback=1&_authAttempt=${ATTEMPT_A}`,
      ),
    ).toEqual({ attemptId: ATTEMPT_A, tokens: null, providerError: false });
    // Supabase reports link failures in the fragment; auth pages surface them.
    expect(
      readAuthCallbackAttempt(
        `https://pubmaxxing.com/auth/callback?_authCallback=1&_authAttempt=${ATTEMPT_A}#error=access_denied&error_code=otp_expired`,
      ),
    ).toEqual({ attemptId: ATTEMPT_A, tokens: null, providerError: true });
    expect(readAuthCallbackAttempt("https://pubmaxxing.com/login?authError=1"))
      .toEqual({ attemptId: null, tokens: null, providerError: true });
    // A marked callback carries a live local attempt, so an error fragment
    // still surfaces even when the redirect landed on a non-auth page.
    expect(
      readAuthCallbackAttempt(
        `https://pubmaxxing.com/plan/abc?_authCallback=1&_authAttempt=${ATTEMPT_A}#error=access_denied&error_code=otp_expired`,
      ),
    ).toEqual({ attemptId: ATTEMPT_A, tokens: null, providerError: true });
    // Supabase's redirect allowlist clamps unlisted redirect_to values to the
    // bare site URL, which lands the token fragment on the landing page with
    // no callback marker. Those tokens still complete sign-in.
    expect(readAuthCallbackAttempt(`https://pubmaxxing.com/${TOKEN_FRAGMENT}`))
      .toEqual({ attemptId: null, tokens: TOKENS, providerError: false });
    // Bare provider-error signals cannot raise an auth banner outside auth pages.
    expect(readAuthCallbackAttempt("https://pubmaxxing.com/map#error=1")).toBeNull();
    expect(readAuthCallbackAttempt("https://pubmaxxing.com/map?authError=1")).toBeNull();
    expect(readAuthCallbackAttempt("https://pubmaxxing.com/signin#error=1"))
      .toEqual({ attemptId: null, tokens: null, providerError: true });
    // A marked callback whose attempt id was stripped still carries tokens.
    expect(
      readAuthCallbackAttempt(
        `https://pubmaxxing.com/map?_authCallback=1${TOKEN_FRAGMENT}`,
      ),
    ).toEqual({ attemptId: null, tokens: TOKENS, providerError: false });
  });

  it("signs in from a clamped landing-page fragment and scrubs it first", async () => {
    const { persistentStorage, persistentValues, tabStorage, tabValues } = authStores();
    const replaced: string[] = [];

    const captured = await scrubAuthCallback(
      `https://pubmaxxing.com/${TOKEN_FRAGMENT}`,
      (cleanUrl) => replaced.push(cleanUrl),
      { persistentStorage, tabStorage, lockManager: immediateLocks, now: 2_000 },
    );

    expect(replaced).toEqual(["/"]);
    expect(captured?.attempt).toEqual({
      attemptId: null,
      tokens: TOKENS,
      providerError: false,
    });
    expect(captured?.cleanUrl).toBe("/");
    // No local attempt existed and none is disturbed or invented.
    expect(persistentValues.size).toBe(0);
    expect(tabValues.size).toBe(0);
    captured?.releaseCoordination();
  });

  it("defaults a fragment-free email sign-in to the handle claim surface", () => {
    expect(defaultEmailAuthNext("https://pubmaxxing.com/map?area=soho")).toBe("/u/you");
    // A leftover auth-response fragment is not a destination worth keeping.
    expect(defaultEmailAuthNext("https://pubmaxxing.com/?authError=1#error=access_denied"))
      .toBe("/u/you");
    // A live app fragment (an invite) must come back to the page that held it.
    expect(defaultEmailAuthNext("https://pubmaxxing.com/plan/abc#invite=SECRET-A"))
      .toBeUndefined();
    expect(defaultEmailAuthNext("not a URL")).toBeUndefined();
  });

  it("rejects external, protocol-relative, and backslash next targets", () => {
    const current = "https://pubmaxxing.com/map";
    const fallback = `https://pubmaxxing.com/auth/callback?_authAttempt=${ATTEMPT_A}`;
    expect(buildAuthCallbackUrl(current, "https://evil.example/phish", ATTEMPT_A)).toBe(fallback);
    expect(buildAuthCallbackUrl(current, "//evil.example/phish", ATTEMPT_A)).toBe(fallback);
    expect(buildAuthCallbackUrl(current, "/\\evil.example/phish", ATTEMPT_A)).toBe(fallback);
  });

  it("fails closed for non-web and malformed current URLs", () => {
    expect(buildAuthCallbackUrl("pubmaxx://map", "/map")).toBeNull();
    expect(buildAuthCallbackUrl("not a URL", "/map")).toBeNull();
  });
});
