// F3 concierge-as-map-home client logic (lib/conciergeAskClient.ts): latest-ask
// wins ordering, honest timeout, curated error copy (no raw JS error text ever
// reaches the UI), and both response-shape normalisations.
import { describe, expect, it } from "vitest";

import {
  ASK_FALLBACK_MESSAGE,
  answerFromBody,
  createAskSession,
} from "@/lib/conciergeAskClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const VENUE_BODY = {
  intent: { mood: ["cosy"], groupSize: 4 },
  intentSource: "deterministic",
  venues: [
    {
      id: "venue-1",
      name: "The Lamb",
      area: "Bloomsbury",
      lat: 51.5,
      lng: -0.12,
      cheapestPrice: 5.4,
      score: 0.9,
      reasons: ["Quiet back room"],
    },
  ],
};

describe("createAskSession", () => {
  it("returns the normalised answer on a happy-path response", async () => {
    const ask = createAskSession({
      fetchImpl: async () => jsonResponse(VENUE_BODY),
    });
    const result = await ask("quiet near bank", "london");
    expect(result).not.toBeNull();
    expect(result?.status).toBe("answered");
    if (result?.status === "answered") {
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].venueId).toBe("venue-1");
      expect(result.message).toBe("1 pick from our records, each with its source.");
    }
  });

  it("uses plain fallback copy when no legacy venues match", () => {
    const result = answerFromBody({ venues: [] });

    expect(result).toMatchObject({
      status: "answered",
      message: "Nothing listed matches that. Try a nearby area or a broader ask.",
    });
  });

  it("drops the stale response when a newer ask supersedes it (latest wins)", async () => {
    let resolveSlow: (r: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => {
      resolveSlow = resolve;
    });
    let call = 0;
    const ask = createAskSession({
      fetchImpl: () => {
        call += 1;
        return call === 1 ? slow : Promise.resolve(jsonResponse(VENUE_BODY));
      },
    });

    const first = ask("first", "london");
    const second = await ask("second", "london");
    expect(second?.status).toBe("answered");

    // The first (stale) request now resolves — it must yield null, never a
    // result that could overwrite the newer answer.
    resolveSlow(jsonResponse({ venues: [], message: "stale" }));
    expect(await first).toBeNull();
  });

  it("stale request that ERRORS after being superseded also yields null", async () => {
    let rejectSlow: (e: unknown) => void = () => {};
    const slow = new Promise<Response>((_, reject) => {
      rejectSlow = reject;
    });
    let call = 0;
    const ask = createAskSession({
      fetchImpl: () => {
        call += 1;
        return call === 1 ? slow : Promise.resolve(jsonResponse(VENUE_BODY));
      },
    });
    const first = ask("first", "london");
    await ask("second", "london");
    rejectSlow(new TypeError("fetch failed"));
    expect(await first).toBeNull();
  });

  it("times out a hung request and ends with curated error copy", async () => {
    const ask = createAskSession({
      timeoutMs: 20,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({ status: "error", message: ASK_FALLBACK_MESSAGE });
  });

  it("surfaces the route's explicit body.error on a non-ok response", async () => {
    const ask = createAskSession({
      fetchImpl: async () =>
        jsonResponse({ error: "Too many concierge requests, slow down." }, 429),
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({
      status: "error",
      message: "Too many concierge requests, slow down.",
    });
  });

  it("never leaks raw JS error text: network TypeError gets curated copy", async () => {
    const ask = createAskSession({
      fetchImpl: async () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      },
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({ status: "error", message: ASK_FALLBACK_MESSAGE });
  });

  it("never leaks raw JS error text: non-JSON body gets curated copy", async () => {
    const ask = createAskSession({
      fetchImpl: async () =>
        new Response("<html>502 Bad Gateway</html>", { status: 200 }),
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({ status: "error", message: ASK_FALLBACK_MESSAGE });
  });

  it("non-ok with a non-JSON body still gets curated copy (not SyntaxError)", async () => {
    const ask = createAskSession({
      fetchImpl: async () => new Response("upstream blew up", { status: 500 }),
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({ status: "error", message: ASK_FALLBACK_MESSAGE });
  });
  it("posts to /api/ask with prior turns for in-thread memory", async () => {
    const seen: { url: string; body: Record<string, unknown> } = {
      url: "",
      body: {},
    };
    const ask = createAskSession({
      fetchImpl: async (input, init) => {
        seen.url = String(input);
        seen.body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        return jsonResponse({
          answer: "One pick from our records.",
          cards: [
            {
              key: "venue-1",
              venueId: "venue-1",
              title: "The Lamb",
              place: "Bloomsbury",
              note: "Quiet",
              price: 5.4,
            },
          ],
          proposals: [],
          sources: [],
          status: "ready",
          toolsUsed: ["search_venues"],
        });
      },
    });
    await ask("quiet near bank", "london");
    await ask("cheaper", "london");
    expect(seen.url).toContain("/api/ask");
    expect(Array.isArray(seen.body.turns)).toBe(true);
    expect((seen.body.turns as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("answerFromBody", () => {
  it("normalises a venue-ranking answer into map-linkable cards", () => {
    const result = answerFromBody(VENUE_BODY);
    expect(result.status).toBe("answered");
    if (result.status === "answered") {
      expect(result.cards[0]).toEqual({
        key: "venue-1",
        venueId: "venue-1",
        title: "The Lamb",
        place: "Bloomsbury",
        note: "Quiet back room",
        price: 5.4,
      });
    }
  });

  it("normalises a What's-On answer, preserving the route's honest message", () => {
    const result = answerFromBody({
      mode: "whats-on",
      count: 1,
      message: "Found 1 verified quiz night, each with its source.",
      listings: [
        {
          id: "wo-1",
          kind: "quiz",
          title: "Pub quiz",
          venue: "Sporting Page, Chelsea",
          venueId: "venue-9",
          startsAt: "2026-07-12T18:30:00Z",
          priceGbp: 2,
          confidence: "confirmed",
          source: { label: "Question One", url: "https://example.com" },
        },
      ],
    });
    expect(result.status).toBe("answered");
    if (result.status === "answered") {
      expect(result.message).toContain("verified quiz night");
      expect(result.cards[0].venueId).toBe("venue-9");
      expect(result.cards[0].price).toBe(2);
    }
  });

  it("keeps the route's degraded-path message and yields no cards", () => {
    const result = answerFromBody({
      venues: [],
      message: "I couldn't load grounded venue options just now, so I won't make any up.",
    });
    expect(result.status).toBe("answered");
    if (result.status === "answered") {
      expect(result.cards).toHaveLength(0);
      expect(result.message).toContain("won't make any up");
    }
  });

  it("normalises the Night OS Ask agent body with proposals", () => {
    const result = answerFromBody({
      answer: "3 picks from our records, each with its source.",
      cards: [
        {
          key: "venue-1",
          venueId: "venue-1",
          title: "The Lamb",
          place: "Bloomsbury",
          note: "Quiet back room",
          price: 5.4,
        },
      ],
      proposals: [
        {
          id: "open:venue-1",
          kind: "open_venue",
          label: "Open The Lamb",
          venueId: "venue-1",
        },
      ],
      sources: [{ label: "On record", kind: "directory" }],
      status: "ready",
      toolsUsed: ["search_venues"],
    });
    expect(result.status).toBe("answered");
    if (result.status === "answered") {
      expect(result.message).toContain("picks from our records");
      expect(result.proposals).toHaveLength(1);
      expect(result.proposals[0]).toMatchObject({
        kind: "open_venue",
        venueId: "venue-1",
      });
      expect(result.responseStatus).toBe("ready");
    }
  });

  it("keeps a crowd occupancy proposal intact for confirm", () => {
    const result = answerFromBody({
      answer: "Log The Lamb as full?",
      cards: [],
      proposals: [
        {
          id: "occupancy:venue-1:full",
          kind: "report_occupancy",
          label: "Log The Lamb as full",
          venueId: "venue-1",
          level: "full",
        },
      ],
      sources: [],
      status: "ready",
      toolsUsed: ["report_occupancy"],
    });
    expect(result.status).toBe("answered");
    if (result.status === "answered") {
      expect(result.proposals).toEqual([
        {
          id: "occupancy:venue-1:full",
          kind: "report_occupancy",
          label: "Log The Lamb as full",
          venueId: "venue-1",
          level: "full",
        },
      ]);
    }
  });

  it("listings without a venueId produce non-tappable (empty venueId) cards", () => {
    const result = answerFromBody({
      mode: "whats-on",
      message: "m",
      listings: [{ id: "x", title: "T", venue: "V" }],
    });
    if (result.status === "answered") {
      expect(result.cards[0].venueId).toBe("");
    }
  });
});
