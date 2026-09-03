import { describe, expect, it } from "vitest";

import { NIGHT_AREAS, isNightAreaRouteReady } from "@/lib/nightAreas";
import { nightAreaPublishesPrices } from "@/lib/pricedLanding";

// The renewal ALARM for the Night Area review windows.
//
// `isNightAreaRouteReady` expires with `reviewExpiresAt`, and every route-ready
// area shares one date. Nothing warns before it lapses, so the first sign used
// to be planning quietly refusing every area. This test rings 30 days ahead and
// says exactly what to do, which is the whole point of an alarm: a failure
// nobody can act on is noise.
const RENEWAL_NOTICE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

describe("Night Area review renewal", () => {
  const publishing = NIGHT_AREAS.filter(nightAreaPublishesPrices);

  it("has route-ready areas to renew", () => {
    expect(publishing.length).toBeGreaterThan(0);
  });

  it("warns before any route-ready area's review window lapses", () => {
    const now = Date.now();
    const lapsing = publishing
      .filter((area) => {
        const expiresAt = area.reviewExpiresAt ? Date.parse(area.reviewExpiresAt) : Number.NaN;
        return (
          Number.isFinite(expiresAt) &&
          expiresAt - now < RENEWAL_NOTICE_DAYS * DAY_MS
        );
      })
      .map((area) => `${area.slug} (${area.reviewExpiresAt})`);

    expect(
      lapsing,
      `Re-review these Night Areas and move lastReviewedAt / reviewExpiresAt forward in lib/nightAreas.ts. Until that lands, planning refuses them: ${lapsing.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps an indexed price page alive after its route review lapses", () => {
    const lapsed = {
      ...publishing[0]!,
      lastReviewedAt: "2026-01-01T00:00:00.000Z",
      reviewExpiresAt: "2026-02-01T00:00:00.000Z",
    };

    // Two questions, two answers: planning a crawl needs a live review, an
    // indexed list of dated prices does not. Letting the second follow the
    // first would 404 URLs already in the sitemap.
    expect(isNightAreaRouteReady(lapsed, new Date("2026-08-15T12:00:00.000Z"))).toBe(false);
    expect(nightAreaPublishesPrices(lapsed)).toBe(true);
  });
});
