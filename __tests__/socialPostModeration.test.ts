import { describe, expect, it, vi } from "vitest";

import {
  isOpenAISocialModerationConfigured,
  OpenAISocialPostModerationAdapter,
} from "@/lib/socialPostModeration";

describe("OpenAI Social post moderation adapter", () => {
  it("reports whether the cron moderation key is present", () => {
    expect(isOpenAISocialModerationConfigured("")).toBe(false);
    expect(isOpenAISocialModerationConfigured("  ")).toBe(false);
    expect(isOpenAISocialModerationConfigured("test-key")).toBe(true);
  });

  it("uses the direct Moderations API and exact required model", async () => {
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return new Response(JSON.stringify({ results: [{ flagged: false }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const adapter = new OpenAISocialPostModerationAdapter({ apiKey: "test-key", fetcher });

    await expect(adapter.moderate({ postId: "post-1", text: "Evening" }))
      .resolves.toEqual({ decision: "approved" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/moderations",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ model: "omni-moderation-latest", input: "Evening" }),
      }),
    );
  });

  it("sends canonical text and the normalised private image in one multimodal decision", async () => {
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return new Response(JSON.stringify({ results: [{ flagged: false }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const adapter = new OpenAISocialPostModerationAdapter({ apiKey: "test-key", fetcher });

    await adapter.moderate({
      postId: "post-1",
      text: "Evening\n\n#camden\n\nPhoto: Friends outside a pub",
      imageUrl: "https://storage.test/signed-image",
    });

    const body = JSON.parse(String(sentInit?.body));
    expect(body).toEqual({
      model: "omni-moderation-latest",
      input: [
        { type: "text", text: "Evening\n\n#camden\n\nPhoto: Friends outside a pub" },
        { type: "image_url", image_url: { url: "https://storage.test/signed-image" } },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("profile-");
    expect(JSON.stringify(body)).not.toContain("@alice");
  });

  it("returns needs-review for flagged content and throws on outage or malformed results", async () => {
    const flagged = new OpenAISocialPostModerationAdapter({
      apiKey: "test-key",
      fetcher: async () => new Response(JSON.stringify({ results: [{ flagged: true }] }), { status: 200 }),
    });
    await expect(flagged.moderate({ postId: "post-1", text: "Bad" }))
      .resolves.toEqual({ decision: "needs_review" });

    const outage = new OpenAISocialPostModerationAdapter({
      apiKey: "test-key",
      fetcher: async () => new Response("offline", { status: 503 }),
    });
    await expect(outage.moderate({ postId: "post-1", text: "Held" })).rejects.toThrow();

    const malformed = new OpenAISocialPostModerationAdapter({
      apiKey: "test-key",
      fetcher: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    });
    await expect(malformed.moderate({ postId: "post-1", text: "Held" })).rejects.toThrow();
  });

  it("aborts a moderation request after its bounded timeout", async () => {
    const observedSignals: AbortSignal[] = [];
    const adapter = new OpenAISocialPostModerationAdapter({
      apiKey: "test-key",
      timeoutMs: 5,
      fetcher: (_url, init) => new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal as AbortSignal;
        observedSignals.push(signal);
        signal.addEventListener(
          "abort",
          () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          { once: true },
        );
      }),
    });

    const outcome = await Promise.race([
      adapter.moderate({ postId: "post-1", text: "Held" })
        .then(() => "approved", (error: unknown) =>
          error && typeof error === "object" && "retryable" in error ? "retryable" : "failed"),
      new Promise<string>((resolve) => setTimeout(() => resolve("not_aborted"), 100)),
    ]);

    expect(outcome).toBe("retryable");
    expect(observedSignals.at(0)?.aborted).toBe(true);
  });
});
