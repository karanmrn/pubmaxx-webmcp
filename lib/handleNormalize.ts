// Leaf handle normalisation — no imports, so every browser-safe and server
// module can share one cap and regex without drifting (migration 0029 CHECK).

/** Matches `char_length(handle) between 1 and 30` in migration 0029. */
export const HANDLE_MAX = 30;

export function normalizeHandle(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, HANDLE_MAX);
}
