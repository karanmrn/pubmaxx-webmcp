// The one shape every Night OS Ask tool answers in (ADR 0014).
//
// It lives apart from `lib/ask/tools.ts` so a handler module can be imported
// BY the registry without importing the registry back. `tools.ts` re-exports
// these names, so every existing caller is untouched.

import type { CityId } from "@/lib/cities";
import type { AskCard, AskProposal, AskSource, AskToolName } from "@/lib/ask/types";

export type AskProvenance = AskSource;

export type AskToolResult = {
  ok: boolean;
  tool: AskToolName;
  data: unknown;
  provenance: AskProvenance[];
  cards: AskCard[];
  proposals: AskProposal[];
  answerHint: string;
  degraded?: boolean;
};

export type AskToolArgs = Record<string, unknown>;

export type AskToolContext = {
  cityId: CityId;
  query: string;
  /** Skip paid intent assist inside search_venues / propose_plan. */
  skipModel?: boolean;
  fetchImpl?: typeof fetch;
  /** Injected clock, so a "what is on right now" answer is testable. */
  now?: number;
};

export type AskToolHandler = (
  args: AskToolArgs,
  ctx: AskToolContext,
) => Promise<AskToolResult>;
