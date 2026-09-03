import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";

// next.config.mjs is plain JS with no type declaration; import it and pin the
// shape locally so the test stays typed without a bespoke .d.ts.
// @ts-expect-error -- no declaration file for the JS config module.
import nextConfigModule from "@/next.config.mjs";

const nextConfig = nextConfigModule as NextConfig;

type HasCondition = { type: string; value?: string; key?: string };
type RedirectRule = {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: HasCondition[];
};

async function loadRedirects(): Promise<RedirectRule[]> {
  expect(typeof nextConfig.redirects).toBe("function");
  return (await nextConfig.redirects!()) as RedirectRule[];
}

// SEO split-brain fix (docs/SEO_CANONICAL_RUNBOOK_2026-07-21.md): www must not
// serve a 200 mirror — it has to 308 to the apex so Google collapses the two
// hosts into one indexed site.
describe("www → apex host redirect", () => {
  it("permanently redirects the www host to the apex for every path", async () => {
    const rule = (await loadRedirects()).find(
      (entry) =>
        entry.source === "/:path*" &&
        entry.has?.some(
          (c) => c.type === "host" && c.value === "www.pubmaxxing.com",
        ),
    );
    expect(rule).toBeDefined();
    expect(rule).toMatchObject({
      source: "/:path*",
      destination: "https://pubmaxxing.com/:path*",
      permanent: true,
    });
  });

  it("only fires for the www host, never self-redirecting the apex", async () => {
    const rule = (await loadRedirects()).find(
      (entry) =>
        entry.source === "/:path*" &&
        entry.has?.some((c) => c.type === "host"),
    );
    const hosts = (rule?.has ?? [])
      .filter((c) => c.type === "host")
      .map((c) => c.value);
    expect(hosts).toEqual(["www.pubmaxxing.com"]);
  });

  it("targets the HTTPS apex origin so the redirect resolves the host in one hop", async () => {
    const rule = (await loadRedirects()).find(
      (entry) =>
        entry.source === "/:path*" &&
        entry.has?.some(
          (c) => c.type === "host" && c.value === "www.pubmaxxing.com",
        ),
    );
    expect(rule?.destination.startsWith("https://pubmaxxing.com")).toBe(true);
  });
});
