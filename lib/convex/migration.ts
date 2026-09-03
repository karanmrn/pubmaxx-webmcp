import "server-only";

import { createHash } from "node:crypto";

export { canTransitionMigration } from "@/lib/convex/migrationTransitions";
export type { MigrationBatchStatus } from "@/lib/convex/migrationTransitions";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !["_id", "_creationTime", "created_at", "updated_at"].includes(key))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function shadowRecordHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}
