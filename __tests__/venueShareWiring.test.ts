import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { mergeCommunityPriceSignals } from "@/components/map/communityPriceSignals";
import type { CommunityPrice } from "@/lib/communityPrice";

const read = (file: string): string => readFileSync(join(process.cwd(), file), "utf8");

function venueInspectorCallSite(pubMap: string): string {
  const start = pubMap.indexOf("<VenueInspector");
  expect(start, "VenueInspector mount in PubMap").toBeGreaterThan(-1);
  const end = pubMap.indexOf("/>", start);
  expect(end, "VenueInspector closing tag").toBeGreaterThan(start);
  return pubMap.slice(start, end);
}

describe("venue share wiring — map-authority only", () => {
  const pubMap = read("components/PubMap.tsx");
  const inspector = read("components/map/VenueInspector.tsx");
  const callSite = venueInspectorCallSite(pubMap);

  it("PubMap hands share copy the merged venueSignals seam, not unmerged drops", () => {
    expect(callSite).toMatch(
      /shareLoggedPintGbp=\{venueSignals\.get\(selectedVenue\.id\)\?\.latestContributorPrice\}/,
    );
    expect(callSite).toMatch(
      /shareLoggedAt=\{venueSignals\.get\(selectedVenue\.id\)\?\.latestContributorAt/,
    );
    expect(callSite).not.toMatch(/shareLoggedPintGbp=\{dropSignals/);
    expect(callSite).not.toMatch(/shareLoggedAt=\{dropSignals/);
    expect(callSite).not.toMatch(/shareLoggedPintGbp=\{communityPrices/);
    expect(callSite).not.toMatch(/shareLoggedAt=\{communityPrices/);
  });

  it("PubMap keeps the sheet overview on the unmerged drop signal", () => {
    // The share seam and the overview row are deliberately different sources.
    expect(callSite).toMatch(
      /latestContributorPrice=\{dropSignals\.get\(selectedVenue\.id\)\?\.latestContributorPrice\}/,
    );
    expect(callSite).toMatch(
      /latestPintDropAt=\{dropSignals\.get\(selectedVenue\.id\)\?\.latestContributorAt\}/,
    );
  });

  it("VenueInspector passes the share props into useVenueShare, not latestContributorPrice", () => {
    expect(inspector).toMatch(
      /useVenueShare\(venue,\s*\{\s*priceGbp:\s*shareLoggedPintGbp,\s*atMs:\s*shareLoggedAt,\s*\}\)/,
    );
    expect(inspector).not.toMatch(/useVenueShare\([^)]*latestContributorPrice/);
  });

  it("uncorroborated sheet prices never reach venueSignals, so share cannot quote them", () => {
    const now = Date.UTC(2026, 6, 26, 20, 0, 0);
    const venueId = "v-uncorroborated";
    const uncorroborated: CommunityPrice = {
      venueId,
      drinkCategory: "beer",
      priceGbp: 3.5,
      submittedAt: now - 60_000,
      source: "community",
      corroborations: 1,
    };
    const dropSignals = new Map([
      [venueId, { hasPintDrops: false, latestContributorPrice: null }],
    ]);
    const merged = mergeCommunityPriceSignals(
      dropSignals,
      new Map([[venueId, uncorroborated]]),
      now,
    );

    expect(merged.get(venueId)?.latestContributorPrice ?? null).toBeNull();
    // Sheet still holds the raw row; only the merged map may feed share copy.
    expect(uncorroborated.priceGbp).toBe(3.5);
  });
});
