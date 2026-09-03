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

import DrinkBrandLandingPage, {
  dynamicParams,
  generateMetadata,
  generateStaticParams,
} from "@/app/drink/[slug]/page";
import DrinkBrandLandingImage from "@/app/drink/[slug]/opengraph-image";
import DrinkBrandLandingContent from "@/components/drinks/DrinkBrandLandingContent";
import {
  drinkBrandLandingJsonLd,
  loadDrinkBrandLanding,
  loadDrinkBrandLandings,
} from "@/lib/drinkBrandLanding.server";
import { loadDrinkBrandAreaLandings } from "@/lib/drinkBrandAreaLanding.server";
import { DRINK_BRANDS } from "@/lib/drinkBrands";
import { loadMapSelectableVenueIds } from "@/lib/mapEagerVenueIndex.server";
import type { DrinkBrandLanding } from "@/lib/drinkBrandLanding";
import * as drinkBrandLandingPageModule from "@/app/drink/[slug]/page";

describe("governed drink brand landing page", () => {
  it("prebuilds exactly the published beer brand slugs, in catalogue order", async () => {
    const params = await generateStaticParams();
    const published = (await loadDrinkBrandLandings()).map(({ slug }) => slug);

    // Every prebuilt slug is one the loader publishes, and nothing else: a
    // brand below the floor is a legitimate non-publication rather than a
    // missing page.
    expect(params).toEqual(published.map((slug) => ({ slug })));
    expect(published.length).toBeGreaterThan(0);
    expect(published).toEqual(
      DRINK_BRANDS.beer
        .map((brand) => brand.id)
        .filter((id) => published.includes(id)),
    );
  });

  it("gates on published slugs and declares no revalidate window it cannot keep", () => {
    expect(dynamicParams).toBe(false);
    // The page reads the per-request nonce, so the document is dynamic and a
    // `revalidate` export would bound nothing.
    expect("revalidate" in drinkBrandLandingPageModule).toBe(false);
  });

  it("renders the immediate answer, both destinations, date, and twenty ranked rows", async () => {
    const page = await DrinkBrandLandingPage({
      params: Promise.resolve({ slug: "guinness" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Cheapest Guinness pints in London");
    expect(html).toContain("From £3.09");
    // ?brand= alone: decodeDrinkLens already fills the category from the brand,
    // and PubMap excludes beer from the selected lens, so ?drink=beer would
    // not select a lens. The log destination names the venue the composer opens
    // for.
    expect(html).toContain('href="/map?brand=guinness"');
    const logHref = html.match(
      /href="\/map\?sel=([^"&]+)&amp;brand=guinness&amp;log=1"/,
    );
    expect(logHref).not.toBeNull();
    // The composer can only arm for a pub the map RESOLVES, and the map only
    // resolves what its eager shard carries: the cheapest Guinness pint in
    // London sits in a lazy borough shard, so rank 1 is not that pub.
    const selectable = await loadMapSelectableVenueIds();
    expect(selectable?.has(decodeURIComponent(logHref![1]))).toBe(true);
    expect(html).not.toContain("drink=beer");
    expect(html.match(/Collected 3 July 2026\./g)).toHaveLength(1);
    expect(html.match(/<ol class="drinkBrandDirectory__list" role="list"/g)).toHaveLength(1);
    expect(
      html.match(/<li class="[^"]*\bdrinkBrandDirectory__row\b[^"]*"/g),
    ).toHaveLength(20);
    // The count discloses the cap rather than implying twenty is everything.
    const landing = await loadDrinkBrandLanding("guinness");
    expect(landing!.totalPricedVenues).toBeGreaterThan(landing!.rows.length);
    expect(html).toContain(
      `Showing ${landing!.rows.length} of ${landing!.totalPricedVenues} pubs`,
    );
    // Rank is presentational: the ordered list already carries position, and a
    // name on a bare span is prohibited so an aria-label there is dropped.
    expect(html).not.toContain('aria-label="Rank');
    expect(html).toMatch(/class="drinkBrandDirectory__rank" aria-hidden="true"/);
    expect(html).toContain("J.J. Moon's - JD Wetherspoon");
    expect(html).toContain("Pint Prices");
    expect(html).toContain("href=\"https://www.pint-prices.com/pub/");
    expect(html.match(/href="\/ledger\//g)).toHaveLength(20);

    const areaLandings = await loadDrinkBrandAreaLandings();
    const guinnessAreas = areaLandings.filter((pair) => pair.brandSlug === "guinness");
    expect(guinnessAreas.length).toBeGreaterThan(0);
    for (const pair of guinnessAreas) {
      expect(html).toContain(
        `href="/area/${pair.areaSlug}/drink/guinness"`,
      );
      expect(html).toContain(`>${pair.areaName.replaceAll("&", "&amp;")}</a>`);
    }
    expect(html).not.toMatch(/href="\/area\/[^"/]+"/);
  });

  it("keeps missing publisher provenance explicit without inventing a source link", () => {
    const model: DrinkBrandLanding = {
      slug: "guinness",
      brandLabel: "Guinness",
      collectedAt: "2026-07-03T12:00:00.000Z",
      totalPricedVenues: 20,
      rows: [
        {
          rank: 1,
          venueId: "venue-1",
          venueName: "Test pub",
          borough: "Camden",
          pintName: "Guinness",
          priceGbp: 3.09,
          publisher: null,
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(DrinkBrandLandingContent, {
        landing: model,
        mapSelectableVenueIds: new Set(["venue-1"]),
      }),
    );

    // Once in the hero, once beside rank 1's own figure in the list.
    expect(html.match(/Publisher not recorded/g)).toHaveLength(2);
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain('href="http');
  });

  it("links the hero price to the exact publisher carried by its first row", () => {
    const model: DrinkBrandLanding = {
      slug: "guinness",
      brandLabel: "Guinness",
      collectedAt: "2026-07-03T12:00:00.000Z",
      totalPricedVenues: 20,
      rows: [
        {
          rank: 1,
          venueId: "venue-1",
          venueName: "Test pub",
          borough: "Camden",
          pintName: "Guinness",
          priceGbp: 3.09,
          publisher: {
            label: "Exact Publisher",
            url: "https://publisher.example/price-1",
          },
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(DrinkBrandLandingContent, {
        landing: model,
        mapSelectableVenueIds: new Set(["venue-1"]),
      }),
    );

    expect(html).toContain("From £3.09");
    expect(html).toMatch(
      /class="[^"]*\bdrinkBrandDirectory__fromPublisher\b[^"]*"/,
    );
    expect(html).toContain(
      '>Publisher: Exact Publisher</a>',
    );
    // The hero states it for the "From" figure, the row states it for its own.
    expect(html.match(/href="https:\/\/publisher\.example\/price-1"/g)).toHaveLength(2);
    expect(html.match(/drinkBrandDirectory__fromPublisher/g)).toHaveLength(1);
    expect(html.match(/drinkBrandDirectory__publisher\b/g)).toHaveLength(1);
  });

  it("states every rank's own publisher beside its own figure", () => {
    const model: DrinkBrandLanding = {
      slug: "guinness",
      brandLabel: "Guinness",
      collectedAt: "2026-07-03T12:00:00.000Z",
      totalPricedVenues: 20,
      rows: [
        {
          rank: 1,
          venueId: "venue-1",
          venueName: "First pub",
          borough: "Camden",
          pintName: "Guinness",
          priceGbp: 3.09,
          publisher: {
            label: "Hero Publisher",
            url: "https://publisher.example/price-1",
          },
        },
        {
          rank: 2,
          venueId: "venue-2",
          venueName: "Second pub",
          borough: "Camden",
          pintName: "Guinness",
          priceGbp: 3.5,
          publisher: {
            label: "Second Publisher",
            url: "https://publisher.example/price-2",
          },
        },
        {
          rank: 3,
          venueId: "venue-3",
          venueName: "Third pub",
          borough: "Hackney",
          pintName: "Guinness",
          priceGbp: 3.8,
          publisher: null,
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(DrinkBrandLandingContent, {
        landing: model,
        mapSelectableVenueIds: new Set(["venue-1"]),
      }),
    );

    // The hero states rank 1's publisher for the "From" figure, and rank 1's
    // own row states it again beside the figure a scrolled reader is looking
    // at: the list is where the cheapest price is read (docs/VOICE.md).
    expect(html.match(/href="https:\/\/publisher\.example\/price-1"/g)).toHaveLength(2);
    expect(html.match(/drinkBrandDirectory__fromPublisher/g)).toHaveLength(1);
    // Every rank states its own record: a named publisher, and the plain
    // refusal when the record names none.
    expect(html.match(/drinkBrandDirectory__publisher\b/g)).toHaveLength(3);
    expect(html).toContain('>Second Publisher</a>');
    expect(html.match(/href="https:\/\/publisher\.example\/price-2"/g)).toHaveLength(1);
    expect(html.match(/Publisher not recorded/g)).toHaveLength(1);
  });

  it("arms the composer for a pub the map can open, and names none when it cannot", () => {
    const model: DrinkBrandLanding = {
      slug: "guinness",
      brandLabel: "Guinness",
      collectedAt: "2026-07-03T12:00:00.000Z",
      totalPricedVenues: 20,
      rows: [
        {
          rank: 1,
          venueId: "venue-outer",
          venueName: "Outer pub",
          borough: "Brent",
          pintName: "Guinness",
          priceGbp: 3.09,
          publisher: null,
        },
        {
          rank: 2,
          venueId: "venue-core",
          venueName: "Core pub",
          borough: "Camden",
          pintName: "Guinness",
          priceGbp: 3.5,
          publisher: null,
        },
      ],
    };

    const withCore = renderToStaticMarkup(
      createElement(DrinkBrandLandingContent, {
        landing: model,
        mapSelectableVenueIds: new Set(["venue-core"]),
      }),
    );
    expect(withCore).toContain(
      'href="/map?sel=venue-core&amp;brand=guinness&amp;log=1"',
    );
    // The ranked list itself never moves for the CTA's sake.
    expect(withCore.indexOf("Outer pub")).toBeLessThan(withCore.indexOf("Core pub"));

    const withNothingSelectable = renderToStaticMarkup(
      createElement(DrinkBrandLandingContent, {
        landing: model,
        mapSelectableVenueIds: new Set<string>(),
      }),
    );
    expect(withNothingSelectable).toContain('href="/map?brand=guinness&amp;log=1"');
    expect(withNothingSelectable).not.toContain("sel=");

    const withFailedRead = renderToStaticMarkup(
      createElement(DrinkBrandLandingContent, {
        landing: model,
        mapSelectableVenueIds: null,
      }),
    );
    expect(withFailedRead).not.toContain("sel=");
  });

  it("prints publishing sibling areas only as brand-by-area links", () => {
    const model: DrinkBrandLanding = {
      slug: "guinness",
      brandLabel: "Guinness",
      collectedAt: "2026-07-03T12:00:00.000Z",
      totalPricedVenues: 20,
      rows: [
        {
          rank: 1,
          venueId: "venue-1",
          venueName: "Test pub",
          borough: "Camden",
          pintName: "GUINNESS",
          priceGbp: 3.09,
          publisher: null,
        },
      ],
    };

    const html = renderToStaticMarkup(
      createElement(DrinkBrandLandingContent, {
        landing: model,
        mapSelectableVenueIds: new Set(["venue-1"]),
        areaPages: [
          { href: "/area/clapham/drink/guinness", label: "Clapham" },
          { href: "/area/victoria/drink/guinness", label: "Victoria" },
        ],
      }),
    );

    expect(html).toContain("By area");
    expect(html).toContain('href="/area/clapham/drink/guinness"');
    expect(html).toContain('href="/area/victoria/drink/guinness"');
    expect(html).toContain(">Guinness</span>");
    expect(html).not.toContain(">GUINNESS</span>");
    expect(html).not.toContain('href="/area/clapham"');
  });

  it("binds metadata to the canonical route and leaves unknown brands noindex", async () => {
    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "guinness" }) }),
    ).resolves.toMatchObject({
      title: "Cheapest Guinness pints in London",
      description:
        "347 London pubs with listed Guinness pints from £3.09. Publisher: Pint Prices.",
      alternates: { canonical: "/drink/guinness" },
      openGraph: {
        type: "website",
        url: "/drink/guinness",
        description:
          "347 London pubs with listed Guinness pints from £3.09. Publisher: Pint Prices.",
      },
      twitter: {
        description:
          "347 London pubs with listed Guinness pints from £3.09. Publisher: Pint Prices.",
      },
    });

    await expect(
      generateMetadata({ params: Promise.resolve({ slug: "not-a-brand" }) }),
    ).resolves.toMatchObject({
      robots: { index: false, follow: false },
    });
  });

  it("returns 404 for an unknown brand instead of rendering an empty page", async () => {
    await expect(
      DrinkBrandLandingPage({
        params: Promise.resolve({ slug: "not-a-brand" }),
      }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("publishes only BreadcrumbList and the rendered ItemList in JSON-LD", async () => {
    const landing = await loadDrinkBrandLanding("guinness");
    expect(landing).not.toBeNull();
    const graph = drinkBrandLandingJsonLd(landing!);

    expect(graph.map((entry) => entry["@type"])).toEqual([
      "BreadcrumbList",
      "ItemList",
    ]);
    expect(graph[0]?.itemListElement?.[0]?.item).toBe(
      "https://example.test/map",
    );
    expect(graph[1]?.itemListElement).toHaveLength(20);
    expect(graph[1]?.itemListElement?.[0]?.url).toContain(
      "https://example.test/ledger/",
    );
  });

  it("returns 404 for an unknown brand Open Graph request", async () => {
    await expect(
      DrinkBrandLandingImage({
        params: Promise.resolve({ slug: "not-a-brand" }),
      }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("names the exact first-row publisher beside the Open Graph price", async () => {
    const response = await DrinkBrandLandingImage({
      params: Promise.resolve({ slug: "guinness" }),
    });
    const html = renderToStaticMarkup(
      (response as unknown as { element: ReactElement }).element,
    );

    expect(html).toContain("£3.09");
    expect(html).toContain("Publisher: Pint Prices");
    expect(html).not.toContain("PUBMAXX pint evidence");
  });
});
