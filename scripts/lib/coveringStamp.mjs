// ONE line covering SEVERAL pieces of evidence takes the OLDEST of them, and
// goes undated entirely when it cannot date one - the covering half of the rule
// in AGENTS.md, whose opposite (a PAGE stamp taking the freshest evidence it
// holds) is deliberately not this.
//
// Two callers share it and must not drift: the London layer's manifest stamp
// covers three venue packs at once, and a `--from-raw` venue pack covers the
// raw Overpass snapshots it was re-normalized from. Both answer null rather
// than borrowing a day from the freshest member or from the wall clock.

/**
 * The oldest usable ISO stamp among `stamps`, or null when the set is empty or
 * any member is absent, not a string, or not a date.
 *
 * @param {readonly unknown[]} stamps
 * @returns {string | null}
 */
export function coveringStamp(stamps) {
  if (stamps.length === 0) return null;
  let oldest = null;
  for (const stamp of stamps) {
    if (typeof stamp !== "string") return null;
    const ms = Date.parse(stamp);
    if (!Number.isFinite(ms)) return null;
    if (oldest === null || ms < oldest.ms) oldest = { ms, stamp };
  }
  return oldest.stamp;
}
