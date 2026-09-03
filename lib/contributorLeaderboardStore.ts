import "server-only";

// Server-only read seam for the public contributor record. The durable store
// owns the complete identity-backed all-time aggregate; keyless mode cannot.

import {
  rankContributors,
  rankContributorTallies,
  type ContributorLeaderboard,
  type ContributorLeaderboardTally,
} from "@/lib/contributorLeaderboard";
import { resolveAvatarUrlsForHandles } from "@/lib/avatarResolve";
import { normalizeHandle } from "@/lib/profiles";
import {
  isSupabaseConfigured,
  requireSupabaseAdmin,
} from "@/lib/supabase";

type DurableLeaderboardRow = {
  handle?: unknown;
  prices?: unknown;
  reviews?: unknown;
  recommendations?: unknown;
  total?: unknown;
};

function count(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function durableBoard(rows: unknown): ContributorLeaderboard {
  if (!Array.isArray(rows)) {
    return rankContributors([], "degraded");
  }
  const tallies: ContributorLeaderboardTally[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") {
      return rankContributors([], "degraded");
    }
    const row = raw as DurableLeaderboardRow;
    const handle = normalizeHandle(
      typeof row.handle === "string" ? row.handle : "",
    );
    const prices = count(row.prices);
    const reviews = count(row.reviews);
    const recommendations = count(row.recommendations);
    const total = count(row.total);
    if (
      !handle ||
      prices === null ||
      reviews === null ||
      recommendations === null ||
      total === null ||
      total !== prices + reviews + recommendations
    ) {
      return rankContributors([], "degraded");
    }
    tallies.push({ handle, prices, reviews, recommendations, total });
  }
  return rankContributorTallies(tallies, "ready");
}

async function enrichContributorBoard(
  board: ContributorLeaderboard,
): Promise<ContributorLeaderboard> {
  if (board.status !== "ready" || board.entries.length === 0) return board;
  const urls = await resolveAvatarUrlsForHandles(board.entries.map((entry) => entry.handle));
  return {
    ...board,
    entries: board.entries.map((entry) => {
      const avatarUrl = urls.get(entry.handle);
      return avatarUrl ? { ...entry, avatarUrl } : entry;
    }),
  };
}

export { enrichContributorBoard };

async function readDurableBoard(): Promise<ContributorLeaderboard> {
  try {
    const { data, error } = await requireSupabaseAdmin().rpc(
      "public_contributor_leaderboard",
    );
    if (error) throw new Error(error.message);
    return durableBoard(data);
  } catch {
    return rankContributors([], "degraded");
  }
}

export async function readContributorLeaderboard(): Promise<ContributorLeaderboard> {
  if (isSupabaseConfigured()) return readDurableBoard();
  return rankContributors([], "degraded");
}

export type ContributorLaneStats =
  | {
    status: "ready";
    handle: string;
    prices: number;
    reviews: number;
    recommendations: number;
    total: number;
  }
  | { status: "degraded"; handle: string };

/**
 * Narrow, single-handle projection of the same durable board: the three-lane
 * counts (prices, reviews, recommendations) for one viewed handle, never the
 * full ranked list. Still routes through public_contributor_leaderboard() (the
 * 0079 claimed_at bound lives only there), so this can never resurrect the
 * handle-claim back-dating bug the way a direct table read would. A handle
 * with no ranked row (no visible identity-backed contributions yet) reads as
 * honest zeroes, not an error.
 */
export async function readContributorLaneStats(
  handle: string,
): Promise<ContributorLaneStats> {
  const normalized = normalizeHandle(handle);
  const board = await readContributorLeaderboard();
  if (board.status === "degraded") {
    return { status: "degraded", handle: normalized };
  }
  const entry = board.entries.find((row) => row.handle === normalized);
  return {
    status: "ready",
    handle: normalized,
    prices: entry?.prices ?? 0,
    reviews: entry?.reviews ?? 0,
    recommendations: entry?.recommendations ?? 0,
    total: entry?.total ?? 0,
  };
}
