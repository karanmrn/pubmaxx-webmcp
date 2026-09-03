import type { Metadata } from "next";

import { describe, expect, it, vi } from "vitest";

import {
  APP_NAME,
  BRAND_NAME,
  appPageTitle,
  metadataSiteName,
} from "@/lib/brandNaming";

// /pubs derives its own title from the row count, and the count is the only
// reason its metadata touches the dataset. The share-card name is what is under
// test here, so the read is stubbed rather than parsing the priced index.
vi.mock("@/lib/scrapedPubs.server", () => ({
  readScrapedPubsForPage: async () => ({ pubs: [], complete: true }),
}));

// next/font is a build-time loader, so the root layout needs its faces stubbed
// to be importable here. Nothing about the metadata under test reads them.
vi.mock("next/font/google", () => {
  const face = () => ({ variable: "--font-x", className: "font-x", style: {} });
  return { Space_Grotesk: face, Inter: face, JetBrains_Mono: face };
});

describe("brand naming (captain 2026-08-17)", () => {
  it("names the brand and app separately", () => {
    expect(BRAND_NAME).toBe("PUBMAXX");
    expect(APP_NAME).toBe("PUBMAXXING");
  });

  it("uses the app name in page titles", () => {
    expect(appPageTitle("Privacy")).toBe("Privacy · PUBMAXXING");
  });

  it("uses the brand in metadata siteName", () => {
    expect(metadataSiteName()).toBe("PUBMAXX");
  });
});

// Every route that restates openGraph must resolve the BRAND for siteName. App
// Router replaces a parent's openGraph object wholesale rather than merging it,
// so each of these owns its own share-card name, and the assertion runs their
// real `metadata` / `generateMetadata`: a page that reverts to "PUBMAXXING"
// fails here rather than shipping a wrong card. The list covers the routes the
// brand decision touched PLUS the ones that still hold the literal, so an edit
// to either group is caught.
const OG_SITE_NAME_PAGES: ReadonlyArray<[string, () => Promise<Metadata>]> = [
  ["/about", async () => (await import("@/app/about/page")).metadata],
  ["/out", async () => (await import("@/app/out/page")).metadata],
  ["/privacy", async () => (await import("@/app/privacy/page")).metadata],
  ["/terms", async () => (await import("@/app/terms/page")).metadata],
  ["/historic", async () => (await import("@/app/historic/page")).metadata],
  ["/pubs", async () => (await import("@/app/pubs/page")).generateMetadata()],
  ["/social", async () => (await import("@/app/social/page")).generateMetadata()],
  ["root layout", async () => (await import("@/app/layout")).metadata],
  ["/", async () => (await import("@/app/page")).metadata],
  ["/feed", async () => (await import("@/app/feed/page")).metadata],
  ["/crawls", async () => (await import("@/app/crawls/page")).metadata],
  [
    "/u/[handle]",
    async () =>
      (await import("@/app/u/[handle]/page")).generateMetadata({
        params: Promise.resolve({ handle: "karan" }),
      }),
  ],
  [
    "/landmark/[id]",
    async () => {
      const { landmarks } = await import("@/lib/landmarks");
      const id = landmarks[0]?.id;
      expect(id, "a landmark to ask about").toBeTruthy();
      const { generateMetadata } = await import("@/app/landmark/[id]/page");
      return generateMetadata({
        params: Promise.resolve({ id: id as string }),
      });
    },
  ],
];

// The document title a reader sees is the page's own title run through the
// root layout's template, so that is what the no-double-brand rule is about.
// Resolved with Next's own resolver rather than a restatement of it.
const TEMPLATED_TITLE_PAGES: ReadonlyArray<[string, () => Promise<Metadata>]> = [
  ["/about", async () => (await import("@/app/about/page")).metadata],
  ["/out", async () => (await import("@/app/out/page")).metadata],
  ["/privacy", async () => (await import("@/app/privacy/page")).metadata],
  ["/terms", async () => (await import("@/app/terms/page")).metadata],
  ["/pubs", async () => (await import("@/app/pubs/page")).generateMetadata()],
  ["/social", async () => (await import("@/app/social/page")).generateMetadata()],
];

describe("a document title carries the brand exactly once", () => {
  it.each(TEMPLATED_TITLE_PAGES)("%s", async (_route, load) => {
    const { resolveTitle } = await import(
      "next/dist/lib/metadata/resolvers/resolve-title.js"
    );
    const root = (await import("@/app/layout")).metadata;
    const template = (root.title as { template?: string }).template;
    expect(template).toBe(`%s | ${BRAND_NAME}`);

    const page = await load();
    const resolved = resolveTitle(page.title, template).absolute as string;

    expect(resolved.endsWith(` | ${BRAND_NAME}`)).toBe(true);
    expect(resolved.split(`| ${BRAND_NAME}`)).toHaveLength(2);
    expect(resolved).not.toContain(APP_NAME);
  });
});

describe("page metadata names the brand, never the app", () => {
  it.each(OG_SITE_NAME_PAGES)("%s carries the brand siteName", async (_route, load) => {
    const resolved = await load();
    expect(resolved.openGraph, "page restates openGraph").toBeTruthy();
    expect(
      (resolved.openGraph as { siteName?: string }).siteName,
    ).toBe(BRAND_NAME);
  });

  it("names the app, never the brand, in the share-card title", async () => {
    const privacy = (await import("@/app/privacy/page")).metadata;
    const privacyCardTitle = (privacy.openGraph as { title?: string }).title;
    expect(privacyCardTitle).toBe(appPageTitle("Privacy"));

    const social = await (await import("@/app/social/page")).generateMetadata();
    expect((social.openGraph as { title?: string }).title).toContain(APP_NAME);
  });
});
