import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/serverEnv", () => ({ assertProductionSecrets: () => {} }));

import { contextFrom } from "@/lib/concierge/context";
import { POST } from "@/app/api/concierge/route";

beforeEach(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

function post(body: unknown, ip: string): Promise<Response> {
  return POST(new Request("http://localhost/api/concierge", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

describe("POST /api/concierge", () => {
  it("derives day and late-night context in Europe/London, not the server timezone", () => {
    // 23:30 UTC Friday is 00:30 Saturday in London during BST.
    expect(contextFrom({}, new Date("2026-07-10T23:30:00.000Z"))).toMatchObject({
      dayType: "weekend",
      timeOfDay: "late",
    });
  });

  it("returns ranked server-owned venues and an optional narrated crawl", async () => {
    const response = await post({
      query: "Garden near Soho for 4, not pricey",
      narrated: true,
      limit: 3,
      context: { weather: "warm-dry", dayType: "weekday", timeOfDay: "evening" },
    }, "198.51.100.10");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.intentSource).toBe("deterministic");
    expect(body.intent).toMatchObject({ mood: ["garden"], groupSize: 4, area: "Soho", maxPintPrice: 6 });
    expect(body.venues).toHaveLength(3);
    expect(body.venues[0]).toMatchObject({ id: expect.any(String), name: expect.any(String), reasons: expect.any(Array) });
    expect(body.venues.every((venue: Record<string, unknown>) => venue.promoted !== true)).toBe(true);
    expect(body.narration).toContain("Start at ");
  });

  it("accepts tap-chip intent without requiring text", async () => {
    const response = await post({
      intent: { mood: ["sports"], groupSize: 6, area: "Southwark", maxPintPrice: 7 },
      limit: 2,
    }, "198.51.100.11");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.intentSource).toBe("provided");
    expect(body.venues).toHaveLength(2);
  });

  it("rejects malformed and unbounded input", async () => {
    expect((await post("{" , "198.51.100.12")).status).toBe(400);
    expect((await post({}, "198.51.100.13")).status).toBe(400);
    expect((await post({ intent: { mood: ["exclusive"], groupSize: 999 } }, "198.51.100.14")).status).toBe(400);
  });

  it("rate limits repeated requests before any paid parsing", async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 11; index += 1) {
      statuses.push((await post({ query: "Quiet in Bank" }, "203.0.113.240")).status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(200));
    expect(statuses[10]).toBe(429);
  });
});
