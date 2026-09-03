// Pub Pal chat ask session (lib/palChatClient): latest-ask-wins ordering, honest
// timeout, curated house-voice error copy (no raw JS error text ever reaches the
// UI), and provenance preserved through both response shapes. Hermetic: injected
// fetch, no network, deterministic timers.
import { describe, expect, it } from "vitest";

import { PAL_ERROR_FALLBACK } from "@/lib/palChat";
import { createPalChatSession } from "@/lib/palChatClient";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const VENUE_BODY = {
  venues: [
    {
      id: "venue-1",
      name: "The Lamb",
      area: "Bloomsbury",
      cheapestPrice: 5.4,
      reasons: ["A calmer fit"],
    },
  ],
};

const WHATS_ON_BODY = {
  mode: "whats-on",
  message: "Found 1 verified quiz night, each with its source.",
  listings: [
    {
      id: "wo-1",
      kind: "quiz",
      title: "Pub quiz",
      venue: "Sporting Page, Chelsea",
      venueId: "venue-9",
      startsAt: "2026-07-18T18:30:00Z",
      confidence: "confirmed",
      source: { label: "Question One", url: "https://example.com/quiz" },
    },
  ],
};

describe("createPalChatSession", () => {
  it("returns a grounded venue answer with On-record provenance", async () => {
    const ask = createPalChatSession({
      fetchImpl: async () => jsonResponse(VENUE_BODY),
    });
    const result = await ask("quiet near bank", "london");
    expect(result).not.toBeNull();
    expect(result?.status).toBe("answered");
    if (result && result.status === "answered") {
      expect(result.cards[0].venueId).toBe("venue-1");
      expect(result.cards[0].provenance).toEqual({
        label: "On record",
        kind: "directory",
      });
    }
  });

  it("returns a What's-On answer that keeps the attributable source link", async () => {
    const ask = createPalChatSession({
      fetchImpl: async () => jsonResponse(WHATS_ON_BODY),
    });
    const result = await ask("quiz tonight in chelsea", "london");
    expect(result?.status).toBe("answered");
    if (result && result.status === "answered") {
      expect(result.cards[0].provenance).toEqual({
        label: "Question One",
        url: "https://example.com/quiz",
        kind: "whats-on",
      });
    }
  });

  it("drops a stale response when a newer ask supersedes it (latest wins)", async () => {
    let resolveSlow: (r: Response) => void = () => {};
    const slow = new Promise<Response>((resolve) => {
      resolveSlow = resolve;
    });
    let call = 0;
    const ask = createPalChatSession({
      fetchImpl: () => {
        call += 1;
        return call === 1 ? slow : Promise.resolve(jsonResponse(VENUE_BODY));
      },
    });

    const first = ask("first", "london");
    const second = await ask("second", "london");
    expect(second?.status).toBe("answered");

    resolveSlow(jsonResponse({ venues: [], message: "stale" }));
    expect(await first).toBeNull();
  });

  it("yields null for a superseded request that ERRORS after being replaced", async () => {
    let rejectSlow: (e: unknown) => void = () => {};
    const slow = new Promise<Response>((_, reject) => {
      rejectSlow = reject;
    });
    let call = 0;
    const ask = createPalChatSession({
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

  it("times out a hung request and ends with curated house-voice copy", async () => {
    const ask = createPalChatSession({
      timeoutMs: 20,
      fetchImpl: (_input, init) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({ status: "error", message: PAL_ERROR_FALLBACK });
  });

  it("surfaces the route's explicit body.error on a non-ok response", async () => {
    const ask = createPalChatSession({
      fetchImpl: async () =>
        jsonResponse({ error: "Too many concierge requests, slow down." }, 429),
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({
      status: "error",
      message: "Too many concierge requests, slow down.",
    });
  });

  it("never leaks raw JS error text: a network TypeError gets curated copy", async () => {
    const ask = createPalChatSession({
      fetchImpl: async () => {
        throw new TypeError("NetworkError when attempting to fetch resource.");
      },
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({ status: "error", message: PAL_ERROR_FALLBACK });
  });

  it("never leaks raw JS error text: a non-JSON body gets curated copy", async () => {
    const ask = createPalChatSession({
      fetchImpl: async () =>
        new Response("<html>502 Bad Gateway</html>", { status: 200 }),
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({ status: "error", message: PAL_ERROR_FALLBACK });
  });

  it("curates copy for a non-ok, non-JSON body (no SyntaxError leak)", async () => {
    const ask = createPalChatSession({
      fetchImpl: async () => new Response("upstream blew up", { status: 500 }),
    });
    const result = await ask("anything", "london");
    expect(result).toEqual({ status: "error", message: PAL_ERROR_FALLBACK });
  });
});
