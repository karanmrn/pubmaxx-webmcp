import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/venue/[id]/route";
import type { SlimVenue } from "@/lib/venuesSlim";

const slimPayload = JSON.parse(
  readFileSync(path.resolve(__dirname, "../public/data/venues_slim.json"), "utf8"),
) as { rows?: SlimVenue[] };
const slim = slimPayload.rows ?? [];

describe("GET /api/venue/[id] busyness fields", () => {
  it("adds an explicitly estimated get-in read without changing the venue contract", async () => {
    const venue = slim[0];
    const response = await GET(
      new Request(`http://localhost/api/venue/${venue.id}?groupSize=6`),
      { params: Promise.resolve({ id: venue.id }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.venue.id).toBe(venue.id);
    expect(body.busyness).toMatchObject({
      source: expect.stringMatching(/^(typical-pattern|community-report)$/),
      isEstimate: true,
    });
    expect(body.getIn).toMatchObject({
      groupSize: 6,
      fit: expect.stringMatching(/^(likely|uncertain|unlikely|book-ahead)$/),
    });
    expect(body.booking).toMatchObject({
      available: expect.any(Boolean),
      partner: null,
    });
    expect(response.headers.get("cache-control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=600",
    );
  });
});
