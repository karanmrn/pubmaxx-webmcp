import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/tfl-disruption/route";

describe("GET /api/tfl-disruption", () => {
  it("redirects raw coordinates to the shared bucket before caching", async () => {
    const response = await GET(
      new Request("http://localhost/api/tfl-disruption?lat=0.000123&lng=0.000456"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost/api/tfl-disruption?lat=0&lng=0",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps the shared cache header for an already bucketed request", async () => {
    const response = await GET(
      new Request("http://localhost/api/tfl-disruption?lat=0&lng=0"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("s-maxage=60");
  });
});
