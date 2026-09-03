// Orchestrate one Night OS Ask turn: deterministic tools and optional model loop.

import {
  refineRoutedAskQuery,
  routeAskDeterministically,
} from "@/lib/ask/router";
import { runAskModelLoop } from "@/lib/ask/modelLoop";
import {
  resolveAskCityId,
  runAskTool,
  type AskToolContext,
  type AskToolResult,
} from "@/lib/ask/tools";
import type {
  AskCard,
  AskProposal,
  AskResponseBody,
  AskSource,
  AskTurn,
} from "@/lib/ask/types";

const MAX_TURNS = 6;

function dedupeCards(results: AskToolResult[]): AskCard[] {
  const seenKeys = new Set<string>();
  const venueIdsFromEarlierResults = new Set<string>();
  const out: AskCard[] = [];
  for (const result of results) {
    const keptCards: AskCard[] = [];
    for (const card of result.cards) {
      if (seenKeys.has(card.key)) continue;
      if (card.venueId && venueIdsFromEarlierResults.has(card.venueId)) continue;
      seenKeys.add(card.key);
      keptCards.push(card);
    }
    out.push(...keptCards);
    for (const card of keptCards) {
      if (card.venueId) venueIdsFromEarlierResults.add(card.venueId);
    }
  }
  return out.slice(0, 8);
}

function dedupeProposals(proposals: AskProposal[]): AskProposal[] {
  const seen = new Set<string>();
  const out: AskProposal[] = [];
  for (const proposal of proposals) {
    if (seen.has(proposal.id)) continue;
    seen.add(proposal.id);
    out.push(proposal);
  }
  return out.slice(0, 6);
}

function dedupeSources(sources: AskSource[]): AskSource[] {
  const seen = new Set<string>();
  const out: AskSource[] = [];
  for (const source of sources) {
    const key = `${source.kind}:${source.label}:${source.url ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(source);
  }
  return out;
}

function mergeToolResults(results: AskToolResult[]): {
  cards: AskCard[];
  proposals: AskProposal[];
  sources: AskSource[];
  hints: string[];
  degraded: boolean;
  toolsUsed: string[];
} {
  const proposals: AskProposal[] = [];
  const sources: AskSource[] = [];
  const hintCandidates: Array<{ result: AskToolResult; hint: string }> = [];
  let degraded = false;
  const toolsUsed: string[] = [];

  for (const result of results) {
    toolsUsed.push(result.tool);
    proposals.push(...result.proposals);
    sources.push(...result.provenance);
    if (result.answerHint) hintCandidates.push({ result, hint: result.answerHint });
    if (result.degraded) degraded = true;
  }

  const totalCardCount = results.reduce((total, result) => total + result.cards.length, 0);
  const mergedCards = dedupeCards(results);
  const hints = hintCandidates
    .filter(
      ({ result }) =>
        !(
          mergedCards.length > 0 &&
          result.ok &&
          result.cards.length === 0 &&
          !result.degraded
        ),
    )
    .map(({ hint }) => hint);
  if (mergedCards.length < totalCardCount) {
    hints.push(`Showing the first ${mergedCards.length}.`);
  }

  return {
    cards: mergedCards,
    proposals: dedupeProposals(proposals),
    sources: dedupeSources(sources),
    hints,
    degraded,
    toolsUsed: [...new Set(toolsUsed)],
  };
}

function composeAnswer(
  hints: string[],
  cards: AskCard[],
  toolsUsed: string[],
): string {
  if (cards.length > 0) {
    const pubPickTools = new Set(["search_venues", "cheapest_pint_near"]);
    const isPubPickAnswer =
      toolsUsed.length > 0 &&
      toolsUsed.every((tool) => pubPickTools.has(tool)) &&
      cards.every((card) => Boolean(card.venueId));
    if (!isPubPickAnswer) {
      return hints.length > 0 ? hints.join(" ") : "Nothing sourced for that. Try a nearby area or a broader ask.";
    }
    const countLine = `${cards.length} ${cards.length === 1 ? "pick" : "picks"} from the listed pubs, each with its source.`;
    return [countLine, ...hints].join(" ");
  }
  if (hints.length > 0) return hints.join(" ");
  return "Nothing sourced for that. Try a nearby area or a broader ask.";
}

function normaliseTurns(raw: unknown): AskTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: AskTurn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : null;
    const content = typeof record.content === "string" ? record.content.trim() : "";
    if (!role || !content) continue;
    turns.push({ role, content: content.slice(0, 800) });
    if (turns.length >= MAX_TURNS) break;
  }
  return turns;
}

export type RunAskInput = {
  query: string;
  cityId?: unknown;
  turns?: unknown;
  /** When true, never call OpenRouter (tests / production without durable limiter). */
  skipModel?: boolean;
  fetchImpl?: typeof fetch;
};

/**
 * Run one Ask turn. Always returns a grounded body; never throws for soft
 * tool failures (those become degraded status + honest copy).
 */
export async function runAsk(input: RunAskInput): Promise<AskResponseBody> {
  const query = input.query.trim().slice(0, 500);
  const cityId = resolveAskCityId(input.cityId);
  const turns = normaliseTurns(input.turns);
  const ctx: AskToolContext = {
    cityId,
    query,
    skipModel: true,
    ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
  };

  let toolResults: AskToolResult[] = [];

  const allowModel =
    !input.skipModel && Boolean(process.env.OPENROUTER_API_KEY);

  if (allowModel) {
    const modelOutcome = await runAskModelLoop({
      query,
      turns,
      ctx,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    });
    if (modelOutcome && modelOutcome.toolResults.length > 0) {
      toolResults = modelOutcome.toolResults;
    }
  }

  if (toolResults.length === 0) {
    // Incorporate last user refinement phrases into the routed query when the
    // current ask is short ("cheaper", "closer to the Tube").
    const priorUser = [...turns].reverse().find((t) => t.role === "user");
    const routedQuery = refineRoutedAskQuery(query, priorUser?.content);
    const routed = routeAskDeterministically(routedQuery);
    for (const call of routed) {
      toolResults.push(
        await runAskTool(call.name, { ...call.args, query: routedQuery }, {
          ...ctx,
          query: routedQuery,
        }),
      );
    }
  }

  const merged = mergeToolResults(toolResults);
  return {
    answer: composeAnswer(merged.hints, merged.cards, merged.toolsUsed),
    cards: merged.cards,
    proposals: merged.proposals,
    sources: merged.sources,
    status: merged.degraded ? "degraded" : "ready",
    toolsUsed: merged.toolsUsed,
  };
}

export { normaliseTurns, mergeToolResults, composeAnswer };
