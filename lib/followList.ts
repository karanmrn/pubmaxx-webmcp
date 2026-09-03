// The public shape of one row in a follow list (followers or following).
// Pure and browser-safe: routes project into it, clients read it, and the
// feed extracts handles from either this object or a legacy string.

import { normalizeHandle } from "@/lib/handleNormalize";

export type FollowListEntry = {
  handle: string;
  displayName?: string;
  avatarUrl?: string;
};

/** One row from a follow-list API body, or nothing if it carries no handle. */
export function parseFollowListEntry(row: unknown): FollowListEntry | null {
  if (typeof row === "string") {
    const handle = normalizeHandle(row);
    return handle ? { handle } : null;
  }
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  const handle = normalizeHandle(record.handle);
  if (!handle) return null;
  const entry: FollowListEntry = { handle };
  if (typeof record.displayName === "string" && record.displayName.trim()) {
    entry.displayName = record.displayName.trim();
  }
  if (typeof record.avatarUrl === "string" && record.avatarUrl.trim()) {
    entry.avatarUrl = record.avatarUrl.trim();
  }
  return entry;
}

/** Handles only, for callers that still think in sets (the feed lane, /lot). */
export function followListHandle(row: unknown): string {
  return parseFollowListEntry(row)?.handle ?? "";
}

/**
 * The whole body's handles as a set, for a surface that only asks "does the
 * viewer already follow this person".
 *
 * This is ONE owner on purpose. The body carried bare strings, then carried
 * objects, and the third consumer of it was still stuffing rows straight into a
 * `Set<string>`: the set then held objects, every `has()` answered false, and a
 * person the viewer already follows was offered a plain Follow button. A caller
 * that asks this function cannot make that mistake again.
 */
export function followListHandleSet(rows: unknown): Set<string> {
  const handles = new Set<string>();
  if (!Array.isArray(rows)) return handles;
  for (const row of rows) {
    const handle = followListHandle(row);
    if (handle) handles.add(handle);
  }
  return handles;
}
