import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ configured: true }),
}));
vi.mock("@/lib/authClient", () => ({ ensureSupabaseBrowser: async () => null }));
vi.mock("@/lib/authSessionResumeClient", () => ({
  persistSessionForResume: async () => {},
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: () => {} }));

import { navigateAfterHandlePasswordSignIn } from "@/components/auth/HandlePasswordSignIn";

const ORIGIN = "https://pubmaxxing.com";

function assignedBy(redirectTo: string | null): {
  calls: string[];
  landedOrigin: string | null;
} {
  const calls: string[] = [];
  navigateAfterHandlePasswordSignIn(redirectTo, {
    origin: ORIGIN,
    assign: (url: string | URL) => {
      calls.push(String(url));
    },
  });
  const landed = calls[0];
  // Resolve the way a browser does. WHATWG URL parsing strips ASCII tab, CR
  // and LF before it looks at the value, which is exactly the trick a prefix
  // check misses.
  return {
    calls,
    landedOrigin: landed === undefined ? null : new URL(landed, ORIGIN).origin,
  };
}

describe("where a handle and password sign-in lands", () => {
  it("takes an ordinary in-site destination", () => {
    expect(assignedBy("/add/karan?auto=1").calls).toEqual(["/add/karan?auto=1"]);
    expect(assignedBy("/add/karan?auto=1").landedOrigin).toBe(ORIGIN);
  });

  it("never lands off-site, whatever the page was handed", () => {
    const hostile = [
      "/\t/evil.example",
      decodeURIComponent("/%09/evil.example"),
      "/\n/evil.example",
      "/\r/evil.example",
      "//evil.example",
      "/\\evil.example",
      "\\\\evil.example",
      "https://evil.example/",
      "javascript:alert(1)",
      " //evil.example",
    ];
    for (const redirectTo of hostile) {
      const { calls, landedOrigin } = assignedBy(redirectTo);
      expect(landedOrigin, `landed off-site for ${JSON.stringify(redirectTo)}`).toBe(
        ORIGIN,
      );
      expect(calls[0]?.startsWith("/")).toBe(true);
    }
  });

  it("stays put when the page named no destination", () => {
    expect(assignedBy(null).calls).toEqual([]);
    expect(assignedBy("").calls).toEqual([]);
  });
});
