import { afterEach, describe, expect, it, vi } from "vitest";

import { withRouteTiming } from "@/lib/routeObservability";

// The logger emits ONE JSON line per event: info/warn → console.log, error →
// console.error. These helpers collect the parsed records from each sink.
function parsedFrom(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls
    .map((c: unknown[]) => {
      try {
        return JSON.parse(String(c[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((r): r is Record<string, unknown> => r != null);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("withRouteTiming", () => {
  it("passes the Response through untouched and emits an info http.request line", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const body = new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json", "x-custom": "keep" },
    });
    const handler = vi.fn(async () => body);
    const wrapped = withRouteTiming("citymcp/status", handler);

    const res = await wrapped(new Request("http://localhost/api/citymcp/status?q=secret"));
    expect(res).toBe(body); // same Response instance, headers preserved
    expect(res.headers.get("x-custom")).toBe("keep");

    const rec = parsedFrom(logSpy).find((r) => r.event === "http.request");
    expect(rec).toMatchObject({
      level: "info",
      event: "http.request",
      route: "citymcp/status",
      method: "GET",
      status: 200,
    });
    expect(typeof rec?.durationMs).toBe("number");
    // The static route tag is logged — never the URL / query string.
    expect(JSON.stringify(rec)).not.toContain("secret");
  });

  it("logs level warn for a 4xx and error for a 5xx", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const warnWrapped = withRouteTiming(
      "citymcp/place",
      async () => new Response("bad", { status: 400 }),
    );
    await warnWrapped(new Request("http://localhost/"));
    expect(parsedFrom(logSpy).find((r) => r.event === "http.request")).toMatchObject({
      level: "warn",
      status: 400,
    });

    const errorWrapped = withRouteTiming(
      "citymcp/place",
      async () => new Response("down", { status: 503 }),
    );
    await errorWrapped(new Request("http://localhost/"));
    expect(parsedFrom(errSpy).find((r) => r.event === "http.request")).toMatchObject({
      level: "error",
      status: 503,
    });
  });

  it("logs an error line and re-raises when the handler throws", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const wrapped = withRouteTiming("citymcp/journey", async () => {
      throw new Error("kaboom");
    });

    await expect(wrapped(new Request("http://localhost/"))).rejects.toThrow("kaboom");
    const rec = parsedFrom(errSpy).find((r) => r.event === "http.request");
    expect(rec).toMatchObject({ level: "error", route: "citymcp/journey", status: 500 });
    expect(rec?.error).toBe("kaboom");
  });
});
