import { isPlanIdempotencyKey } from "@/lib/planStore";

export function planMutationIdempotencyKey(request: Request, body: Record<string, unknown>): string | null {
  const header = request.headers.get("idempotency-key");
  const bodyValue = body.idempotencyKey;
  if (header === null && bodyValue === undefined) return null;
  const value = header ?? (typeof bodyValue === "string" ? bodyValue : null);
  return isPlanIdempotencyKey(value) ? value.trim() : null;
}

export const PLAN_IDEMPOTENCY_ERROR = {
  error: "Add a valid idempotency key before retrying this request.",
  code: "PLAN_IDEMPOTENCY_KEY_REQUIRED",
  retryable: false,
} as const;
