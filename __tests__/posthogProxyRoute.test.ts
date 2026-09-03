import { afterEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/ingest/[...path]/route";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/ingest owned PostHog proxy", () => {
  it("forwards capture body with only fixed safe headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": "posthog_session=forbidden",
        "x-upstream-debug": "forbidden",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const payload = JSON.stringify({
      event: "$exception",
      properties: { distinct_id: "018f47a2-0fd3-7a9c-8c90-a1b2c3d4e5f6" },
    });

    const response = await POST(
      new Request("https://pubmaxxing.com/ingest/e/?ip=1&ver=1.407.2", {
        method: "POST",
        headers: {
          authorization: "Bearer forbidden",
          cookie: "pubmax_admin_session=forbidden",
          "content-type": "application/json; charset=UTF-8",
          forwarded: "for=203.0.113.1",
          origin: "https://pubmaxxing.com",
          referer: "https://pubmaxxing.com/admin?token=forbidden",
          "x-forwarded-for": "203.0.113.1",
          "x-real-ip": "203.0.113.1",
        },
        body: payload,
      }),
      { params: Promise.resolve({ path: ["e"] }) },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://eu.i.posthog.com/e/?ip=1&ver=1.407.2");
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({
      accept: "*/*",
      "content-type": "application/json",
    });
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(payload);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("x-upstream-debug")).toBeNull();
  });

  it("routes SDK assets through the EU asset origin without browser headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("export {};", {
      status: 200,
      headers: {
        "cache-control": "public, max-age=3600",
        "content-type": "application/javascript",
      },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("https://pubmaxxing.com/ingest/static/array.js?v=1.407.2", {
        headers: {
          cookie: "pubmax_admin_session=forbidden",
          referer: "https://pubmaxxing.com/private",
        },
      }),
      { params: Promise.resolve({ path: ["static", "array.js"] }) },
    );

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("https://eu-assets.i.posthog.com/static/array.js?v=1.407.2");
    expect(Object.fromEntries(new Headers(init.headers))).toEqual({ accept: "*/*" });
    expect(response.headers.get("cache-control")).toBe("public, max-age=3600");
    await expect(response.text()).resolves.toBe("export {};");
  });
});
