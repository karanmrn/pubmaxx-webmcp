import { afterEach, describe, expect, it, vi } from "vitest";

import {
  emitIdentityHandleChanged,
  handleClaimRouteAfterSignIn,
  identityHandleForOwner,
  resolveCanonicalIdentity,
} from "@/lib/identityClient";

describe("identity handle events", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts handle changes only for the current account", () => {
    const detail = { ownerId: "user-a", handle: "alice" };

    expect(identityHandleForOwner(detail, "user-a")).toBe("alice");
    expect(identityHandleForOwner(detail, "user-b")).toBeNull();
    expect(identityHandleForOwner(detail, null)).toBeNull();
  });

  it("rejects legacy unscoped handle events", () => {
    expect(identityHandleForOwner({ handle: "alice" }, "user-a")).toBeNull();
  });

  it("invalidates matching anonymous Round identity when claimed", () => {
    const values = new Map<string, string>([
      [
        "pubmax_round_anonymous_identity_v1",
        JSON.stringify({ owner: "anonymous", handle: "bob" }),
      ],
    ]);
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    vi.stubGlobal("window", {
      localStorage,
      dispatchEvent: vi.fn(),
    });

    emitIdentityHandleChanged({ ownerId: "user-bob", handle: "@Bob" });

    expect(values.has("pubmax_round_anonymous_identity_v1")).toBe(false);
  });

  it("preserves an unrelated anonymous Round identity after a claim", () => {
    const stored = JSON.stringify({ owner: "anonymous", handle: "alice" });
    const values = new Map<string, string>([
      ["pubmax_round_anonymous_identity_v1", stored],
    ]);
    const localStorage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    vi.stubGlobal("window", {
      localStorage,
      dispatchEvent: vi.fn(),
    });

    emitIdentityHandleChanged({ ownerId: "user-bob", handle: "bob" });

    expect(values.get("pubmax_round_anonymous_identity_v1")).toBe(stored);
  });

  it("resolves canonical identity with captured auth and clears its anonymous marker", async () => {
    const values = new Map<string, string>([
      [
        "pubmax_round_anonymous_identity_v1",
        JSON.stringify({ owner: "anonymous", handle: "bob" }),
      ],
    ]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
    const request = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer token-a",
        );
        return Response.json({ handle: "Bob" });
      },
    );

    const result = await resolveCanonicalIdentity(
      "user-a",
      { access_token: "token-a", user: { id: "user-a" } } as never,
      storage,
      request,
    );

    expect(result).toEqual({
      ok: true,
      identity: { ownerId: "user-a", handle: "bob" },
    });
    expect(values.has("pubmax_round_anonymous_identity_v1")).toBe(false);
    expect(values.get("pubmax_handle")).toBe("bob");
  });
});

describe("post-callback handle claim routing", () => {
  const SESSION = {
    access_token: "token-a",
    user: { id: "user-a" },
  } as never;

  function storageWith(values: Map<string, string>) {
    return {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    };
  }

  function requestAnswering(handle: string | null) {
    return vi.fn(async () => Response.json({ handle }));
  }

  it("routes a session with no claimed handle to /u/you", async () => {
    await expect(
      handleClaimRouteAfterSignIn(
        SESSION,
        "/map?area=soho",
        storageWith(new Map()),
        requestAnswering(null),
      ),
    ).resolves.toBe("/u/you");
  });

  it("stays put when the account already has a handle", async () => {
    const storage = storageWith(new Map());
    await expect(
      handleClaimRouteAfterSignIn(
        SESSION,
        "/map",
        storage,
        requestAnswering("alice"),
      ),
    ).resolves.toBeNull();
    expect(storage.getItem("pubmax_handle")).toBe("alice");
  });

  it("stays put on a device handle THIS account owns, without asking the server", async () => {
    const request = requestAnswering(null);
    await expect(
      handleClaimRouteAfterSignIn(
        SESSION,
        "/map",
        storageWith(
          new Map([
            ["pubmax_handle", "alice"],
            ["pubmax_account_owner", "user-a"],
          ]),
        ),
        request,
      ),
    ).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("asks the server when the device handle belongs to another account", async () => {
    // The founder's browser: @karan is still cached from the account that just
    // signed out. Taking it as proof skipped BOTH the canonical read and the
    // claim step, so the new account browsed under the old one's name.
    const request = requestAnswering(null);
    await expect(
      handleClaimRouteAfterSignIn(
        SESSION,
        "/map",
        storageWith(
          new Map([
            ["pubmax_handle", "karan"],
            ["pubmax_account_owner", "user-previous"],
          ]),
        ),
        request,
      ),
    ).resolves.toBe("/u/you");
    expect(request).toHaveBeenCalled();
  });

  it("asks the server when nobody stamped the device handle", async () => {
    const request = requestAnswering(null);
    await expect(
      handleClaimRouteAfterSignIn(
        SESSION,
        "/map",
        storageWith(new Map([["pubmax_handle", "karan"]])),
        request,
      ),
    ).resolves.toBe("/u/you");
    expect(request).toHaveBeenCalled();
  });

  it("never bounces a restored return fragment or the claim surface itself", async () => {
    const request = requestAnswering(null);
    await expect(
      handleClaimRouteAfterSignIn(
        SESSION,
        "/plan/abc#invite=SECRET-A",
        storageWith(new Map()),
        request,
      ),
    ).resolves.toBeNull();
    await expect(
      handleClaimRouteAfterSignIn(SESSION, "/u/you", storageWith(new Map()), request),
    ).resolves.toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("treats a failed or unreadable server answer as no evidence", async () => {
    const failing = vi.fn(async () => new Response("nope", { status: 500 }));
    const offline = vi.fn(async () => {
      throw new Error("offline");
    });
    await expect(
      handleClaimRouteAfterSignIn(SESSION, "/map", storageWith(new Map()), failing),
    ).resolves.toBeNull();
    await expect(
      handleClaimRouteAfterSignIn(SESSION, "/map", storageWith(new Map()), offline),
    ).resolves.toBeNull();
    await expect(
      handleClaimRouteAfterSignIn(null, "/map", storageWith(new Map()), failing),
    ).resolves.toBeNull();
  });
});
