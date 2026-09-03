type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const DEFAULT_MODERATION_TIMEOUT_MS = 10_000;
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_MODERATION_MODEL = "openai/gpt-5.2";

const OPENROUTER_MODERATION_PROMPT = [
  "You are a strict image safety classifier for profile avatar uploads.",
  "Flag sexual content, minors in any sexualized or unsafe context, graphic violence,",
  "self-harm, and hate symbols.",
  'Respond ONLY with JSON: {"flagged": true} or {"flagged": false}. No other text.',
].join(" ");

export class ProfileAvatarModerationError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
  }
}

export type ProfileAvatarModerationAdapter = {
  moderate(imageUrl: string): Promise<{ decision: "approved" | "needs_review" }>;
};

function moderationRetryable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/** Tolerant JSON object extraction for model replies (fenced blocks or inline braces). */
export function extractModerationJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error("empty");
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    /* try other shapes */
  }
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      /* continue */
    }
  }
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1));
  }
  throw new Error("no json object");
}

function flaggedDecision(value: unknown): boolean | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const flagged = (value as { flagged?: unknown }).flagged;
  return typeof flagged === "boolean" ? flagged : null;
}

/**
 * Image-only OpenAI omni-moderation for owned profile avatars.
 * Reuses the Social post adapter call shape (same model + endpoint) but never
 * sends text or any account identifier in the request body.
 */
export class OpenAIProfileAvatarModerationAdapter implements ProfileAvatarModerationAdapter {
  private readonly apiKey: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(options: { apiKey?: string; fetcher?: Fetcher; timeoutMs?: number } = {}) {
    this.apiKey = (options.apiKey ?? process.env.OPENAI_API_KEY ?? "").trim();
    if (!this.apiKey) {
      throw new ProfileAvatarModerationError("OpenAI moderation is not configured.", false);
    }
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MODERATION_TIMEOUT_MS;
  }

  async moderate(imageUrl: string): Promise<{ decision: "approved" | "needs_review" }> {
    if (typeof imageUrl !== "string" || !imageUrl.trim()) {
      throw new ProfileAvatarModerationError("OpenAI moderation returned no decision.", false);
    }
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
          input: [{ type: "image_url", image_url: { url: imageUrl } }],
        }),
        signal: controller.signal,
      });
    } catch {
      throw new ProfileAvatarModerationError("OpenAI moderation request failed.", true);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new ProfileAvatarModerationError(
        `OpenAI moderation returned ${response.status}.`,
        moderationRetryable(response.status),
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProfileAvatarModerationError("OpenAI moderation returned invalid JSON.", false);
    }
    const result = payload && typeof payload === "object" &&
      Array.isArray((payload as { results?: unknown }).results)
      ? (payload as { results: unknown[] }).results[0]
      : null;
    if (!result || typeof result !== "object" || typeof (result as { flagged?: unknown }).flagged !== "boolean") {
      throw new ProfileAvatarModerationError("OpenAI moderation returned no decision.", false);
    }
    return {
      decision: (result as { flagged: boolean }).flagged ? "needs_review" : "approved",
    };
  }
}

/**
 * Image-only OpenRouter vision moderation for owned profile avatars when OpenAI
 * is unavailable. Sends only the short-lived signed image URL, never identifiers.
 */
export class OpenRouterAvatarModerationAdapter implements ProfileAvatarModerationAdapter {
  private readonly apiKey: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;
  private readonly model: string;

  constructor(options: {
    apiKey?: string;
    fetcher?: Fetcher;
    timeoutMs?: number;
    model?: string;
  } = {}) {
    this.apiKey = (options.apiKey ?? process.env.OPENROUTER_API_KEY ?? "").trim();
    if (!this.apiKey) {
      throw new ProfileAvatarModerationError("OpenRouter moderation is not configured.", false);
    }
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_MODERATION_TIMEOUT_MS;
    this.model = (
      options.model ??
      process.env.OPENROUTER_MODERATION_MODEL ??
      DEFAULT_OPENROUTER_MODERATION_MODEL
    ).trim();
  }

  async moderate(imageUrl: string): Promise<{ decision: "approved" | "needs_review" }> {
    if (typeof imageUrl !== "string" || !imageUrl.trim()) {
      throw new ProfileAvatarModerationError("OpenRouter moderation returned no decision.", false);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          max_tokens: 32,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: OPENROUTER_MODERATION_PROMPT },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
    } catch {
      throw new ProfileAvatarModerationError("OpenRouter moderation request failed.", true);
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new ProfileAvatarModerationError(
        `OpenRouter moderation returned ${response.status}.`,
        moderationRetryable(response.status),
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProfileAvatarModerationError("OpenRouter moderation returned invalid JSON.", false);
    }
    const content = payload && typeof payload === "object"
      ? (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
        ?.message?.content
      : null;
    if (typeof content !== "string" || !content.trim()) {
      throw new ProfileAvatarModerationError("OpenRouter moderation returned no decision.", false);
    }
    let parsed: unknown;
    try {
      parsed = extractModerationJsonObject(content);
    } catch {
      throw new ProfileAvatarModerationError("OpenRouter moderation returned no decision.", false);
    }
    const flagged = flaggedDecision(parsed);
    if (flagged === null) {
      throw new ProfileAvatarModerationError("OpenRouter moderation returned no decision.", false);
    }
    return { decision: flagged ? "needs_review" : "approved" };
  }
}

/** Prefer OpenAI omni-moderation when configured; otherwise OpenRouter vision. */
export function createProfileAvatarModerationAdapter(): ProfileAvatarModerationAdapter {
  if ((process.env.OPENAI_API_KEY ?? "").trim()) {
    return new OpenAIProfileAvatarModerationAdapter();
  }
  if ((process.env.OPENROUTER_API_KEY ?? "").trim()) {
    return new OpenRouterAvatarModerationAdapter();
  }
  throw new ProfileAvatarModerationError("Profile avatar moderation is not configured.", false);
}
