// Crew vibe tally copy for the plan-card share stamp (docs/VIBE_LAYER_SPEC
// _2026-07-19.md, surface 3). Pure: turns an aggregate vote count into the one
// line the OG card prints under the vibe stamp, e.g. "3 of the lot voted On a
// bender, 1 coward voted Quiet pint".
//
// Register: the share stamp is a sanctioned register surface (spec), so "the
// lot" and the "coward" jab ride here — but the humour must NEVER misfire. The
// coward line renders ONLY when the top vibe has a strict majority AND exactly
// one single dissenting vote. A tie has no top vibe, so it states the split
// plainly and drops the jab. No em dashes (voice spec).

import type { VibeChipId } from "@/lib/vibeChips";
import { VIBE_CHIP_IDS, vibeChipById } from "@/lib/vibeChips";

export type VibeTallyEntry = { vibe: VibeChipId; count: number };

export type VibeTally = {
  /** Total votes cast across the crew (one per member). */
  total: number;
  /** Per-vibe counts, sorted highest first (chip-declaration order breaks ties). */
  counts: VibeTallyEntry[];
  /** The single leading vibe, or null on an empty tally or a tie for the lead. */
  top: VibeChipId | null;
};

const EMPTY_COUNTS: VibeTallyEntry[] = [];

/** Empty sentinel — a plan with no votes yet. */
export const EMPTY_VIBE_TALLY: VibeTally = { total: 0, counts: EMPTY_COUNTS, top: null };

/** Aggregate a flat list of one-per-member votes into a sorted, ranked tally. */
export function tallyVibeVotes(votes: readonly { vibe: VibeChipId }[]): VibeTally {
  const byVibe = new Map<VibeChipId, number>();
  for (const vote of votes) {
    byVibe.set(vote.vibe, (byVibe.get(vote.vibe) ?? 0) + 1);
  }
  const counts = rankEntries([...byVibe.entries()].map(([vibe, count]) => ({ vibe, count })));
  const total = votes.length;
  const leaders = counts.filter((entry) => entry.count === counts[0]?.count);
  return { total, counts, top: counts.length > 0 && leaders.length === 1 ? counts[0].vibe : null };
}

/** Highest count first; chip-declaration order is the deterministic tiebreak. */
function rankEntries(entries: VibeTallyEntry[]): VibeTallyEntry[] {
  return entries
    .filter((entry) => entry.count > 0)
    .slice()
    .sort((a, b) => b.count - a.count || VIBE_CHIP_IDS.indexOf(a.vibe) - VIBE_CHIP_IDS.indexOf(b.vibe));
}

function labelOf(vibe: VibeChipId): string {
  return vibeChipById(vibe)?.label ?? vibe;
}

/**
 * The single share-card tally line, or null when there are no votes (the
 * caller keeps its no-votes render path byte-identical). Deterministic and
 * self-contained — re-ranks its input, so unsorted counts render the same.
 */
export function vibeTallyLine(tally: VibeTally): string | null {
  const ranked = rankEntries(tally.counts);
  if (ranked.length === 0) return null;

  const topCount = ranked[0].count;
  const leaders = ranked.filter((entry) => entry.count === topCount);
  if (leaders.length > 1) {
    // No top vibe — state the split honestly, no jab (humour must not misfire).
    const split = leaders.slice(0, 3).map((entry) => `${entry.count} ${labelOf(entry.vibe)}`).join(", ");
    return `The lot's split: ${split}`;
  }

  const top = ranked[0];
  const line = `${top.count} of the lot voted ${labelOf(top.vibe)}`;
  const dissent = ranked.slice(1);
  const dissentTotal = dissent.reduce((sum, entry) => sum + entry.count, 0);
  // Exactly one dissenting vote (a single member out of step) earns the jab.
  if (dissentTotal === 1) return `${line}, 1 person voted ${labelOf(dissent[0].vibe)}`;
  return line;
}
