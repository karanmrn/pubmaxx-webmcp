import { describe, expect, it, vi } from "vitest";

import { GET as LIST } from "@/app/api/night-areas/route";
import { GET } from "@/app/api/night-areas/[slug]/route";

describe("GET /api/night-areas", () => {
  it("lists the reviewed London catalogue without authentication", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00.000Z"));
    try {
      const response = await LIST(new Request("http://localhost/api/night-areas?city=london"));
      expect(response.status).toBe(200);
      // Static per-city catalogue → CDN-cacheable (was no-store).
      expect(response.headers.get("cache-control")).toContain("s-maxage=3600");
      expect(response.headers.get("cache-control")).toContain("stale-while-revalidate");

      const body = await response.json();
      expect(body).toMatchObject({ cityId: "london" });
      expect(body.areas).toHaveLength(20);
      expect(body.areas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          slug: "clapham",
          coverageStatus: "route_ready",
          coverageScore: expect.any(Number),
          routeReadyReasons: expect.any(Array),
          missingEvidence: [],
          gate: expect.objectContaining({ version: 1, passed: true }),
          lastReviewedAt: expect.any(String),
          reviewExpiresAt: expect.any(String),
        }),
        expect.objectContaining({
          slug: "barnes",
          coverageStatus: "reviewed",
          missingEvidence: expect.arrayContaining(["opening_hours"]),
        }),
        expect.objectContaining({ slug: "camden", demandWave: 1 }),
      ]));
      expect(body.areas.find((area: { slug: string }) => area.slug === "clapham")).not.toHaveProperty("routeReady");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects cities without a reviewed Night Area catalogue", async () => {
    const response = await LIST(new Request("http://localhost/api/night-areas?city=manchester"));
    expect(response.status).toBe(404);
  });

  it("rejects an unknown city rather than silently falling back to London", async () => {
    const response = await LIST(new Request("http://localhost/api/night-areas?city=unknown-city"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose a valid city.",
      code: "CITY_INVALID",
      retryable: false,
    });
  });
});

describe("GET /api/night-areas/:slug", () => {
  it("returns a pilot Night Area with coverage and daypart guidance", async () => {
    const response = await GET(new Request("http://localhost/api/night-areas/clapham"), {
      params: Promise.resolve({ slug: "clapham" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      slug: "clapham",
      name: "Clapham",
      transportAnchors: expect.any(Array),
      daypartGuidance: { after_work: expect.any(String), late_night: expect.any(String) },
      recentSignals: [],
      coverageStatus: "route_ready",
      gate: expect.objectContaining({ version: 1, passed: true }),
      lastReviewedAt: expect.any(String),
      reviewExpiresAt: expect.any(String),
    });
    expect(body).not.toHaveProperty("routeReady");
  });

  it("returns reviewed expansion areas while keeping their route gate visible", async () => {
    const response = await GET(new Request("http://localhost/api/night-areas/camden"), {
      params: Promise.resolve({ slug: "camden" }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      slug: "camden",
      coverageStatus: "captured",
      gate: expect.objectContaining({ passed: false }),
    });
    expect(body).not.toHaveProperty("routeReady");
  });

  it("keeps cached Night Area bodies independent of the current clock", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-12-31T23:59:59.000Z"));
      const beforeExpiry = await GET(new Request("http://localhost/api/night-areas/clapham"), {
        params: Promise.resolve({ slug: "clapham" }),
      });
      const beforeBody = await beforeExpiry.json();

      vi.setSystemTime(new Date("2027-01-01T00:00:01.000Z"));
      const afterExpiry = await GET(new Request("http://localhost/api/night-areas/clapham"), {
        params: Promise.resolve({ slug: "clapham" }),
      });
      const afterBody = await afterExpiry.json();

      expect(afterBody).toEqual(beforeBody);
      expect(afterBody).not.toHaveProperty("routeReady");
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns a not-found response for an unknown Night Area slug", async () => {
    const response = await GET(new Request("http://localhost/api/night-areas/not-a-night-area"), {
      params: Promise.resolve({ slug: "not-a-night-area" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "We don't cover that area.",
      code: "NIGHT_AREA_NOT_FOUND",
      retryable: false,
    });
  });
});
