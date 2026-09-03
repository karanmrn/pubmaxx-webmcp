import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/version/route";

describe("deployment version route", () => {
  it("prevents the marker from being cached", async () => {
    const response = GET();
    const body = await response.json();

    expect(body).toHaveProperty("deploymentId");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("cdn-cache-control")).toBe("no-store");
    expect(response.headers.get("vercel-cdn-cache-control")).toBe("no-store");
  });
});
