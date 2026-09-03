import { beforeEach, describe, expect, it, vi } from "vitest";

const { isLimitedMock } = vi.hoisted(() => ({
  isLimitedMock: vi.fn(async () => false),
}));

const { modelLoopMock } = vi.hoisted(() => ({
  modelLoopMock: vi.fn(),
}));

vi.mock("@/lib/serverEnv", () => ({ assertProductionSecrets: () => {} }));

vi.mock("@/lib/ask/modelLoop", () => ({
  runAskModelLoop: modelLoopMock,
}));

vi.mock("@/lib/pintDrops", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pintDrops")>(
    "@/lib/pintDrops",
  );
  return { ...actual, isLimited: isLimitedMock };
});

vi.mock("@/lib/citymcp/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/citymcp/client")>(
    "@/lib/citymcp/client",
  );
  return {
    ...actual,
    fetchCityStatus: vi.fn(async () => {
      throw new actual.CityMcpError("down", "network");
    }),
    fetchJourney: vi.fn(async () => ({ journeys: [] })),
    fetchThingsToDo: vi.fn(async () => ({
      window: "tonight" as const,
      opportunities: [],
    })),
  };
});

vi.mock("@/lib/citymcp/area", () => ({
  fetchCityArea: vi.fn(async () => {
    throw new Error("down");
  }),
}));

import { POST } from "@/app/api/ask/route";
import { runAsk } from "@/lib/ask/runAsk";
import { PAL_WEB_GROUNDING } from "@/lib/palChat";

beforeEach(() => {
  isLimitedMock.mockReset().mockResolvedValue(false);
  modelLoopMock.mockReset().mockResolvedValue(null);
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
});

function post(body: unknown, ip: string): Promise<Response> {
  return POST(
    new Request("http://localhost/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

describe("POST /api/ask", () => {
  it("returns the public error envelope when rate limiting fails", async () => {
    isLimitedMock.mockRejectedValueOnce(new Error("limiter unavailable"));

    const response = await post({ query: "Quiet near Bank" }, "198.51.100.19");

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: "Couldn't answer that right now.",
      code: "ASK_UNAVAILABLE",
      retryable: true,
    });
  });

  it("refuses an empty ask", async () => {
    const response = await post({ query: "   " }, "198.51.100.20");
    expect(response.status).toBe(400);
  });

  it("answers a mood ask with grounded venue cards keyless", async () => {
    const response = await post(
      { query: "Garden near Soho for 4, not pricey", cityId: "london" },
      "198.51.100.21",
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.status).toBe("ready");
    expect(body.toolsUsed).toContain("search_venues");
    expect(Array.isArray(body.cards)).toBe(true);
    expect(body.cards.length).toBeGreaterThan(0);
    expect(body.cards[0].venueId).toEqual(expect.any(String));
    expect(body.answer).toEqual(expect.any(String));
    expect(body.answer).not.toMatch(/—/);
  });

  it("returns a draft_plan proposal that names its own control without saving a plan", async () => {
    const response = await post(
      { query: "Plan a crawl in Soho for 4", cityId: "london" },
      "198.51.100.22",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.toolsUsed).toContain("propose_plan");
    const draft = body.proposals.find(
      (p: { kind: string }) => p.kind === "draft_plan",
    );
    expect(draft).toMatchObject({
      kind: "draft_plan",
      query: expect.any(String),
      stopIds: expect.any(Array),
    });
    expect(draft.stopIds.length).toBe(3);
    // Proposal only - the route never mutates durable plan state, and the
    // sentence names the control that exists. Both surfaces open Plan through
    // an "Open in Plan" control, so a bubble saying "Confirm" would name
    // nothing on screen.
    expect(draft.label).toBe("Open in Plan");
    expect(body.answer).toContain("Open in Plan");
    expect(body.answer.toLowerCase()).not.toContain("confirm");
  });

  it("degrades honestly when CityMCP is down", async () => {
    const response = await post(
      { query: "Any tube delays right now?", cityId: "london" },
      "198.51.100.23",
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.toolsUsed).toContain("city_status");
    expect(body.status).toBe("degraded");
    expect(body.answer).toMatch(/unavailable|could not|couldn't/i);
  });

  it("does not let a prior desk ask steal a cheapest-pint follow-up", async () => {
    const result = await runAsk({
      query: "Cheapest pint in Camden",
      cityId: "london",
      skipModel: true,
      turns: [
        { role: "user", content: "Somewhere to work with wifi in Angel" },
        { role: "assistant", content: "No seat data yet." },
      ],
    });
    expect(result.toolsUsed).not.toContain("find_desk");
    expect(result.toolsUsed).toContain("cheapest_pint_near");
  });

  it("accepts in-thread turns for refinement without durable memory writes", async () => {
    const first = await runAsk({
      query: "Quiet near Bank for 4",
      cityId: "london",
      skipModel: true,
    });
    expect(first.cards.length).toBeGreaterThan(0);
    const refined = await runAsk({
      query: "cheaper",
      cityId: "london",
      skipModel: true,
      turns: [
        { role: "user", content: "Quiet near Bank for 4" },
        { role: "assistant", content: first.answer },
      ],
    });
    expect(refined.toolsUsed.length).toBeGreaterThan(0);
    expect(refined.answer).toEqual(expect.any(String));
  });

  it("ignores model answer prose and composes from tool results", async () => {
    const card = {
      key: "venue-1",
      venueId: "venue-1",
      title: "The Lamb",
      place: "Bloomsbury",
      note: "Quiet",
      price: 5.4,
      provenance: { label: "On record", kind: "directory" },
    };
    modelLoopMock.mockResolvedValueOnce({
      toolResults: [{
        ok: true,
        tool: "search_venues",
        data: null,
        provenance: [],
        cards: [card],
        proposals: [],
        answerHint: "The Lamb is listed.",
      }],
      answer: "2 grounded picks from CityMCP",
    });
    process.env.OPENROUTER_API_KEY = "test-key";

    const result = await runAsk({ query: "Somewhere quiet in Bloomsbury", cityId: "london" });

    expect(result.answer).toBe("1 pick from the listed pubs, each with its source. The Lamb is listed.");
    expect(result.answer).not.toMatch(/CityMCP|grounded/iu);
  });
});

describe("Night OS Ask fences", () => {
  it("keeps web grounding off", () => {
    expect(PAL_WEB_GROUNDING).toBe(false);
  });
});
