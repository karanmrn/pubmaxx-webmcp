import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveVenuePermalinkSlug = vi.fn();

vi.mock("@/lib/venueIndex", () => ({
  resolveVenuePermalinkSlug: (...args: unknown[]) =>
    resolveVenuePermalinkSlug(...args),
  venueMapUrl: (id: string) => `/map?sel=${encodeURIComponent(id)}`,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    const error = new Error("NEXT_NOT_FOUND");
    (error as { digest?: string }).digest = "NEXT_NOT_FOUND";
    throw error;
  },
}));

describe("venue permalink redirect routes", () => {
  beforeEach(() => {
    resolveVenuePermalinkSlug.mockReset();
  });

  it("redirects a resolved /venue slug to the map selection deep link", async () => {
    resolveVenuePermalinkSlug.mockResolvedValue("venue-806vol");
    const { GET } = await import("@/app/venue/[slug]/route");
    const response = await GET(new Request("http://localhost/venue/the-ship-w1"), {
      params: Promise.resolve({ slug: "the-ship-w1" }),
    });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://localhost/map?sel=venue-806vol",
    );
  });

  it("redirects a resolved /pub slug the same way", async () => {
    resolveVenuePermalinkSlug.mockResolvedValue("venue-806vol");
    const { GET } = await import("@/app/pub/[slug]/route");
    const response = await GET(new Request("http://localhost/pub/the-ship-w1"), {
      params: Promise.resolve({ slug: "the-ship-w1" }),
    });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(
      "http://localhost/map?sel=venue-806vol",
    );
  });

  it("falls through to the branded 404 when the slug does not resolve", async () => {
    resolveVenuePermalinkSlug.mockResolvedValue(null);
    const { GET } = await import("@/app/venue/[slug]/route");
    await expect(
      GET(new Request("http://localhost/venue/no-such-pub"), {
        params: Promise.resolve({ slug: "no-such-pub" }),
      }),
    ).rejects.toMatchObject({ digest: "NEXT_NOT_FOUND" });
  });
});
