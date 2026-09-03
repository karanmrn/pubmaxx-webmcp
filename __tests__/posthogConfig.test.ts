import type { NextConfig } from "next";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { securityProxy } from "@/proxy";

// next.config.mjs is plain JS with no declaration file. Match existing config
// tests and pin its framework-owned shape locally.
// @ts-expect-error -- no declaration file for the JS config module.
import nextConfigModule from "@/next.config.mjs";

const nextConfig = nextConfigModule as NextConfig;

describe("PostHog EU reverse proxy", () => {
  it("does not bypass the owned ingest boundary with framework rewrites", () => {
    expect(nextConfig.rewrites).toBeUndefined();
    expect(nextConfig.skipTrailingSlashRedirect).toBe(true);
  });

  it("preserves slashless canonical redirects outside ingest", () => {
    const pageResponse = securityProxy(new NextRequest("https://pubmaxxing.com/map/?mode=cheap"));
    const apiResponse = securityProxy(new NextRequest("https://pubmaxxing.com/api/events/?mode=test"));

    expect(pageResponse.status).toBe(308);
    expect(pageResponse.headers.get("location")).toBe("https://pubmaxxing.com/map?mode=cheap");
    expect(apiResponse.status).toBe(308);
    expect(apiResponse.headers.get("location")).toBe("https://pubmaxxing.com/api/events?mode=test");
  });

  it("preserves trailing slashes inside the owned ingest boundary", () => {
    const response = securityProxy(new NextRequest("https://pubmaxxing.com/ingest/e/?ip=1"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

describe("analytics Content Security Policy", () => {
  it("allows the consent-gated Vercel Analytics SDK to load", () => {
    const response = securityProxy(new NextRequest("https://pubmaxxing.com/map"));
    const csp = response.headers.get("content-security-policy") ?? "";

    expect(csp).toMatch(
      /script-src[^;]*https:\/\/va\.vercel-scripts\.com/,
    );
  });
});
