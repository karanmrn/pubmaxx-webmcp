import {
  CONCIERGE_MOODS,
  type ConciergeIntent,
  type ConciergeMood,
} from "@/lib/concierge/rank";

export type ParsedConciergeIntent = {
  intent: ConciergeIntent;
  source: "model" | "deterministic";
};

type ParseOptions = {
  apiKey?: string;
  model?: string;
  fetcher?: typeof fetch;
  /**
   * Withhold the paid model assist and answer deterministically. Callers set
   * this when paid spend can't be safely rate-limited (e.g. production with
   * no durable limiter) — the parse still works, it just never spends.
   */
  skipModel?: boolean;
};

const MOOD_TERMS: Record<ConciergeMood, RegExp> = {
  balanced: /\b(?:balanced|bit of everything|anything)\b/i,
  quiet: /\b(?:quiet|quiet-ish|calm|chat|low-key)\b/i,
  lively: /\b(?:lively|buzzing|party|atmosphere)\b/i,
  cosy: /\b(?:cosy|cozy|snug|fireside)\b/i,
  garden: /\b(?:garden|outside|outdoor|sunny)\b/i,
  riverside: /\b(?:riverside|river|waterside|by the water)\b/i,
  sports: /\b(?:sport|sports|football|rugby|match)\b/i,
  date: /\b(?:date|romantic)\b/i,
  food: /\b(?:food|dinner|eat|meal)\b/i,
  cocktails: /\b(?:cocktail|cocktails|mixed drinks)\b/i,
  heritage: /\b(?:heritage|historic|history|old pub)\b/i,
};

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};

function deterministicIntent(text: string): ConciergeIntent {
  const mood = CONCIERGE_MOODS.filter((candidate) => MOOD_TERMS[candidate].test(text));
  const numericGroup = text.match(/\b(\d{1,2})\s+(?:of us|people|mates|pax)\b/i)?.[1]
    ?? text.match(/\b(?:for|group of|we(?:'re| are))\s+(?!£)(\d{1,2})\b/i)?.[1];
  const wordGroup = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\s+(?:of us|people|mates|pax)\b/i)?.[1]
    ?? text.match(/\b(?:for|group of|we(?:'re| are))\s+(one|two|three|four|five|six|seven|eight|nine|ten|twelve)\b/i)?.[1];
  const parsedGroup = numericGroup ? Number(numericGroup) : wordGroup ? NUMBER_WORDS[wordGroup.toLowerCase()] : 2;
  const groupSize = Math.min(20, Math.max(1, parsedGroup));

  const areaMatch = text.match(/\b(?:near|around|in)\s+([\p{L}][\p{L}' .-]*?)(?=\s+(?:for|with|under|below|max|not)\b|\s*,|[.!?]|$)/iu);
  const area = areaMatch?.[1]?.trim().replace(/\s+/g, " ");

  const explicitBudget = text.match(/(?:under|below|max(?:imum)?|up to)\s*£?\s*(\d+(?:\.\d{1,2})?)/i)?.[1]
    ?? text.match(/£\s*(\d+(?:\.\d{1,2})?)\s*(?:or less|max)/i)?.[1];
  const maxPintPrice = explicitBudget
    ? Math.min(15, Math.max(3, Number(explicitBudget)))
    : /\b(?:not pricey|cheap|budget|inexpensive|affordable)\b/i.test(text)
      ? 6
      : undefined;

  return {
    mood,
    groupSize,
    ...(area ? { area } : {}),
    ...(maxPintPrice !== undefined ? { maxPintPrice } : {}),
  };
}

function validateModelIntent(value: unknown, originalText: string): ConciergeIntent | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const mood = record.mood;
  if (!Array.isArray(mood) || !mood.every((item) => typeof item === "string" && CONCIERGE_MOODS.includes(item as ConciergeMood))) return null;
  const groupSize = record.groupSize;
  if (typeof groupSize !== "number" || !Number.isInteger(groupSize) || groupSize < 1 || groupSize > 20) return null;
  const area = record.area;
  if (area !== undefined) {
    if (typeof area !== "string" || !area.trim() || area.length > 80) return null;
    // Areas are factual strings, not creative output: require a verbatim phrase
    // from the user's request so the model cannot relocate the crew.
    if (!originalText.toLocaleLowerCase("en-GB").includes(area.trim().toLocaleLowerCase("en-GB"))) return null;
  }
  const maxPintPrice = record.maxPintPrice;
  if (maxPintPrice !== undefined && (typeof maxPintPrice !== "number" || !Number.isFinite(maxPintPrice) || maxPintPrice < 3 || maxPintPrice > 15)) return null;

  return {
    mood: [...new Set(mood as ConciergeMood[])],
    groupSize,
    ...(typeof area === "string" ? { area: area.trim() } : {}),
    ...(typeof maxPintPrice === "number" ? { maxPintPrice } : {}),
  };
}

const SYSTEM_PROMPT = [
  "You parse one UK pub-night request into JSON only.",
  `Allowed mood values: ${CONCIERGE_MOODS.join(", ")}.`,
  "Schema: {mood: string[], groupSize: integer 1..20, area?: string, maxPintPrice?: number 3..15}.",
  "Copy area verbatim from the request. Do not add preferences or facts the user did not express.",
  "Use groupSize 2 when absent and mood [] when absent.",
].join(" ");

async function modelIntent(text: string, options: ParseOptions): Promise<ConciergeIntent | null> {
  if (options.skipModel) return null;
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await (options.fetcher ?? fetch)("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: options.model ?? process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4-5",
        temperature: 0,
        max_tokens: 180,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: text.slice(0, 500) },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") return null;
    return validateModelIntent(JSON.parse(content), text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Parse intent with a bounded LLM assist and a deterministic, keyless fallback. */
export async function parseConciergeIntent(
  text: string,
  options: ParseOptions = {},
): Promise<ParsedConciergeIntent> {
  const fallback = deterministicIntent(text.slice(0, 500));
  const parsed = await modelIntent(text.slice(0, 500), options);
  return parsed
    ? { intent: parsed, source: "model" }
    : { intent: fallback, source: "deterministic" };
}
