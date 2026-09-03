import { describe, expect, it, vi } from "vitest";

import {
  clearLegacyPkceVerifiers,
  establishAuthCallbackSession,
} from "@/lib/authCallbackClient";

describe("explicit implicit-flow callback completion", () => {
  it("returns the established session", async () => {
    const session = { access_token: "access" };
    const setSession = vi.fn().mockResolvedValue({
      data: { session },
      error: null,
    });

    await expect(
      establishAuthCallbackSession(
        { setSession },
        { accessToken: "access", refreshToken: "refresh" },
      ),
    ).resolves.toEqual({ session, failed: false });
    expect(setSession).toHaveBeenCalledOnce();
    expect(setSession).toHaveBeenCalledWith({
      access_token: "access",
      refresh_token: "refresh",
    });
  });

  it("normalizes provider and network failures", async () => {
    const providerFailure = vi.fn().mockResolvedValue({
      data: { session: null },
      error: { code: "bad_jwt" },
    });
    const networkFailure = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(
      establishAuthCallbackSession(
        { setSession: providerFailure },
        { accessToken: "expired", refreshToken: "refresh" },
      ),
    ).resolves.toEqual({ session: null, failed: true });
    await expect(
      establishAuthCallbackSession(
        { setSession: networkFailure },
        { accessToken: "access", refreshToken: "refresh" },
      ),
    ).resolves.toEqual({ session: null, failed: true });
  });
});

describe("legacy PKCE verifier cleanup", () => {
  function keyedStorage(initial: string[]) {
    const keys = [...initial];
    return {
      keys,
      storage: {
        get length() {
          return keys.length;
        },
        key: (index: number) => keys[index] ?? null,
        removeItem: (key: string) => {
          const at = keys.indexOf(key);
          if (at >= 0) keys.splice(at, 1);
        },
      },
    };
  }

  it("removes only supabase code-verifier keys and keeps live state", () => {
    const { keys, storage } = keyedStorage([
      "sb-iankaj-auth-token-code-verifier",
      "sb-iankaj-auth-token",
      "sb-other-auth-token-code-verifier",
      "pubmax_handle",
      "unrelated-auth-token-code-verifier",
    ]);

    clearLegacyPkceVerifiers(storage);

    expect(keys).toEqual([
      "sb-iankaj-auth-token",
      "pubmax_handle",
      "unrelated-auth-token-code-verifier",
    ]);
  });

  it("tolerates missing or blocked storage", () => {
    expect(() => clearLegacyPkceVerifiers(null)).not.toThrow();
    expect(() =>
      clearLegacyPkceVerifiers({
        get length(): number {
          throw new Error("blocked");
        },
        key: () => null,
        removeItem: () => {},
      }),
    ).not.toThrow();
  });
});
