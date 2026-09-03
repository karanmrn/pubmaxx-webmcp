import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  resolveSocialAccess,
  type SocialAccessServerDependencies,
} from "@/lib/socialAccessServer";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
} from "@/lib/socialLaunch";

const ROOT = process.cwd();
const USER_ID = "44444444-4444-4444-8444-444444444444";

const RETIREMENT_SCAN_PATHS = [
  "app",
  "components",
  "lib",
  "convex",
  "docs",
  "supabase",
  "app/api/identity/adult-assertion/route.ts",
  "lib/trustedHandoffFlags.server.ts",
  ".env.example",
  "capacitor.config.ts",
  "eslint.config.mjs",
  "next.config.mjs",
  "package.json",
  "playwright.config.ts",
  "postcss.config.mjs",
  "proxy.ts",
  "tsconfig.json",
  "vitest.config.ts",
  "vercel.json",
  ".github/workflows",
];

const ACTIVE_DEPLOYMENT_SCAN_PATHS = ["vercel.json", ".github/workflows"] as const;
const ACTIVE_APPLICATION_SCAN_PATHS = ["app", "components", "lib", "convex"] as const;

const SOCIAL_ACCESS_CODE_PATHS = [
  "app/api/social",
  "app/social",
  "components/social",
  "convex",
  "lib/socialAccess.ts",
  "lib/socialAccessServer.ts",
  "lib/socialLaunch.ts",
  "app/api/identity/adult-assertion/route.ts",
];

// Historical plans/proof, migration compatibility, generated payloads, and
// test/e2e fixtures may retain the retired names as evidence. They are not
// active access/configuration surfaces and stay outside this fence.
const RETIREMENT_SCAN_EXCLUSIONS = [
  "docs/superpowers/",
  "docs/proof/",
  "docs/archive/",
  "supabase/migrations/",
  "public/data/",
  "__tests__/",
  "e2e/",
  "node_modules/",
  ".next/",
  ".git/",
];

const TEXT_FILE_EXTENSIONS = new Set([
  ".cjs",
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".sql",
  ".ts",
  ".tsx",
  ".yml",
  ".yaml",
]);

const RETIRED_MARKERS = [
  "SOCIAL_INVITE_BETA_ENABLED",
  "SOCIAL_BETA_DISABLED",
  "isSocialInviteBetaEnabled",
  "migrateSocialProductAccount",
];

const LEGACY_SOCIAL_REFERENCE =
  /\b(?:verifyClerkSession|clerkSession|clerkIdentity|isSocialInviteBetaEnabled|migrateSocialProductAccount)\b|(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["'][^"']*(?:clerk|yoti)[^"']*["']/i;

const LEGACY_SOCIAL_REFERENCE_FIXTURES = [
  {
    name: "dynamic provider import",
    source: 'const auth = await import("@/lib/clerkAuth");',
  },
  {
    name: "renamed provider import",
    source: 'import { verifySession as verify } from "@/lib/clerkAuth";',
  },
] as const;

function filesAt(relativePath: string): string[] {
  if (
    RETIREMENT_SCAN_EXCLUSIONS.some(
      (prefix) => relativePath === prefix.slice(0, -1) || relativePath.startsWith(prefix),
    )
  ) {
    return [];
  }
  const absolutePath = join(ROOT, relativePath);
  if (statSync(absolutePath).isFile()) {
    if (RETIREMENT_SCAN_PATHS.includes(relativePath)) return [relativePath];
    const extension = relativePath.slice(relativePath.lastIndexOf("."));
    return TEXT_FILE_EXTENSIONS.has(extension) || !relativePath.includes(".")
      ? [relativePath]
      : [];
  }
  return readdirSync(absolutePath, { withFileTypes: true }).flatMap((entry) =>
    filesAt(join(relativePath, entry.name)),
  );
}

function sourceFiles(paths: readonly string[]): Map<string, string> {
  return new Map(
    Array.from(new Set(paths.flatMap(filesAt))).map((relativePath) => [
      relativePath,
      readFileSync(join(ROOT, relativePath), "utf8"),
    ]),
  );
}

function dependencies(
  overrides: Partial<SocialAccessServerDependencies> = {},
): SocialAccessServerDependencies {
  return {
    friendsLaunchEnabled: true,
    now: () => new Date("2026-08-30T20:00:00.000Z"),
    verifySupabaseSession: async () => ({
      status: "verified" as const,
      userId: USER_ID,
    }),
    readFriendsLaunchAccess: async () => ({
      account: {
        id: "account-1",
        ownershipState: "active" as const,
      },
      profile: { id: "profile-1", handle: "alice" },
      dateOfBirth: "1990-01-01",
    }),
    ...overrides,
  };
}

describe("retired Social beta access boundary", () => {
  it("scans active deployment configuration roots", () => {
    expect(RETIREMENT_SCAN_PATHS).toEqual(
      expect.arrayContaining([...ACTIVE_DEPLOYMENT_SCAN_PATHS]),
    );

    const activeSources = sourceFiles(RETIREMENT_SCAN_PATHS);
    expect(activeSources.has("vercel.json")).toBe(true);
    expect(
      Array.from(activeSources.keys()).some((relativePath) =>
        relativePath.startsWith(".github/workflows/"),
      ),
    ).toBe(true);
    for (const [relativePath, source] of activeSources) {
      for (const marker of RETIRED_MARKERS) {
        expect(source, `${relativePath} still contains ${marker}`).not.toContain(
          marker,
        );
      }
    }
  });

  it("retires camel-case Clerk identity from active application sources", () => {
    const activeSources = sourceFiles([...ACTIVE_APPLICATION_SCAN_PATHS]);
    const offenders = Array.from(activeSources.entries())
      .filter(([, source]) => /\bclerkUserId\b/.test(source))
      .map(([relativePath]) => relativePath);

    expect(offenders).toEqual([]);
  });

  it("keeps snake-case database identity compatibility outside active scans", () => {
    const migrationPath =
      "supabase/migrations/20260806145754_0071_social_identity_assurance.sql";
    expect(filesAt(migrationPath)).toEqual([]);
    expect(readFileSync(join(ROOT, migrationPath), "utf8")).toContain(
      "clerk_user_id",
    );
  });

  it("keeps retired flags and legacy provider branches out of active surfaces", () => {
    const activeSources = sourceFiles(RETIREMENT_SCAN_PATHS);
    expect(activeSources.has(".env.example")).toBe(true);
    for (const [relativePath, source] of activeSources) {
      for (const marker of RETIRED_MARKERS) {
        expect(source, `${relativePath} still contains ${marker}`).not.toContain(
          marker,
        );
      }
    }

    const socialCode = sourceFiles(SOCIAL_ACCESS_CODE_PATHS);
    for (const [relativePath, source] of socialCode) {
      expect(source, `${relativePath} still contains legacy Social auth`).not.toMatch(
        LEGACY_SOCIAL_REFERENCE,
      );
    }
  });

  it("scans active Convex backend paths", () => {
    const activeSources = sourceFiles(RETIREMENT_SCAN_PATHS);
    expect(
      Array.from(activeSources.keys()).some((relativePath) =>
        relativePath.startsWith("convex/"),
      ),
    ).toBe(true);
  });

  it.each(LEGACY_SOCIAL_REFERENCE_FIXTURES)(
    "detects $name as a retired Social reference",
    ({ source }) => {
      expect(source).toMatch(LEGACY_SOCIAL_REFERENCE);
    },
  );

  it("keeps Supabase verified access and explicit emergency rollback", async () => {
    expect(isSocialFriendsLaunchEnabled(undefined)).toBe(true);
    expect(isSocialFriendsLaunchEnabled("1")).toBe(true);
    expect(isSocialFriendsLaunchEnabled("0")).toBe(false);

    const verify = vi.fn(async () => ({
      status: "verified" as const,
      userId: USER_ID,
    }));
    const read = vi.fn(async () => ({
      account: {
        id: "account-1",
        ownershipState: "active" as const,
      },
      profile: { id: "profile-1", handle: "alice" },
      dateOfBirth: "1990-01-01",
    }));
    await expect(
      resolveSocialAccess(undefined, dependencies({
        verifySupabaseSession: verify,
        readFriendsLaunchAccess: read,
      })),
    ).resolves.toEqual({
      available: true,
      state: "verified",
      actor: {
        accountId: "account-1",
        profileId: "profile-1",
        handle: "alice",
      },
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(USER_ID);

    const rollbackVerify = vi.fn(async () => ({
      status: "verified" as const,
      userId: USER_ID,
    }));
    await expect(
      resolveSocialAccess(
        undefined,
        dependencies({ friendsLaunchEnabled: false, verifySupabaseSession: rollbackVerify }),
      ),
    ).resolves.toEqual({ available: true, state: "preview" });
    expect(rollbackVerify).not.toHaveBeenCalled();
  });

  it("reads enabled and disabled launch values through default dependencies", async () => {
    const originalValue = process.env[SOCIAL_FRIENDS_LAUNCH_ENV];
    try {
      process.env[SOCIAL_FRIENDS_LAUNCH_ENV] = "1";
      await expect(resolveSocialAccess()).resolves.toEqual({
        available: true,
        state: "sign_in_required",
      });

      process.env[SOCIAL_FRIENDS_LAUNCH_ENV] = "0";
      await expect(resolveSocialAccess()).resolves.toEqual({
        available: true,
        state: "preview",
      });
    } finally {
      if (originalValue === undefined) delete process.env[SOCIAL_FRIENDS_LAUNCH_ENV];
      else process.env[SOCIAL_FRIENDS_LAUNCH_ENV] = originalValue;
    }
  });
});
