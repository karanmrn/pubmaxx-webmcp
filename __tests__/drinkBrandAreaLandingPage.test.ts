import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("next/og", () => ({
  ImageResponse: class ImageResponse {
    element: unknown;

    constructor(element: unknown) {
      this.element = element;
    }
  },
}));

vi.mock("@/lib/siteUrlConfig.mjs", () => ({
  PRODUCTION_SITE_ORIGIN: "https://example.test",
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-nonce": "test-nonce" }),
}));

vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return {
    ...actual,
    useRouter: () => ({
      back: () => undefined,
      forward: () => undefined,
      refresh: () => undefined,
      push: () => undefined,
      replace: () => undefined,
      prefetch: () => Promise.resolve(),
    }),
  };
});

import DrinkBrandAreaLandingPage, {
  dynamicParams,
  generateMetadata,
  generateStaticParams,
} from "@/app/area/[slug]/drink/[brand]/page";
import * as drinkBrandAreaLandingPageModule from "@/app/area/[slug]/drink/[brand]/page";
import DrinkBrandAreaLandingImage from "@/app/area/[slug]/drink/[brand]/opengraph-image";
import DrinkBrandAreaLandingContent from "@/components/drinks/DrinkBrandAreaLandingContent";
import {
  drinkBrandAreaLandingJsonLd,
  loadDrinkBrandAreaLanding,
  loadDrinkBrandAreaLandings,
} from "@/lib/drinkBrandAreaLanding.server";
import type { DrinkBrandAreaLanding } from "@/lib/drinkBrandAreaLanding";
import { formatObservedDate } from "@/lib/dataFreshness";
import { formatPricedLandingPublisherStatus } from "@/lib/pricedLanding";

function hrefFor(pathname: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  return `${pathname}?${query.toString()}`;
}

function htmlHref(href: string): string {
  return href.replaceAll("&", "&amp;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("governed drink brand by Night Area landing page", () => {
  it("keeps server route constants and derives static params from the loader", async () => {
    const landings = await loadDrinkBrandAreaLandings();

    expect(dynamicParams).toBe(false);
    // The nonce makes the document dynamic, so a revalidate window would bound
    // nothing and must not claim to.
    expect("revalidate" in drinkBrandAreaLandingPageModule).toBe(false);
    expect(await generateStaticParams()).toEqual(
      landings.map(({ areaSlug, brandSlug }) => ({ slug: areaSlug, brand: brandSlug })),
    );
    expect(landings.map(({ areaSlug, brandSlug }) => `${areaSlug}/${brandSlug}`)).toContain(
      "clapham/guinness",
    );
  });

  it("renders the answer, shared date, one map arrival, exact pub links, and row contribution URLs", async () => {
    const landing = await loadDrinkBrandAreaLanding("clapham", "guinness");
    expect(landing).not.toBeNull();

    const page = await DrinkBrandAreaLandingPage({
      params: Promise.resolve({ slug: "clapham", brand: "guinness" }),
    });
    const html = renderToStaticMarkup(page);
    const firstRow = landing!.rows[0]!;
    // Never ?q=<area name>: that is a free-text VENUE filter, so it narrows the
    // map to whatever pubs carry the area's words. The arrival is the pub the
    // page ranks first.
    const mapHref = hrefFor("/map", {
      sel: firstRow.venueId,
      brand: landing!.brandSlug,
    });

    expect(html).toContain(`<h1>Cheapest ${landing!.brandLabel} pints in ${landing!.areaName}</h1>`);
    expect(html).toContain(`From £${firstRow.priceGbp.toFixed(2)}`);
    expect(html).toContain(formatPricedLandingPublisherStatus(firstRow.publisher));
    expect(html).toContain(`Collected ${formatObservedDate(new Date(landing!.collectedAt))}.`);
    expect(html.match(new RegExp(`href="${escapeRegExp(htmlHref(mapHref))}"`, "g"))).toHaveLength(1);
    expect(html).not.toContain("q=Clapham");
    expect(html).not.toContain("drink=beer");
    expect(html.match(/<ol\b/g)).toHaveLength(1);
    expect(html.match(/<ol\b[^>]*\brole="list"/g)).toHaveLength(1);
    expect(
      html.match(
        /class="[^"]*\bdrinkBrandDirectory__row\b[^"]*"/g,
      ),
    ).toHaveLength(landing!.rows.length);
    expect(html).not.toContain('aria-label="Rank');
    expect(html.match(/href="\/ledger\//g)).toHaveLength(landing!.rows.length);

    for (const row of landing!.rows) {
      const ledgerHref = `/ledger/${encodeURIComponent(row.venueId)}`;
      const contributionHref = hrefFor("/map", {
        sel: row.venueId,
        brand: landing!.brandSlug,
        log: "1",
      });

      expect(html).toContain(`href="${htmlHref(ledgerHref)}"`);
      expect(html.match(new RegExp(`href="${escapeRegExp(htmlHref(contributionHref))}"`, "g"))).toHaveLength(1);
      expect(html).toContain("Log this price");
    }
  });

  it("renders the component without inventing publisher provenance", () => {
    const landing: DrinkBrandAreaLanding = {
      areaSlug: "clapham" as const,
      areaName: "Clapham",
      brandSlug: "guinness",
      brandLabel: "Guinness",
      collectedAt: "2026-07-03T12:00:00.000Z",
      totalPricedVenues: 10,
      rows: [
        {
          rank: 1,
          venueId: "venue-1",
          venueName: "Test pub",
          borough: "Lambeth",
          pintName: "Guinness Draught",
          priceGbp: 4.5,
          publisher: null,
        },
        {
          rank: 2,
          venueId: "venue-2",
          venueName: "Second pub",
          borough: "Lambeth",
          pintName: "Guinness Draught",
          priceGbp: 4.8,
          publisher: null,
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(DrinkBrandAreaLandingContent, {
        landing,
        mapSelectableVenueIds: new Set(["venue-1"]),
      }),
    );

    // Once in the hero, and once beside each row's own figure: every price
    // states what its own record supports (docs/VOICE.md), rank 1 included.
    expect(html.match(/Publisher not recorded/g)).toHaveLength(3);
    expect(html.match(/drinkBrandDirectory__fromPublisher/g)).toHaveLength(1);
    expect(html.match(/drinkBrandDirectory__publisher\b/g)).toHaveLength(2);
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain('href="http');
  });

  it("drops a sel the map cannot resolve from the arrival and the row action", () => {
    const landing: DrinkBrandAreaLanding = {
      areaSlug: "clapham" as const,
      areaName: "Clapham",
      brandSlug: "guinness",
      brandLabel: "Guinness",
      collectedAt: "2026-07-03T12:00:00.000Z",
      totalPricedVenues: 10,
      rows: [
        {
          rank: 1,
          venueId: "venue-outer",
          venueName: "Outer pub",
          borough: "Lambeth",
          pintName: "GUINNESS",
          priceGbp: 4.5,
          publisher: null,
        },
        {
          rank: 2,
          venueId: "venue-core",
          venueName: "Core pub",
          borough: "Lambeth",
          pintName: "Guinness Draught",
          priceGbp: 4.6,
          publisher: null,
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(DrinkBrandAreaLandingContent, {
        landing,
        mapSelectableVenueIds: new Set(["venue-core"]),
      }),
    );

    // The heading names the cheapest pint here, so the arrival is that pub or
    // no pub: it never silently becomes a different one, and with no pub the
    // words stop promising one.
    expect(html).toContain('href="/map?brand=guinness"');
    expect(html).toContain("Find Guinness on the map");
    expect(html).not.toContain("Find Guinness in Clapham on the map");
    expect(html).not.toContain("Open the cheapest Clapham pint on the map");
    expect(html).toContain('href="/map?brand=guinness&amp;log=1"');
    expect(html).toContain(
      'href="/map?sel=venue-core&amp;brand=guinness&amp;log=1"',
    );
    expect(html).toContain("Log a Guinness pint price");
    expect(html).toContain("Log this price");
    expect(html).toContain(">Guinness</span>");
    expect(html).not.toContain(">GUINNESS</span>");
    expect(html).not.toContain("sel=venue-outer");

    const withResolvableFirstRow = renderToStaticMarkup(
      createElement(DrinkBrandAreaLandingContent, {
        landing,
        mapSelectableVenueIds: new Set(["venue-outer", "venue-core"]),
      }),
    );

    expect(withResolvableFirstRow).toContain(
      'href="/map?sel=venue-outer&amp;brand=guinness"',
    );
    expect(withResolvableFirstRow).toContain(
      "Open the cheapest Clapham pint on the map",
    );
    expect(withResolvableFirstRow).not.toContain(
      "Find Guinness on the map",
    );

    const withFailedRead = renderToStaticMarkup(
      createElement(DrinkBrandAreaLandingContent, {
        landing,
        mapSelectableVenueIds: null,
      }),
    );

    expect(withFailedRead).not.toContain("sel=");
    expect(withFailedRead).toContain("Find Guinness on the map");
    expect(withFailedRead).toContain("Log a Guinness pint price");
    expect(withFailedRead).not.toContain("Log this price");
  });

  it("shows the full eligible pub count when the printed rows are capped", () => {
    const rows = Array.from({ length: 20 }, (_, index) => ({
      rank: index + 1,
      venueId: `venue-${index + 1}`,
      venueName: `Test pub ${index + 1}`,
      borough: "Lambeth",
      pintName: "Guinness Draught",
      priceGbp: 4.5 + index / 100,
      publisher: null,
    }));
    const landing: DrinkBrandAreaLanding = {
      areaSlug: "clapham" as const,
      areaName: "Clapham",
      brandSlug: "guinness",
      brandLabel: "Guinness",
      collectedAt: "2026-07-03T12:00:00.000Z",
      totalPricedVenues: 21,
      rows: rows as [typeof rows[number], ...typeof rows],
    };

    const html = renderToStaticMarkup(
      createElement(DrinkBrandAreaLandingContent, {
        landing,
        mapSelectableVenueIds: new Set(rows.map((row) => row.venueId)),
      }),
    );

    expect(html).toContain("Showing 20 of 21 pubs");
    expect(html).not.toContain(">21 pubs</span>");
  });

  it("returns 404 and noindex metadata for unknown and below-floor pairs", async () => {
    await expect(
      DrinkBrandAreaLandingPage({
        params: Promise.resolve({ slug: "not-an-area", brand: "guinness" }),
      }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
    await expect(
      DrinkBrandAreaLandingPage({
        params: Promise.resolve({ slug: "clapham", brand: "peroni" }),
      }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);

    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: "not-an-area", brand: "guinness" }),
      }),
    ).resolves.toMatchObject({
      robots: { index: false, follow: false },
    });
    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: "clapham", brand: "peroni" }),
      }),
    ).resolves.toMatchObject({
      robots: { index: false, follow: false },
    });
  });

  it("binds canonical and Open Graph metadata to the exact area-brand route", async () => {
    const landing = (await loadDrinkBrandAreaLanding("clapham", "guinness"))!;
    const firstRow = landing.rows[0]!;
    const description = `${landing.totalPricedVenues} ${landing.areaName} pubs with listed ${landing.brandLabel} pints from £${firstRow.priceGbp.toFixed(2)}. ${formatPricedLandingPublisherStatus(firstRow.publisher)}.`;

    await expect(
      generateMetadata({
        params: Promise.resolve({ slug: landing.areaSlug, brand: landing.brandSlug }),
      }),
    ).resolves.toMatchObject({
      title: `Cheapest ${landing.brandLabel} pints in ${landing.areaName}`,
      description,
      alternates: { canonical: `/area/${landing.areaSlug}/drink/${landing.brandSlug}` },
      openGraph: {
        type: "website",
        url: `/area/${landing.areaSlug}/drink/${landing.brandSlug}`,
        description,
      },
    });
  });

  it("draws its own Open Graph card and 404s an unpublished pair", async () => {
    await expect(
      DrinkBrandAreaLandingImage({
        params: Promise.resolve({ slug: "clapham", brand: "peroni" }),
      }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);

    const landing = (await loadDrinkBrandAreaLanding("clapham", "guinness"))!;
    const response = await DrinkBrandAreaLandingImage({
      params: Promise.resolve({ slug: "clapham", brand: "guinness" }),
    });
    const html = renderToStaticMarkup(
      (response as unknown as { element: ReactElement }).element,
    );

    expect(html).toContain("Cheapest listed Guinness pints in Clapham");
    expect(html).toContain(
      formatPricedLandingPublisherStatus(landing.rows[0]!.publisher),
    );
    expect(html).toContain("pubmaxxing.com/area/clapham/drink/guinness");
  });

  it("publishes one BreadcrumbList and one rendered ItemList in JSON-LD", async () => {
    const landing = (await loadDrinkBrandAreaLanding("clapham", "guinness"))!;
    const graph = drinkBrandAreaLandingJsonLd(landing);

    expect(graph.map((entry) => entry["@type"])).toEqual([
      "BreadcrumbList",
      "ItemList",
    ]);
    // The parent crumb is the brand's own London page. /area/<slug> is HELD, so
    // a crumb pointing there would advertise a 404.
    expect(graph[0]?.itemListElement.map((item) => item.name)).toEqual([
      "Map",
      landing.brandLabel,
      `${landing.brandLabel} in ${landing.areaName}`,
    ]);
    expect(graph[0]?.itemListElement.map((item) => item.item)).toEqual([
      "https://example.test/map",
      "https://example.test/drink/guinness",
      "https://example.test/area/clapham/drink/guinness",
    ]);
    expect(graph[1]?.numberOfItems).toBe(landing.rows.length);
    expect(graph[1]?.itemListElement).toHaveLength(landing.rows.length);
    expect(graph[1]?.itemListElement.map((item) => item.url)).toEqual(
      landing.rows.map((row) => `https://example.test/ledger/${encodeURIComponent(row.venueId)}`),
    );
  });
});
