import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Route modules can run assertServerEnv() at import scope. Homepage is light
// but keep the house pattern available if a sibling pulls serverEnv later.
vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
// Layout / page imports pull server-only modules; stub like cityMapMetadata.
vi.mock("server-only", () => ({}));
// next/font is not runnable under vitest; stub faces so the root layout can
// export metadata without constructing real font CSS.
vi.mock("next/font/google", () => {
  const face = () => ({ className: "font-mock", variable: "--font-mock" });
  return {
    Space_Grotesk: face,
    Inter: face,
    JetBrains_Mono: face,
  };
});

import robots from "@/app/robots";
import { securityProxy } from "@/proxy";
import { PRODUCTION_SITE_ORIGIN } from "@/lib/siteUrlConfig.mjs";
import { metadata as homeMetadata } from "@/app/page";
import { metadata as rootMetadata } from "@/app/layout";

afterEach(() => {
  vi.unstubAllEnvs();
});

function ruleList(
  policy: ReturnType<typeof robots>,
): Array<{
  userAgent?: string | string[];
  allow?: string | string[];
  disallow?: string | string[];
}> {
  return Array.isArray(policy.rules) ? policy.rules : [policy.rules];
}

function disallowPaths(policy: ReturnType<typeof robots>): string[] {
  return ruleList(policy).flatMap((rule) => {
    if (rule.disallow === undefined) return [];
    return Array.isArray(rule.disallow) ? rule.disallow : [rule.disallow];
  });
}

describe("preview deployments must not be indexable", () => {
  it("serves a crawl-friendly robots policy only on VERCEL_ENV=production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const production = robots();

    expect(production.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userAgent: "*",
          allow: "/",
          disallow: expect.arrayContaining(["/api/", "/admin", "/p/"]),
        }),
      ]),
    );
    expect(production.sitemap).toBe(`${PRODUCTION_SITE_ORIGIN}/sitemap.xml`);
    expect(production.host).toBe(PRODUCTION_SITE_ORIGIN);

    // Named AI crawlers stay explicitly welcome on production (do not narrow).
    const agents = ruleList(production).map((rule) => rule.userAgent);
    expect(agents).toEqual(
      expect.arrayContaining([
        "GPTBot",
        "ClaudeBot",
        "Claude-User",
        "PerplexityBot",
        "Google-Extended",
        "Bingbot",
      ]),
    );
  });

  it("disallows everything under VERCEL_ENV=preview and differs from production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const production = robots();

    vi.stubEnv("VERCEL_ENV", "preview");
    const preview = robots();

    // Must FAIL against origin/main: today robots() ignores VERCEL_ENV.
    expect(preview).not.toEqual(production);

    const rules = ruleList(preview);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      // "/" is the standard robots.txt "block everything" form.
      const disallow = Array.isArray(rule.disallow)
        ? rule.disallow
        : [rule.disallow];
      expect(disallow).toContain("/");
      // Must not re-advertise public crawlability on a preview host.
      expect(rule.allow).not.toBe("/");
    }
    expect(preview.sitemap).toBeUndefined();
    expect(preview.host).toBeUndefined();
  });

  it("also blocks development deployments the same way as preview", () => {
    vi.stubEnv("VERCEL_ENV", "development");
    expect(disallowPaths(robots())).toContain("/");
  });

  it("emits X-Robots-Tag: noindex, nofollow when VERCEL_ENV is not production", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const response = securityProxy(
      new NextRequest("https://preview.example/about", {
        headers: { host: "preview.example" },
      }),
    );
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("does not emit X-Robots-Tag on production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const response = securityProxy(
      new NextRequest("https://pubmaxxing.com/about", {
        headers: { host: "pubmaxxing.com" },
      }),
    );
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });
});

describe("production origin is the only indexable canonical base", () => {
  it("homepage canonical resolves against the production origin", () => {
    // metadataBase is the single place relative alternates.canonical resolve
    // against. It must be the production origin so a preview host cannot
    // advertise itself as the canonical product URL.
    const base = rootMetadata.metadataBase;
    expect(base).toBeInstanceOf(URL);
    if (!(base instanceof URL)) {
      throw new Error("expected metadataBase to be a URL instance");
    }
    expect(base.origin).toBe(PRODUCTION_SITE_ORIGIN);
    expect(base.href).toBe(`${PRODUCTION_SITE_ORIGIN}/`);

    const canonical = homeMetadata.alternates?.canonical;
    expect(canonical).toBeTruthy();
    expect(new URL(String(canonical), base).href).toBe(
      `${PRODUCTION_SITE_ORIGIN}/`,
    );
  });
});
