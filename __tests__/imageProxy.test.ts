import { afterEach, describe, expect, it, vi } from "vitest";

// The route rate-limits per IP before anything else; the limiter's durable
// path would hit the network under the Vercel prod-env vitest run, so it is
// neutralised here (same pattern as planRoutes.test.ts) — the limiter has its
// own suite.
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: async () => false };
});

// The proxy only fetches hosts present in the app's own datasets (SSRF gate);
// tests pin behaviour with a controlled allowlist instead of the real files.
vi.mock("@/lib/venueImageHosts.server", () => ({
  allowedVenueImageHosts: () =>
    new Set([
      "www.thelamblondon.com",
      "www.oldshiphammersmith.co.uk",
      "www.jdwetherspoon.com",
      "example.com",
      "cdn.example.com",
    ]),
}));

import { GET } from "@/app/api/image-proxy/route";
import { proxiedVenueImageUrl } from "@/lib/venueImages";

function req(src: string): Request {
  return new Request(`http://localhost/api/image-proxy?src=${encodeURIComponent(src)}`);
}

afterEach(() => vi.restoreAllMocks());

describe("proxiedVenueImageUrl", () => {
  it("routes a valid https photo through the same-origin proxy", () => {
    expect(proxiedVenueImageUrl("https://www.thelamblondon.com/p.jpg")).toBe(
      "/api/image-proxy?src=https%3A%2F%2Fwww.thelamblondon.com%2Fp.jpg",
    );
  });

  it("returns empty for blocked or invalid inputs, like the direct helper", () => {
    expect(proxiedVenueImageUrl("")).toBe("");
    expect(proxiedVenueImageUrl("https://images.app.goo.gl/x")).toBe("");
    expect(proxiedVenueImageUrl("not a url")).toBe("");
  });
});

describe("GET /api/image-proxy", () => {
  it("rejects non-https, IP-literal, and localhost sources without fetching", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    for (const bad of [
      "http://example.com/p.jpg",
      "https://127.0.0.1/p.jpg",
      "https://10.0.0.5/p.jpg",
      "https://localhost/p.jpg",
      "https://internal.local/p.jpg",
      "ftp://example.com/p.jpg",
      // Public host NOT present in the app's datasets — the SSRF gate rejects
      // it before any DNS/network activity (covers rebinding-style attacks).
      "https://attacker-controlled.example.net/p.jpg",
      "",
    ]) {
      const res = await GET(req(bad));
      expect(res.status, bad).toBe(400);
    }
    expect(spy).not.toHaveBeenCalled();
  });

  it("streams an image response with long cache headers", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    const res = await GET(req("https://www.oldshiphammersmith.co.uk/p.jpg"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
  });

  it("returns a cacheable miss for allowed non-image content", async () => {
    const cancel = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const res = await GET(req("https://example.com/p.jpg"));

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("returns a cacheable miss when an allowed upstream image is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));
    const res = await GET(req("https://example.com/missing.jpg"));

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
  });

  it.each([429, 500, 502, 503])("keeps transient upstream status %s as an uncached failure", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status }));
    const res = await GET(req("https://example.com/temporary.jpg"));

    expect(res.status).toBe(502);
    expect(res.headers.get("cache-control")).toBeNull();
  });

  it("returns a cacheable miss when an allowed legacy image redirects to site HTML", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://www.jdwetherspoon.com/" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      );

    const res = await GET(
      req("https://www.jdwetherspoon.com/~/media/images/pubs/2450/legacy.jpg"),
    );

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
    expect(await res.text()).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns a cacheable miss when an allowed image response has no body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    const res = await GET(req("https://example.com/empty.jpg"));

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
  });

  it("returns a cacheable miss for an empty readable raster body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array(), {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );
    const res = await GET(req("https://example.com/empty-stream.jpg"));

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toContain("max-age=86400");
  });

  it("refuses SVG — executable content must never be served same-origin", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<svg onload=alert(1)></svg>", {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      }),
    );
    expect((await GET(req("https://example.com/logo.svg"))).status).toBe(502);
  });

  it("follows at most one validated redirect hop", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "https://cdn.example.com/p.jpg" } }),
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([9]), { status: 200, headers: { "content-type": "image/png" } }),
      );
    const res = await GET(req("https://example.com/p.jpg"));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a redirect to a forbidden host", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 302, headers: { location: "https://127.0.0.1/p.jpg" } }),
    );
    expect((await GET(req("https://example.com/p.jpg"))).status).toBe(502);
  });

  it("cancels a redirect body before rejecting a malformed location", async () => {
    const cancel = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        status: 302,
        headers: { location: "https://[" },
      }),
    );

    expect((await GET(req("https://example.com/p.jpg"))).status).toBe(502);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
