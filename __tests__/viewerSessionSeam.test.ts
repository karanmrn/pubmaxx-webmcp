// A sign-in door is a CLAIM about the viewer, and a claim needs an answer.
//
// DEFECT (captain, live, 2026-09-01): signed in on a phone, Social answered
// "Sign in to use Social" and "Sign in to invite", and the captain's own
// profile answered "Sign in to follow", "Sign in to message" and a whole
// "Continue with email" form. The session was intact. Two faults, one law:
//
//  1. The browser Supabase client is a lazily imported chunk. When that import
//     REJECTS - a deploy has just moved the chunk URLs, a phone drops the
//     download - AuthProvider had no handler, so the 20 second bootstrap
//     ceiling settled the provider "signed out" from a read that never ran,
//     for the life of the tab. lib/authClientLoad.ts makes that outcome its
//     own word and retries it.
//  2. Surface after surface read `user === null` as sign-out. #1239 taught the
//     landing header to wait for the live session; nothing carried that rule
//     anywhere else. components/auth/useViewerSession.ts is that rule as ONE
//     seam.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  AUTH_CLIENT_LOAD_RETRY_DELAYS_MS,
  AUTH_CLIENT_LOAD_TIMEOUT_MS,
  loadAuthClientWithRetry,
} from "@/lib/authClientLoad";
import { AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS } from "@/lib/authSessionBootstrap";

const REPO_ROOT = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith(".tsx")) found.push(full);
    }
  };
  walk(join(REPO_ROOT, dir));
  return found;
}

/**
 * The one argued exception. `ContributionGateDialog` is presentational: its
 * `mode` is decided by the account-bound contribution lane, which is a server
 * ANSWER rather than a guess off a null user, and the dialog only mounts once
 * a reader has asked to contribute.
 */
const AMBIENT_DOOR_EXCEPTIONS: Readonly<Record<string, string>> = {
  "components/identity/ContributionGateDialog.tsx":
    "the account-bound contribution action supplies its server decision",
  "components/map/VenueWeatherRecommendations.tsx":
    "the contribution button delegates its decision to the account-bound gate",
  "components/visits/VisitReportPanel.tsx":
    "the contribution button delegates its decision to the account-bound gate",
};

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\r?\n)\s*\/\/[^\r\n]*/g, "$1");
}

function isAuthInfrastructure(relative: string): boolean {
  return (
    relative.startsWith("components/auth/") ||
    relative.startsWith("app/login/") ||
    relative.startsWith("app/signin/")
  );
}

function hasAmbientDoorSignal(source: string): boolean {
  return (
    source.includes('from "@/components/auth/SignInButton"') ||
    source.includes("from '@/components/auth/SignInButton'") ||
    /<(?:Link|a)\b[^>]*\bhref\s*=\s*[^>]*\/login/.test(source) ||
    /\bSign in to\b/.test(source)
  );
}

function hasViewerAuthRead(source: string): boolean {
  return (
    source.includes("useAuth(") ||
    source.includes("useViewerHandle(") ||
    source.includes("identityResolved")
  );
}

describe("every ambient sign-in door waits for the live session", () => {
  it("routes every identity-aware door through the session seam", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components"]) {
      for (const file of sourceFiles(dir)) {
        const relative = file.slice(REPO_ROOT.length + 1);
        if (isAuthInfrastructure(relative) || relative in AMBIENT_DOOR_EXCEPTIONS) continue;
        const source = withoutComments(readFileSync(file, "utf8"));
        if (!hasAmbientDoorSignal(source) || !hasViewerAuthRead(source)) continue;
        if (source.includes("useViewerSession(")) continue;
        offenders.push(relative);
      }
    }

    expect(
      offenders,
      "a null user is not sign-out: read components/auth/useViewerSession.ts",
    ).toEqual([]);

    expect(
      Object.values(AMBIENT_DOOR_EXCEPTIONS).every((reason) => reason.trim()),
    ).toBe(true);
  });

  it("keeps the seam itself free of a device-cache fallback", () => {
    const seam = readFileSync(
      join(REPO_ROOT, "components/auth/useViewerSession.ts"),
      "utf8",
    );
    // The device handle is exactly where the PREVIOUS account's identity
    // lives, so this seam may never reach for it (deviceAccountIdentity.ts).
    expect(seam).not.toContain("readDeviceHandle");
    expect(seam).not.toContain("localStorage");
  });
});

describe("a load we could not run is not an answer about the viewer", () => {
  const noWait = { delay: async () => {}, retryDelaysMs: [0, 0] as const };

  it("answers ready with the client", async () => {
    const outcome = await loadAuthClientWithRetry(async () => "client", noWait);
    expect(outcome).toEqual({ status: "ready", client: "client" });
  });

  it("answers unconfigured for a null, and never retries the env", async () => {
    let calls = 0;
    const outcome = await loadAuthClientWithRetry(async () => {
      calls += 1;
      return null;
    }, noWait);

    expect(outcome).toEqual({ status: "unconfigured" });
    expect(calls, "the env answers the same way every time").toBe(1);
  });

  it("retries a rejected load and answers ready when it lands", async () => {
    let calls = 0;
    const outcome = await loadAuthClientWithRetry(async () => {
      calls += 1;
      if (calls < 3) throw new Error("chunk 404");
      return "client";
    }, noWait);

    expect(outcome).toEqual({ status: "ready", client: "client" });
    expect(calls).toBe(3);
  });

  it("answers unavailable, never signed-out, once the retries are spent", async () => {
    const waits: number[] = [];
    const outcome = await loadAuthClientWithRetry(
      async () => {
        throw new Error("chunk 404");
      },
      {
        delay: async (ms) => {
          waits.push(ms);
        },
      },
    );

    expect(outcome).toEqual({ status: "unavailable" });
    expect(waits).toEqual([...AUTH_CLIENT_LOAD_RETRY_DELAYS_MS]);
  });

  it("is bounded, so a broken deployment settles rather than retrying for ever", () => {
    expect(AUTH_CLIENT_LOAD_RETRY_DELAYS_MS.length).toBeGreaterThan(0);
    expect(AUTH_CLIENT_LOAD_RETRY_DELAYS_MS.length).toBeLessThanOrEqual(5);
    expect(AUTH_CLIENT_LOAD_TIMEOUT_MS).toBeGreaterThan(0);
    expect(AUTH_CLIENT_LOAD_TIMEOUT_MS).toBeLessThan(AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS);
  });

  it("answers unavailable when the client import stays pending", async () => {
    const outcome = await loadAuthClientWithRetry(
      () => new Promise<"client">(() => {}),
      { delay: async () => {}, retryDelaysMs: [], timeoutMs: 1 },
    );

    expect(outcome).toEqual({ status: "unavailable" });
  });
});

describe("AuthProvider never publishes a sign-out it did not read", () => {
  const provider = readFileSync(
    join(REPO_ROOT, "components/auth/AuthProvider.tsx"),
    "utf8",
  );

  it("loads the browser client through the retrying seam", () => {
    expect(provider).toContain("loadAuthClientWithRetry(ensureSupabaseBrowser");
    // A bare `.then` on the load left the rejection unhandled, which is how the
    // ceiling came to answer for it.
    expect(provider).not.toContain("ensureSupabaseBrowser().then(");
  });

  it("stops the bootstrap ceiling from answering for an unavailable load", () => {
    const branch = provider.slice(provider.indexOf('outcome.status === "unavailable"'));
    const body = branch.slice(0, branch.indexOf("const supabase ="));
    expect(body).toContain("clearTimeout(loadingTimeout)");
    expect(body).toContain("requestDeploymentSkewCheck()");
    expect(body).toContain('setProviderAuthState("supabase", "unavailable")');
    expect(body).toContain("setSessionLoading(false)");
  });
});
