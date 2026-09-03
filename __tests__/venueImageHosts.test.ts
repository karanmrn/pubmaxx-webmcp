import { afterEach, describe, expect, it } from "vitest";

import {
  __resetVenueImageHosts,
  allowedVenueImageHosts,
} from "@/lib/venueImageHosts.server";

// Regression guard for the /pubs 8x-400 defect: the proxy's SSRF allowlist is
// built from the app's committed datasets, and every dataset the app actually
// issues image URLs FROM must be in that build set. pint_prices_app_dataset.json
// (venue.imageUrl — Google Places photos) was missing, so /api/image-proxy
// rejected its own app-rendered photo URLs with 400.

afterEach(() => __resetVenueImageHosts());

describe("allowedVenueImageHosts", () => {
  it("covers the venue-photo host the pint-prices dataset issues (lh3.googleusercontent.com)", () => {
    const hosts = allowedVenueImageHosts();
    expect(hosts.has("lh3.googleusercontent.com")).toBe(true);
  });

  it("still covers the scraped-menu enrichment hosts", () => {
    const hosts = allowedVenueImageHosts();
    // The set is non-trivially populated from the enrichment/seed files too —
    // adding a dataset must never replace the existing coverage.
    expect(hosts.size).toBeGreaterThan(10);
  });

  it("excludes third-party pub website/booking/pub_url hosts from pint_prices_app_dataset.json", () => {
    const hosts = allowedVenueImageHosts();
    // These are non-photo fields on the same dataset row (Delicio,
    // Bexleyheath) — the allowlist must only pick up the `image_url` field,
    // not every https URL in the file, or it becomes an SSRF allowlist for
    // ~hundreds of arbitrary pub websites.
    expect(hosts.has("www.deliciobexleyheath.co.uk")).toBe(false);
    expect(hosts.has("www.pint-prices.com")).toBe(false);
  });
});
