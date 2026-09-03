// Shared "n ago" relative-time label for client cards (feed, comments, presence,
// tonight board). Extracted from four identical copies so the format — and the
// future/negative guard — live in one place.
//
// Called only in render off a STABLE createdAt (no live ticking), so server and
// first client render agree and there's no hydration mismatch. Mirrors the guard
// in lib/venues.ts formatFreshness: a future/negative timestamp (clock skew, an
// optimistic row stamped slightly ahead) prints "just now", never a negative age.
//
// Returns "" for a missing/invalid timestamp so the UI can skip the label.
export function relativeTime(iso: string | null | undefined): string {
  if (typeof iso !== "string" || iso.length === 0) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const diffMs = Date.now() - then;
  // Guard clock skew / future timestamps — never claim a negative age.
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  return new Date(then).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}
