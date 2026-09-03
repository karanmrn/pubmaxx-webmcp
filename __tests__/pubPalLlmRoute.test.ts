import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const llmState = vi.hoisted(() => ({
  askAnswer: {
    answer: "The Landor pours at £5.90, logged this week.",
    cards: [
      {
        key: "venue-landor",
        venueId: "london-landor",
        title: "The Landor",
        place: "Clapham",
        note: "Logged this week.",
        price: 5.9,
      },
    ],
    proposals: [],
    sources: [],
    status: "ready" as const,
    toolsUsed: ["venue_prices"],
  },
}));

vi.mock("@/lib/ask/runAsk", () => ({
  runAsk: vi.fn(async () => llmState.askAnswer),
}));

vi.mock("@/lib/supabase", () => ({
  clientIp: () => "203.0.113.44",
  hashIp: (ip: string) => `hashed:${ip}`,
  isSupabaseConfigured: () => false,
  checkRateLimitDurableDetailed: async () => ({ verdict: false, reason: "counted" }),
}));

import { POST } from "@/app/api/pub-pal/llm/route";
import { runAsk } from "@/lib/ask/runAsk";
import {
  isPubPalGetHomeOrSobrietyIntent,
  pubPalGetHomeRegisterAnswer,
} from "@/lib/pubPalLlmFence";
import { assertPubPalLlmAuth } from "@/lib/pubPalLlmAuth";

function request(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/pub-pal/llm", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer test-llm-secret",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function readSseText(response: Response): Promise<string> {
  return response.text();
}

describe("POST /api/pub-pal/llm", () => {
  beforeEach(() => {
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "test-llm-secret");
    delete process.env.OPENROUTER_API_KEY;
    vi.mocked(runAsk).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 401 when the shared secret is wrong", async () => {
    const response = await POST(
      request(
        {
          model: "pubmax-ask-grounded",
          stream: true,
          messages: [{ role: "user", content: "How much is a pint at The Landor?" }],
        },
        { authorization: "Bearer wrong-secret" },
      ),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(runAsk).not.toHaveBeenCalled();
  });

  it("returns 503 when the shared secret is not configured", async () => {
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "");

    const response = await POST(
      request({
        model: "pubmax-ask-grounded",
        stream: true,
        messages: [{ role: "user", content: "How much is a pint at The Landor?" }],
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: "UNAVAILABLE",
      retryable: true,
    });
    expect(runAsk).not.toHaveBeenCalled();
  });

  it("streams a grounded answer as OpenAI-compatible SSE", async () => {
    const response = await POST(
      request({
        model: "pubmax-ask-grounded",
        stream: true,
        messages: [{ role: "user", content: "How much is a pint at The Landor?" }],
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const body = await readSseText(response);
    expect(body).toContain('"object":"chat.completion.chunk"');
    expect(body).toContain("The Landor pours at £5.90");
    expect(body).toContain("data: [DONE]");
    expect(runAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        query: "How much is a pint at The Landor?",
        skipModel: true,
      }),
    );
  });

  it("accepts the shared secret from the dedicated header", async () => {
    const response = await POST(
      request(
        {
          model: "pubmax-ask-grounded",
          stream: true,
          messages: [{ role: "user", content: "How much is a pint at The Landor?" }],
        },
        {
          authorization: "",
          "x-elevenlabs-llm-secret": "test-llm-secret",
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(runAsk).toHaveBeenCalled();
  });
});

describe("Pub Pal Custom LLM register fence", () => {
  beforeEach(() => {
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "test-llm-secret");
    delete process.env.OPENROUTER_API_KEY;
    vi.mocked(runAsk).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("detects get-home and sobriety intents", () => {
    expect(isPubPalGetHomeOrSobrietyIntent("Should I have one more?")).toBe(true);
    expect(isPubPalGetHomeOrSobrietyIntent("When is the last train home?")).toBe(true);
    expect(isPubPalGetHomeOrSobrietyIntent("Quiet garden near Soho")).toBe(false);
  });

  it("never freelances sobriety judgement in register answers", async () => {
    const response = await POST(
      request({
        model: "pubmax-ask-grounded",
        stream: true,
        messages: [{ role: "user", content: "Should I have one more drink?" }],
      }),
    );

    expect(response.status).toBe(200);
    const body = await readSseText(response);
    expect(body).toContain("cannot tell you whether to have another drink");
    expect(body).toContain("Getting Home");
    expect(body).not.toMatch(/you(?:'| a)re fine|one more is fine|stay for another/i);
    expect(runAsk).toHaveBeenCalledWith(
      expect.objectContaining({
        skipModel: true,
      }),
    );
  });

  it("wraps grounded facts with the plain register closer", () => {
    const answer = pubPalGetHomeRegisterAnswer(
      "Last train from Waterloo is 00:32.",
      false,
    );
    expect(answer).toContain("Last train from Waterloo is 00:32.");
    expect(answer).toContain("Getting Home");
  });
});

describe("assertPubPalLlmAuth", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows a matching bearer secret", () => {
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "s3cr3t");
    expect(
      assertPubPalLlmAuth(
        new Request("http://localhost/api/pub-pal/llm", {
          headers: { authorization: "Bearer s3cr3t" },
        }),
      ),
    ).toBeNull();
  });
});
