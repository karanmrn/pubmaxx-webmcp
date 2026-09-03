import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";

// next.config.mjs is plain JS with no type declaration; import it and pin the
// shape locally so the test stays typed without a bespoke .d.ts.
// @ts-expect-error -- no declaration file for the JS config module.
import nextConfigModule from "@/next.config.mjs";

const nextConfig = nextConfigModule as NextConfig;

type RedirectRule = {
  source: string;
  destination: string;
  permanent?: boolean;
};

async function loadRedirects(): Promise<RedirectRule[]> {
  expect(typeof nextConfig.redirects).toBe("function");
  return (await nextConfig.redirects!()) as RedirectRule[];
}

describe("next.config redirects", () => {
  it.each([
    ["/feed", "/social"],
    ["/feed/:path*", "/social"],
    ["/stories", "/social"],
    ["/stories/:path*", "/social"],
    ["/discover", "/social?tab=discover"],
    ["/discover/:path*", "/social?tab=discover"],
    ["/drinks", "/social?tab=discover"],
    ["/drinks/:path*", "/social?tab=discover"],
  ])("redirects %s straight to canonical Social", async (source, destination) => {
    const rule = (await loadRedirects()).find((entry) => entry.source === source);
    expect(rule).toMatchObject({ source, destination, permanent: true });
  });

  it("sends the bare /you path to the canonical /u/you profile route permanently", async () => {
    const rule = (await loadRedirects()).find((entry) => entry.source === "/you");
    expect(rule).toMatchObject({
      source: "/you",
      destination: "/u/you",
      permanent: true,
    });
  });

  it("sends /our-story to /about permanently", async () => {
    const rule = (await loadRedirects()).find((entry) => entry.source === "/our-story");
    expect(rule).toMatchObject({
      source: "/our-story",
      destination: "/about",
      permanent: true,
    });
  });

  it("sends /story to /about permanently", async () => {
    const rule = (await loadRedirects()).find((entry) => entry.source === "/story");
    expect(rule).toMatchObject({
      source: "/story",
      destination: "/about",
      permanent: true,
    });
  });
});
