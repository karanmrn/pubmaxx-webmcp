import "server-only";

// Serverless-safe Night Signal candidate ingestion — the EXA sweep half of
// scripts/ingest_night_signal_candidates.mjs, callable from a Vercel cron.
//
// It reuses the SAME tested pure candidate-honesty logic (buildCandidates /
// exaResultToCandidate: real, dated, https, area-attributable only; verbatim
// headline; routeEffect "none"; reviewState "pending"). It NEVER publishes and
// NEVER writes a committed file — the caller decides what to do with the staged
// PENDING candidates. Without EXA_API_KEY it is a safe no-op.

import {
  EXA_QUERY_SET,
  buildCandidates,
  type NightSignalCandidate,
} from "@/scripts/ingest_night_signal_candidates.mjs";
import { DAY_MS } from "@/lib/dayMs";

const EXA_ENDPOINT = "https://api.exa.ai/search";
const LOOKBACK_DAYS = 30;
const RESULTS_PER_QUERY = 15;

export type { NightSignalCandidate };

export type NightSignalIngestResult =
  | { status: "skipped"; reason: "no-exa-key"; candidates: [] }
  | { status: "ingested"; candidates: NightSignalCandidate[] };

/** Injectable so tests never touch the paid Exa provider. Defaults to global fetch. */
export type NightSignalIngestDeps = {
  fetchImpl?: typeof fetch;
  now?: number;
  apiKey?: string | undefined;
};

async function searchExa(
  fetchImpl: typeof fetch,
  apiKey: string,
  query: string,
  startPublishedDate: string,
): Promise<unknown[]> {
  const response = await fetchImpl(EXA_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({
      query,
      type: "auto",
      numResults: RESULTS_PER_QUERY,
      startPublishedDate,
      contents: { text: { maxCharacters: 800 } },
    }),
  });
  if (!response.ok) {
    throw new Error(`Exa search failed (${response.status}) for "${query}".`);
  }
  const payload = (await response.json()) as { results?: unknown };
  return Array.isArray(payload.results) ? payload.results : [];
}

/**
 * Sweep Exa for recent London pub buzz and return deduped PENDING candidates.
 * Bounded by design: EXA_QUERY_SET (3 queries) × RESULTS_PER_QUERY (15) capped at
 * MAX_CANDIDATES (40) — a single serverless invocation covers a full sweep, so no
 * cursor paging is required. Throws only on a provider/transport failure so the
 * caller can report it loudly; a well-formed empty sweep returns [].
 */
export async function ingestNightSignalCandidates(
  deps: NightSignalIngestDeps = {},
): Promise<NightSignalIngestResult> {
  const apiKey = (deps.apiKey ?? process.env.EXA_API_KEY)?.trim();
  if (!apiKey) return { status: "skipped", reason: "no-exa-key", candidates: [] };

  const fetchImpl = deps.fetchImpl ?? fetch;
  const now = deps.now ?? Date.now();
  const startPublishedDate = new Date(now - LOOKBACK_DAYS * DAY_MS).toISOString();

  const groups: Array<{ kind: string; results: unknown[] }> = [];
  for (const { kind, query } of EXA_QUERY_SET) {
    const results = await searchExa(fetchImpl, apiKey, query, startPublishedDate);
    groups.push({ kind, results });
  }
  return { status: "ingested", candidates: buildCandidates(groups, { now }) };
}
