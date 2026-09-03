// Ambient types for the pure exports of ingest_night_signal_candidates.mjs that
// the Vercel cron engine (lib/nightSignalIngest.server.ts) reuses, so the tested
// candidate-honesty logic has ONE home and cannot drift. Only the pure,
// serverless-safe surface is typed here; the file's git-PR staging path is not.

export type NightSignalCandidateKind = "opening" | "event";

export type NightSignalCandidate = {
  id: string;
  kind: NightSignalCandidateKind;
  entity: { type: "night_area"; id: string };
  claim: string;
  sourceUrl: string;
  publisher: string;
  publishedAt: string;
  observedAt: string;
  expiresAt: string;
  confidence: number;
  reviewState: "pending";
  verification: "single_source";
  routeEffect: "none";
  corroboratingSources: string[];
  reviewedAt: string | null;
  reviewAuthority: string | null;
};

export type ExaQuery = { kind: NightSignalCandidateKind; query: string };

export const EXA_QUERY_SET: readonly ExaQuery[];

export function buildCandidates(
  groups: ReadonlyArray<{ kind: string; results: unknown[] }>,
  options?: { now?: number; max?: number },
): NightSignalCandidate[];
