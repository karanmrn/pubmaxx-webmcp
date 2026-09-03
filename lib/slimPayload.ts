export function rowsFromSlimPayload(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== "object" || value === null) return null;
  const rows = (value as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows : null;
}
