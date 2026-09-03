import { readFileSync } from "node:fs";
import { join } from "node:path";

import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { config, securityProxy } from "@/proxy";

beforeEach(() => {
  vi.stubEnv("VERCEL_URL", "");
  vi.stubEnv("VERCEL_BRANCH_URL", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function request(
  host: string,
  path = "/u/you",
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`https://request-origin.invalid:3210${path}`, {
    headers: { host, ...headers },
  });
}

function expectCanonicalRedirect(
  response: Response,
  location: string,
): void {
  expect(response.status).toBe(308);
  expect(response.headers.get("location")).toBe(location);
}

describe("Vercel production host canonicalisation", () => {
  it.each(["/", "/api/heritage", "/_next/static/chunks/app.js"])(
    "runs the proxy for Vercel path %s",
    (path) => {
      expect(
        unstable_doesMiddlewareMatch({
          config,
          url: `https://chengdu-pubmax69.vercel.app${path}`,
          headers: { host: "chengdu-pubmax69.vercel.app" },
        }),
      ).toBe(true);
    },
  );

  it("owns the generated Vercel hostname namespace without an alias list", () => {
    expect(config.matcher).toContainEqual({
      source: "/:path*",
      has: [{ type: "host", value: ".+\\.vercel\\.app" }],
    });
  });

  it("permanently redirects production Vercel hosts with path and query intact", () => {
    vi.stubEnv("VERCEL_ENV", "production");

    const response = securityProxy(
      request(
        "chengdu-pubmax69.vercel.app",
        "/map/where?sel=venue-xjf3n0&next=%2Fu%2Fyou",
      ),
    );

    expectCanonicalRedirect(
      response,
      "https://pubmaxxing.com/map/where?sel=venue-xjf3n0&next=%2Fu%2Fyou",
    );
  });

  it("redirects a promoted Preview artifact with its Preview settings retained", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const deploymentHost =
      "chengdu-auth-a1b2c3-pubmax69.vercel.app";
    vi.stubEnv(
      "VERCEL_BRANCH_URL",
      "chengdu-git-auth-preview-pubmax69.vercel.app",
    );

    expectCanonicalRedirect(
      securityProxy(
        request(
          "chengdu-pubmax69.vercel.app",
          "/map/where?sel=venue-xjf3n0&next=%2Fu%2Fyou",
          { "x-vercel-deployment-url": deploymentHost },
        ),
      ),
      "https://pubmaxxing.com/map/where?sel=venue-xjf3n0&next=%2Fu%2Fyou",
    );
  });

  it("redirects an excluded non-API proxy path on a production Vercel host", () => {
    vi.stubEnv("VERCEL_ENV", "production");

    expectCanonicalRedirect(
      securityProxy(
        request("chengdu-pubmax69.vercel.app", "/_next/static/chunks/app.js?v=1"),
      ),
      "https://pubmaxxing.com/_next/static/chunks/app.js?v=1",
    );
  });

  it("allows a Preview's generated deployment host without an extra opt-in", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const deploymentHost =
      "chengdu-auth-a1b2c3-pubmax69.vercel.app";

    const response = securityProxy(
      request(deploymentHost, "/u/you", {
        "x-vercel-deployment-url": deploymentHost,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows a Preview artifact's Vercel branch host", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const branchHost =
      "chengdu-git-auth-preview-pubmax69.vercel.app";
    vi.stubEnv("VERCEL_BRANCH_URL", branchHost);

    const response = securityProxy(request(branchHost));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("redirects a generated host outside the Preview environment", () => {
    vi.stubEnv("VERCEL_ENV", "production");

    expectCanonicalRedirect(
      securityProxy(request("chengdu-pubmax69.vercel.app")),
      "https://pubmaxxing.com/u/you",
    );
  });

  it.each([
    "pubmaxxing.com",
    "localhost:3000",
    "127.0.0.1:3000",
    "[::1]:3000",
    "192.168.1.20:3000",
  ])("passes through canonical and local host %s", (host) => {
    vi.stubEnv("VERCEL_ENV", "production");

    const response = securityProxy(request(host));

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});

// A scheduled job arrives on the deployment's own generated host and does not
// follow a redirect, so a 308 here is the job not running at all. The scheduled
// paths are read from the shipped vercel.json rather than restated, because a
// cron added there is exactly the one a hand-written list would miss.
const scheduledCronPaths: string[] = (
  JSON.parse(
    readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
  ) as { crons?: { path?: unknown }[] }
).crons!.map((cron) => {
  expect(typeof cron.path).toBe("string");
  return cron.path as string;
});

function expectServedWithoutRedirect(response: Response): void {
  expect(response.status).toBe(200);
  expect(response.headers.get("location")).toBeNull();
  expect(response.headers.get("x-middleware-next")).toBe("1");
}

describe("API callers on a generated Vercel host", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "production");
  });

  it("ships every scheduled path under the exempt /api prefix", () => {
    expect(scheduledCronPaths.length).toBeGreaterThan(0);
    for (const path of scheduledCronPaths) {
      expect(path.startsWith("/api/cron/")).toBe(true);
    }
  });

  it.each(scheduledCronPaths)(
    "serves scheduled path %s on the first request instead of redirecting",
    (path) => {
      expectServedWithoutRedirect(
        securityProxy(request("chengdu-pubmax69.vercel.app", path)),
      );
    },
  );

  it("still runs the proxy for a scheduled path on a generated host", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        url: "https://chengdu-pubmax69.vercel.app/api/cron/freshness-audit",
        headers: { host: "chengdu-pubmax69.vercel.app" },
      }),
    ).toBe(true);
  });

  it.each([
    "/api",
    "/api/heritage?venue=the-ship",
    "/api/social-connections/x/callback?code=abc",
    "/api/home-card",
  ])("serves ordinary API path %s rather than sending the caller away", (path) => {
    expectServedWithoutRedirect(
      securityProxy(request("chengdu-pubmax69.vercel.app", path)),
    );
  });

  it("keeps canonicalising a page document that merely starts with api", () => {
    expectCanonicalRedirect(
      securityProxy(request("chengdu-pubmax69.vercel.app", "/apiary")),
      "https://pubmaxxing.com/apiary",
    );
  });

  it.each(["/", "/u/you", "/map?sel=venue-xjf3n0", "/pint-index"])(
    "keeps canonicalising page document %s",
    (path) => {
      expectCanonicalRedirect(
        securityProxy(request("chengdu-pubmax69.vercel.app", path)),
        `https://pubmaxxing.com${path}`,
      );
    },
  );

  it("still trims a trailing slash so an API address the router cannot match is fixed", () => {
    const response = securityProxy(
      request("chengdu-pubmax69.vercel.app", "/api/cron/freshness-audit/"),
    );

    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "https://request-origin.invalid:3210/api/cron/freshness-audit",
    );
  });
});
