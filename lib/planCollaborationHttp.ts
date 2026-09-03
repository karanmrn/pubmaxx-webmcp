import { publicApiError, type PublicApiError } from "@/lib/apiError";
import type { PlanCollaborationError } from "@/lib/planCollaborationStore";

export function collaborationIdempotencyKey(request: Request, body: Record<string, unknown>): string {
  return request.headers.get("idempotency-key")?.trim() || (typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "");
}

export function collaborationError(error: PlanCollaborationError): { body: PublicApiError; status: number } {
  const status = error === "not_found" ? 404
    : error === "forbidden" ? 403
      : error === "expired" ? 410
        : ["replayed", "revoked", "conflict", "account_conflict", "constraints_unresolved"].includes(error) ? 409
          : error === "error" ? 503
            : 400;
  const message = error === "constraints_unresolved" ? "Required crew constraints remain unresolved."
    : error === "replayed" ? "That capability has already been used."
      : error === "expired" ? "That capability has expired."
        : error === "revoked" ? "That capability was revoked."
          : error === "forbidden" ? "That member capability cannot perform this action."
            : error === "not_found" ? "That collaboration item does not exist."
              : error === "account_conflict" ? "This account is already in the Plan."
                : error === "conflict" ? "The Plan changed before this action could be applied."
                : error === "error" ? "The collaboration update is temporarily unavailable."
                  : "Add a valid collaboration request.";
  return { body: { error: message, code: `PLAN_COLLAB_${error.toUpperCase()}`, retryable: error === "error" || error === "conflict" }, status };
}

export function collaborationErrorResponse(error: PlanCollaborationError): Response {
  const failure = collaborationError(error);
  return publicApiError(
    failure.body.error,
    failure.body.code,
    failure.status,
    { retryable: failure.body.retryable, details: failure.body.details },
  );
}
