import { afterEach, describe, expect, it, vi } from "vitest";

import { parseConciergeIntent } from "@/lib/concierge/intent";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseConciergeIntent", () => {
  it("turns ordinary coordination language into a structured intent without a key", async () => {
    const parsed = await parseConciergeIntent(
      "Quiet-ish near Bank, 4 of us, not pricey",
      { apiKey: "" },
    );

    expect(parsed).toEqual({
      intent: { mood: ["quiet"], groupSize: 4, area: "Bank", maxPintPrice: 6 },
      source: "deterministic",
    });
  });

  it("accepts only bounded structured output from the model", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"mood":["garden"],"groupSize":6,"area":"Soho","maxPintPrice":7}' } }],
    }), { status: 200 })));

    const parsed = await parseConciergeIntent("Garden in Soho for 6 under £7", {
      apiKey: "test-key",
    });

    expect(parsed).toEqual({
      intent: { mood: ["garden"], groupSize: 6, area: "Soho", maxPintPrice: 7 },
      source: "model",
    });
  });

  it("falls back honestly when the upstream model fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503 })));

    const parsed = await parseConciergeIntent("Sports near Waterloo for 8", {
      apiKey: "test-key",
    });

    expect(parsed).toEqual({
      intent: { mood: ["sports"], groupSize: 8, area: "Waterloo" },
      source: "deterministic",
    });
  });

  it("does not mistake a pint-price budget for the crew size", async () => {
    const parsed = await parseConciergeIntent("Quiet near Bank under £7", { apiKey: "" });

    expect(parsed.intent).toEqual({
      mood: ["quiet"],
      groupSize: 2,
      area: "Bank",
      maxPintPrice: 7,
    });
  });

  it("rejects invented or out-of-bounds model fields", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: '{"mood":["exclusive"],"groupSize":999,"area":"Paris"}' } }],
    }), { status: 200 })));

    const parsed = await parseConciergeIntent("Cosy in Shoreditch for two", {
      apiKey: "test-key",
    });

    expect(parsed).toEqual({
      intent: { mood: ["cosy"], groupSize: 2, area: "Shoreditch" },
      source: "deterministic",
    });
  });
});
