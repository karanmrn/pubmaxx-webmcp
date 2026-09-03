import { normalizeHandle } from "@/lib/profiles";

export type ContributionLane = "price" | "review" | "recommendation";

export type ContributionQualitySignals = {
  /**
   * Whether independent contributors backed this price. Null for lanes where
   * corroboration has no meaning.
   */
  corroborated: boolean | null;
  /**
   * Unreviewed means no moderator decision. Kept means a moderator reviewed
   * the contribution and left or restored it. Hidden means it is not public.
   */
  moderation: "unreviewed" | "kept" | "hidden";
  /**
   * Whether a later visible price disagreed with this one. Null for lanes
   * where contradiction has no defined meaning.
   */
  contradicted: boolean | null;
};

export type ContributionRecord = {
  id: string;
  handle: string;
  lane: ContributionLane;
  contributedAt: number;
  visible: boolean;
  quality: ContributionQualitySignals;
};

export type ContributionRecordReadResult = {
  status: "ready" | "degraded";
  records: ContributionRecord[];
};

export type ContributorLeaderboardEntry = {
  rank: number;
  handle: string;
  total: number;
  prices: number;
  reviews: number;
  recommendations: number;
  avatarUrl?: string;
};

export type ContributorLeaderboardTally = Omit<
  ContributorLeaderboardEntry,
  "rank"
>;

export type ContributorLeaderboard =
  | {
    status: "ready";
    window: {
      kind: "all-time";
      label: "All visible identity-backed contributions, all time";
    };
    entries: ContributorLeaderboardEntry[];
  }
  | {
    status: "degraded";
    window: {
      kind: "unavailable";
      label: "All-time record unavailable";
    };
    entries: ContributorLeaderboardEntry[];
  };

type MutableTally = ContributorLeaderboardTally;

const ALL_TIME_WINDOW = {
  kind: "all-time",
  label: "All visible identity-backed contributions, all time",
} as const;

const UNAVAILABLE_WINDOW = {
  kind: "unavailable",
  label: "All-time record unavailable",
} as const;

/**
 * Rank public contributors by simple visible contribution volume. Quality
 * signals travel with source records for a future policy change, but this
 * function deliberately does not inspect them.
 */
export function rankContributors(
  records: readonly ContributionRecord[],
  status: ContributorLeaderboard["status"],
): ContributorLeaderboard {
  const byHandle = new Map<string, MutableTally>();
  for (const record of records) {
    if (!record.visible) continue;
    const handle = normalizeHandle(record.handle);
    if (!handle) continue;
    const tally = byHandle.get(handle) ?? {
      handle,
      total: 0,
      prices: 0,
      reviews: 0,
      recommendations: 0,
    };
    tally.total += 1;
    if (record.lane === "price") tally.prices += 1;
    if (record.lane === "review") tally.reviews += 1;
    if (record.lane === "recommendation") tally.recommendations += 1;
    byHandle.set(handle, tally);
  }

  return rankContributorTallies([...byHandle.values()], status);
}

export function rankContributorTallies(
  tallies: readonly ContributorLeaderboardTally[],
  status: ContributorLeaderboard["status"],
): ContributorLeaderboard {
  if (status === "degraded") {
    return { status, window: UNAVAILABLE_WINDOW, entries: [] };
  }

  const sorted = [...tallies].sort(
    (left, right) =>
      right.total - left.total || left.handle.localeCompare(right.handle),
  );
  let previousTotal: number | null = null;
  let rank = 0;
  const entries = sorted.map((entry, index) => {
    if (entry.total !== previousTotal) rank = index + 1;
    previousTotal = entry.total;
    return { rank, ...entry };
  });

  return { status, window: ALL_TIME_WINDOW, entries };
}
