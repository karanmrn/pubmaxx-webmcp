import type { SocialPostModerationAdapter } from "@/lib/socialPostStore";

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const DEFAULT_MODERATION_TIMEOUT_MS = 10_000;

/** Social post/interaction moderation crons read this before claiming jobs. */
export function isOpenAISocialModerationConfigured(apiKey = process.env.OPENAI_API_KEY): boolean {
  return Boolean((apiKey ?? "").trim());
}

export class SocialPostModerationError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

export class OpenAISocialPostModerationAdapter implements SocialPostModerationAdapter {
  private readonly apiKey: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(options: { apiKey?: string; fetcher?: Fetcher; timeoutMs?: number } = {}) {
    this.apiKey = (options.apiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
    if (!this.apiKey) {
      throw new SocialPostModerationError("OpenAI moderation is not configured.", false);
    }
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MODERATION_TIMEOUT_MS;
  }

  async moderate(input: { postId: string; text: string; imageUrl?: string }): Promise<{
    decision: "approved" | "needs_review";
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher("https://api.openai.com/v1/moderations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "omni-moderation-latest",
          input: input.imageUrl
            ? [
                { type: "text", text: input.text },
                { type: "image_url", image_url: { url: input.imageUrl } },
              ]
            : input.text,
        }),
        signal: controller.signal,
      });
    } catch {
      throw new SocialPostModerationError("OpenAI moderation request failed.", true);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      throw new SocialPostModerationError(
        `OpenAI moderation returned ${response.status}.`,
        retryable,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new SocialPostModerationError("OpenAI moderation returned invalid JSON.", false);
    }
    const result = payload && typeof payload === "object" &&
      Array.isArray((payload as { results?: unknown }).results)
      ? (payload as { results: unknown[] }).results[0]
      : null;
    if (!result || typeof result !== "object" || typeof (result as { flagged?: unknown }).flagged !== "boolean") {
      throw new SocialPostModerationError("OpenAI moderation returned no decision.", false);
    }
    return {
      decision: (result as { flagged: boolean }).flagged ? "needs_review" : "approved",
    };
  }
}
