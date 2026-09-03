import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { isWhatsOnLimitedMock } = vi.hoisted(() => ({
  isWhatsOnLimitedMock: vi.fn(async () => false),
}));

vi.mock("@/lib/citymcpRateLimit", () => ({
  isWhatsOnLimited: isWhatsOnLimitedMock,
}));

import { GET } from "@/app/api/whats-on/route";

describe("GET /api/whats-on", () => {
  it("returns contract JSON when the rate-limit dependency cannot answer", async () => {
    isWhatsOnLimitedMock.mockRejectedValueOnce(new Error("rate limiter unavailable"));

    const response = await GET(new Request("http://localhost/api/whats-on?window=tonight"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      rows: [],
      error: "rate limiter unavailable",
    });
  });

  it("keeps a keyless Tonight read inside its JSON contract", async () => {
    const response = await GET(
      new Request("http://localhost/api/whats-on?window=tonight&limit=60"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = await response.json() as { rows?: unknown };
    expect(Array.isArray(body.rows)).toBe(true);
  });
});
