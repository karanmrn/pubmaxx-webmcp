import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { runAsk } from "@/lib/ask/runAsk";
import { isLimited } from "@/lib/pintDrops";
import { assertProductionSecrets } from "@/lib/serverEnv";
import { clientIp, hashIp, isSupabaseConfigured } from "@/lib/supabase";

if (process.env.NODE_ENV === "production") assertProductionSecrets();

const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;
const MAX_QUERY_LENGTH = 500;

/**
 * Night OS Ask (ADR 0014) — unified grounded agent over the tool registry.
 * Keyless deterministic path always works; OpenRouter tool-calling is optional
 * and withheld in production without a durable limiter (same fence as concierge).
 */
export async function POST(request: Request): Promise<Response> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return publicApiError("Malformed JSON.", "MALFORMED_REQUEST", 400);
    }

    const record =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};

    const query =
      typeof record.query === "string"
        ? record.query.trim().slice(0, MAX_QUERY_LENGTH)
        : "";
    if (!query) {
      return publicApiError("Ask a question.", "QUERY_REQUIRED", 400);
    }

    const limiterKey = `ask:${hashIp(clientIp(request))}`;
    if (
      await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS, {
        failClosed: true,
      })
    ) {
      return publicApiError("Too many asks, slow down.", "RATE_LIMITED", 429, { retryable: true });
    }

    // Paid-spend guard: without Supabase the durable limiter is only per-instance.
    // Withhold OpenRouter in that production posture; deterministic tools still answer.
    const llmAssistAllowed =
      isSupabaseConfigured() || process.env.NODE_ENV !== "production";

    const answer = await runAsk({
      query,
      cityId: record.cityId,
      turns: record.turns,
      skipModel: !llmAssistAllowed,
    });
    return jsonNoStore(answer);
  } catch (error) {
    console.error("ask.unexpected_error", error);
    return publicApiError("Couldn't answer that right now.", "ASK_UNAVAILABLE", 503, { retryable: true });
  }
}
