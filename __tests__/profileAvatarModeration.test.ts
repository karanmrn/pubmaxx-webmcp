import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createProfileAvatarModerationAdapter,
  extractModerationJsonObject,
  OpenAIProfileAvatarModerationAdapter,
  OpenRouterAvatarModerationAdapter,
} from "@/lib/profileAvatarModeration";

function openRouterResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("OpenAI profile avatar moderation adapter", () => {
  it("uses the direct Moderations API with image-only omni input", async () => {
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return new Response(JSON.stringify({ results: [{ flagged: false }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const adapter = new OpenAIProfileAvatarModerationAdapter({ apiKey: "test-key", fetcher });

    await expect(adapter.moderate("https://storage.test/signed-avatar"))
      .resolves.toEqual({ decision: "approved" });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/moderations",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(String(sentInit?.body));
    expect(body).toEqual({
      model: "omni-moderation-latest",
      input: [
        { type: "image_url", image_url: { url: "https://storage.test/signed-avatar" } },
      ],
    });
  });

  it("never sends a handle, profile id, or account identifier in the request body", async () => {
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return new Response(JSON.stringify({ results: [{ flagged: false }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const adapter = new OpenAIProfileAvatarModerationAdapter({ apiKey: "test-key", fetcher });

    await adapter.moderate("https://storage.test/avatars/signed");

    const raw = String(sentInit?.body);
    expect(raw).not.toContain("profile-");
    expect(raw).not.toContain("@alice");
    expect(raw).not.toContain("user-1");
    expect(raw).not.toContain("mem-profile");
    expect(JSON.parse(raw).input).toHaveLength(1);
    expect(JSON.parse(raw).input[0].type).toBe("image_url");
  });

  it("returns needs-review for flagged content and throws on outage or malformed results", async () => {
    const flagged = new OpenAIProfileAvatarModerationAdapter({
      apiKey: "test-key",
      fetcher: async () => new Response(JSON.stringify({ results: [{ flagged: true }] }), { status: 200 }),
    });
    await expect(flagged.moderate("https://storage.test/bad"))
      .resolves.toEqual({ decision: "needs_review" });

    const outage = new OpenAIProfileAvatarModerationAdapter({
      apiKey: "test-key",
      fetcher: async () => new Response("offline", { status: 503 }),
    });
    await expect(outage.moderate("https://storage.test/held")).rejects.toThrow();

    const malformed = new OpenAIProfileAvatarModerationAdapter({
      apiKey: "test-key",
      fetcher: async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    });
    await expect(malformed.moderate("https://storage.test/held")).rejects.toThrow();
  });

  it("fails closed when OPENAI_API_KEY is missing", () => {
    expect(() => new OpenAIProfileAvatarModerationAdapter({ apiKey: "" }))
      .toThrow(/not configured/i);
  });

  it("aborts a moderation request after its bounded timeout", async () => {
    const observedSignals: AbortSignal[] = [];
    const adapter = new OpenAIProfileAvatarModerationAdapter({
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
      adapter.moderate("https://storage.test/held")
        .then(() => "approved", (error: unknown) =>
          error && typeof error === "object" && "retryable" in error ? "retryable" : "failed"),
      new Promise<string>((resolve) => setTimeout(() => resolve("not_aborted"), 100)),
    ]);

    expect(outcome).toBe("retryable");
    expect(observedSignals.at(0)?.aborted).toBe(true);
  });
});

describe("OpenRouter profile avatar moderation adapter", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("posts a vision chat completion with image-only user content", async () => {
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return openRouterResponse('{"flagged": false}');
    });
    const adapter = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
      model: "openai/gpt-5.2",
      fetcher,
    });

    await expect(adapter.moderate("https://storage.test/signed-avatar"))
      .resolves.toEqual({ decision: "approved" });

    expect(fetcher).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(String(sentInit?.body));
    expect(body.model).toBe("openai/gpt-5.2");
    expect(body.messages).toHaveLength(1);
    const parts = body.messages[0].content;
    expect(parts).toHaveLength(2);
    expect(parts[0].type).toBe("text");
    expect(parts[1]).toEqual({
      type: "image_url",
      image_url: { url: "https://storage.test/signed-avatar" },
    });
  });

  it("never sends a handle, profile id, or account identifier in the request body", async () => {
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return openRouterResponse('{"flagged": false}');
    });
    const adapter = new OpenRouterAvatarModerationAdapter({ apiKey: "or-key", fetcher });

    await adapter.moderate("https://storage.test/avatars/signed");

    const raw = String(sentInit?.body);
    expect(raw).not.toContain("profile-");
    expect(raw).not.toContain("@alice");
    expect(raw).not.toContain("user-1");
    expect(raw).not.toContain("mem-profile");
    const body = JSON.parse(raw);
    const imageParts = body.messages[0].content.filter(
      (part: { type?: string }) => part.type === "image_url",
    );
    expect(imageParts).toHaveLength(1);
  });

  it("returns needs-review for flagged content", async () => {
    const adapter = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
      fetcher: async () => openRouterResponse('{"flagged": true}'),
    });
    await expect(adapter.moderate("https://storage.test/bad"))
      .resolves.toEqual({ decision: "needs_review" });
  });

  it("parses JSON from fenced model replies", async () => {
    const adapter = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
      fetcher: async () => openRouterResponse('```json\n{"flagged": false}\n```'),
    });
    await expect(adapter.moderate("https://storage.test/clean"))
      .resolves.toEqual({ decision: "approved" });
  });

  it("throws on refusal text, malformed JSON, outage, and missing boolean", async () => {
    const refusal = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
      fetcher: async () => openRouterResponse("I cannot classify that image."),
    });
    await expect(refusal.moderate("https://storage.test/held")).rejects.toThrow(/no decision/i);

    const malformed = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
      fetcher: async () => openRouterResponse('{"decision":"ok"}'),
    });
    await expect(malformed.moderate("https://storage.test/held")).rejects.toThrow(/no decision/i);

    const outage = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
      fetcher: async () => new Response("offline", { status: 503 }),
    });
    await expect(outage.moderate("https://storage.test/held")).rejects.toThrow();
  });

  it("fails closed when OPENROUTER_API_KEY is missing", () => {
    expect(() => new OpenRouterAvatarModerationAdapter({ apiKey: "" }))
      .toThrow(/not configured/i);
  });

  it("aborts a moderation request after its bounded timeout", async () => {
    const observedSignals: AbortSignal[] = [];
    const adapter = new OpenRouterAvatarModerationAdapter({
      apiKey: "or-key",
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
      adapter.moderate("https://storage.test/held")
        .then(() => "approved", (error: unknown) =>
          error && typeof error === "object" && "retryable" in error ? "retryable" : "failed"),
      new Promise<string>((resolve) => setTimeout(() => resolve("not_aborted"), 100)),
    ]);

    expect(outcome).toBe("retryable");
    expect(observedSignals.at(0)?.aborted).toBe(true);
  });

  it("reads OPENROUTER_MODERATION_MODEL from the environment", async () => {
    vi.stubEnv("OPENROUTER_MODERATION_MODEL", "google/gemini-2.5-flash");
    let sentInit: RequestInit | undefined;
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      sentInit = init;
      return openRouterResponse('{"flagged": false}');
    });
    const adapter = new OpenRouterAvatarModerationAdapter({ apiKey: "or-key", fetcher });
    await adapter.moderate("https://storage.test/signed");
    expect(JSON.parse(String(sentInit?.body)).model).toBe("google/gemini-2.5-flash");
  });
});

describe("extractModerationJsonObject", () => {
  it("accepts bare JSON and fenced blocks", () => {
    expect(extractModerationJsonObject('{"flagged":true}')).toEqual({ flagged: true });
    expect(extractModerationJsonObject('Here:\n```json\n{"flagged": false}\n```'))
      .toEqual({ flagged: false });
  });
});

describe("profile avatar moderation provider selection", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers OpenAI when both keys are present", () => {
    vi.stubEnv("OPENAI_API_KEY", "openai-key");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    expect(createProfileAvatarModerationAdapter()).toBeInstanceOf(OpenAIProfileAvatarModerationAdapter);
  });

  it("uses OpenRouter when only OPENROUTER_API_KEY is set", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "or-key");
    expect(createProfileAvatarModerationAdapter()).toBeInstanceOf(OpenRouterAvatarModerationAdapter);
  });

  it("throws when neither moderation key is configured", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(() => createProfileAvatarModerationAdapter()).toThrow(/not configured/i);
  });
});
