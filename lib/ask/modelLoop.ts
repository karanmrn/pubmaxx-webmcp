// OpenRouter tool-calling loop for Night OS Ask. Allowlisted tools only;
// temperature 0; capped rounds. Falls back to null so the deterministic path
// can answer when the model is missing or fails.

import {
  askToolDefinitions,
  runAskTool,
  type AskToolContext,
  type AskToolResult,
} from "@/lib/ask/tools";
import { isAskToolName, type AskTurn } from "@/lib/ask/types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ROUNDS = 3;
const MAX_TOKENS = 500;
const TIMEOUT_MS = 12_000;

export type ModelAskOutcome = {
  toolResults: AskToolResult[];
};

type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

function systemPrompt(): string {
  return [
    "You are the Night OS Ask assistant for PUBMAXXING, a London pub night planner.",
    "Use ONLY the provided tools. Never invent pubs, prices, listings, or transit facts.",
    "If a tool returns nothing, say so plainly. Prefer short British English.",
    "For map moves or plans, call propose_map_action or propose_plan - the user must confirm.",
    "Do not claim a community price moves the map unless the tool says it is corroborated.",
  ].join(" ");
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    /* ignore */
  }
  return {};
}

/**
 * Run a bounded OpenRouter tool loop. Returns null when no API key or the
 * request fails before any useful tool result.
 */
export async function runAskModelLoop(input: {
  query: string;
  turns?: AskTurn[];
  ctx: AskToolContext;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<ModelAskOutcome | null> {
  const apiKey = input.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;

  const fetchImpl = input.fetchImpl ?? input.ctx.fetchImpl ?? fetch;
  const model =
    input.model ?? process.env.OPENROUTER_MODEL ?? "anthropic/claude-sonnet-4-5";

  const messages: ChatMessage[] = [{ role: "system", content: systemPrompt() }];
  for (const turn of input.turns ?? []) {
    if (turn.role === "user" || turn.role === "assistant") {
      messages.push({ role: turn.role, content: turn.content.slice(0, 800) });
    }
  }
  messages.push({ role: "user", content: input.query.slice(0, 500) });

  const toolResults: AskToolResult[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const response = await fetchImpl(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: MAX_TOKENS,
          tools: askToolDefinitions(),
          tool_choice: round === 0 ? "auto" : "auto",
          messages,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        return toolResults.length ? { toolResults } : null;
      }
      const body = (await response.json()) as {
        choices?: Array<{
          message?: ChatMessage;
          finish_reason?: string;
        }>;
      };
      const message = body.choices?.[0]?.message;
      if (!message) {
        return toolResults.length ? { toolResults } : null;
      }

      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0) {
        return { toolResults };
      }

      messages.push({
        role: "assistant",
        content: message.content ?? null,
        tool_calls: toolCalls,
      });

      for (const call of toolCalls.slice(0, 3)) {
        const name = call.function?.name ?? "";
        if (!isAskToolName(name)) {
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: JSON.stringify({ error: "Tool not allowlisted." }),
          });
          continue;
        }
        const args = parseArgs(call.function.arguments);
        const result = await runAskTool(name, args, {
          ...input.ctx,
          skipModel: true,
        });
        toolResults.push(result);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: result.ok,
            answerHint: result.answerHint,
            cardCount: result.cards.length,
            proposalCount: result.proposals.length,
            degraded: result.degraded === true,
            data: result.data,
          }).slice(0, 6000),
        });
      }
    }

    return { toolResults };
  } catch {
    return toolResults.length ? { toolResults } : null;
  } finally {
    clearTimeout(timer);
  }
}
