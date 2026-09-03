import {
  REACTION_KEYS,
  type ReactionKey,
  type ReactionSummary,
} from "@/lib/reactions";
import { discardBody } from "@/lib/responseBody";

export type ReactionSummaryMap = Record<string, ReactionSummary>;

export type ReactionSummaryLoad = {
  summaries: ReactionSummaryMap;
  retryableIds: Set<string>;
  aborted: boolean;
};

const REACTION_SUMMARY_BATCH_SIZE = 100;
const LOCAL_PREFIX = "pubmax:reactions:";
const LEGACY_LOCAL_PREFIXES = [
  "pubmax:feed:reactions:",
  "pubmax:profile:reactions:",
] as const;

function parseLocalReactions(raw: string | null): ReactionKey[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((value): value is ReactionKey =>
      (REACTION_KEYS as readonly string[]).includes(String(value)),
    );
  } catch {
    return null;
  }
}

/** Browser-only fallback for demo drops the durable reaction store does not know. */
export function readLocalReactions(id: string): ReactionKey[] {
  if (typeof window === "undefined") return [];
  try {
    const current = parseLocalReactions(
      window.localStorage.getItem(LOCAL_PREFIX + id),
    );
    if (current) return current;

    const migrated = Array.from(
      new Set(
        LEGACY_LOCAL_PREFIXES.flatMap((prefix) =>
          parseLocalReactions(window.localStorage.getItem(prefix + id)) ?? [],
        ),
      ),
    );
    if (migrated.length > 0) writeLocalReactions(id, migrated);
    return migrated;
  } catch {
    return [];
  }
}

export function writeLocalReactions(id: string, mine: ReactionKey[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_PREFIX + id, JSON.stringify(mine));
  } catch {
    // Storage full or disabled. Reaction still flips in memory this session.
  }
}

export function localReactionSummary(mine: ReactionKey[]): ReactionSummary {
  const counts: Partial<Record<ReactionKey, number>> = {};
  for (const key of mine) counts[key] = 1;
  return { counts, mine };
}

export function toggleReactionMine(
  mine: readonly ReactionKey[],
  reaction: ReactionKey,
): ReactionKey[] {
  return mine.includes(reaction)
    ? mine.filter((key) => key !== reaction)
    : [...mine, reaction];
}

/**
 * Load bounded reaction-summary batches. A failed read stays retryable and may
 * render local fallback state, but only a confirmed POST 404 may classify a
 * drop as local-only.
 */
export async function loadReactionSummaries(
  ids: readonly string[],
  actorId: string,
  signal?: AbortSignal,
): Promise<ReactionSummaryLoad> {
  const uniqueIds = Array.from(new Set(ids));
  const batches: string[][] = [];
  for (let start = 0; start < uniqueIds.length; start += REACTION_SUMMARY_BATCH_SIZE) {
    batches.push(uniqueIds.slice(start, start + REACTION_SUMMARY_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map(async (batch) => {
      if (signal?.aborted) return { batch, aborted: true } as const;
      const query = `ids=${encodeURIComponent(batch.join(","))}&actor=${encodeURIComponent(actorId)}`;
      try {
        const response = await fetch(`/api/pint-drops/reactions?${query}`, { signal });
        if (!response.ok) {
          discardBody(response);
          throw new Error(String(response.status));
        }
        const data = (await response.json()) as { summaries?: ReactionSummaryMap };
        if (signal?.aborted) return { batch, aborted: true } as const;
        return { batch, summaries: data.summaries ?? {} } as const;
      } catch {
        if (signal?.aborted) return { batch, aborted: true } as const;
        return { batch, failed: true } as const;
      }
    }),
  );

  if (signal?.aborted || results.some((result) => "aborted" in result)) {
    return { summaries: {}, retryableIds: new Set(), aborted: true };
  }

  const summaries: ReactionSummaryMap = {};
  const retryableIds = new Set<string>();
  for (const result of results) {
    if ("failed" in result) {
      for (const id of result.batch) retryableIds.add(id);
    }
    for (const id of result.batch) {
      const serverSummary = "summaries" in result ? result.summaries?.[id] : undefined;
      summaries[id] =
        serverSummary ?? localReactionSummary(readLocalReactions(id));
    }
  }

  return { summaries, retryableIds, aborted: false };
}
