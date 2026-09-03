import { publicApiError } from "@/lib/apiError";
import { runAsk } from "@/lib/ask/runAsk";
import { assertPubPalLlmAuth } from "@/lib/pubPalLlmAuth";
import {
  isPubPalGetHomeOrSobrietyIntent,
  isPubPalSobrietyOnlyIntent,
  pubPalGetHomeRegisterAnswer,
} from "@/lib/pubPalLlmFence";
import {
  extractAskTurns,
  extractLastUserMessage,
  streamOpenAiChatCompletion,
  type OpenAiChatCompletionRequest,
} from "@/lib/pubPalLlmStream";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp, isSupabaseConfigured } from "@/lib/supabase";

const RATE_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `pub-pal-llm:${hashIp(clientIp(request))}`;
  if (
    await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS, {
      failClosed: true,
    })
  ) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const authDenied = assertPubPalLlmAuth(request);
  if (authDenied) return authDenied;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return publicApiError("Malformed JSON.", "MALFORMED_REQUEST", 400);
  }

  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as OpenAiChatCompletionRequest)
      : {};

  const query = extractLastUserMessage(record.messages);
  if (!query) {
    return publicApiError("Ask a question.", "QUERY_REQUIRED", 400);
  }

  const fenced = isPubPalGetHomeOrSobrietyIntent(query);
  const sobrietyOnly = isPubPalSobrietyOnlyIntent(query);

  const llmAssistAllowed =
    !fenced &&
    (isSupabaseConfigured() || process.env.NODE_ENV !== "production") &&
    Boolean(process.env.OPENROUTER_API_KEY?.trim());

  const answerBody = await runAsk({
    query,
    cityId: record.cityId,
    turns: extractAskTurns(record.messages),
    skipModel: !llmAssistAllowed,
  });

  const answer = fenced
    ? pubPalGetHomeRegisterAnswer(answerBody.answer, sobrietyOnly)
    : answerBody.answer;

  return streamOpenAiChatCompletion(answer, record.model ?? "pubmax-ask-grounded");
}
