import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { callerUserId } from "@/lib/authServer";
import { listNightMemories } from "@/lib/nightMemoryStore";
import { validatePendingPlanRecap } from "@/lib/planRecap";
import {
  cleanPlanRecapClaimItems,
  type PlanRecapClaimChoice,
} from "@/lib/planRecapClaim";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { promotePendingPlanRecapToMemory } from "@/lib/planRecapPromote.server";
import { pendingPlanRecapStore } from "@/lib/pendingPlanRecapStore";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  clientIp,
  hashIp,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";

assertServerEnv();

const WINDOW_MS = 60_000;

async function owner(request: Request): Promise<string | Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) {
    return publicApiError(
      "Sign in to keep your private Plan recaps.",
      "AUTH_REQUIRED",
      401,
    );
  }
  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError(
      "Private recap storage is not configured.",
      "PENDING_RECAP_STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  return ownerId;
}

async function rateLimited(request: Request, ownerId: string, action: "read" | "write") {
  const key = `pending-plan-recap:${action}:${ownerId}:${hashIp(clientIp(request))}`;
  return isLimited(key, key, action === "read" ? 60 : 30, WINDOW_MS);
}

/** Resolve bearer or path-scoped HttpOnly Plan member cookie for one plan. */
function resolveMemberToken(request: Request, planId: string, bodyToken: string): string | undefined {
  const synthetic = new Request(`http://local/api/plans/${planId}/recap`, {
    headers: request.headers,
  });
  return planMemberCapability(synthetic, bodyToken);
}

/**
 * Owner-scoped pending Plan recap drafts. Private only. Claim merge promotes a
 * device draft into one private Night Memory per completionId (idempotent) and
 * never opens a Social Story.
 */
export async function GET(request: Request): Promise<Response> {
  const resolved = await owner(request);
  if (resolved instanceof Response) return resolved;
  if (await rateLimited(request, resolved, "read")) {
    return publicApiError(
      "Too many private recap reads. Try again shortly.",
      "PENDING_RECAP_RATE_LIMITED",
      429,
      { retryable: true },
    );
  }
  try {
    const [drafts, memories] = await Promise.all([
      pendingPlanRecapStore().list(resolved),
      listNightMemories(resolved),
    ]);
    return jsonNoStore({
      drafts,
      memoryCompletionIds: memories
        .map((memory) => memory.planCompletionId)
        .filter((id): id is string => Boolean(id)),
    });
  } catch {
    return publicApiError(
      "Your private recaps are temporarily unavailable.",
      "PENDING_RECAP_STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}

export async function PUT(request: Request): Promise<Response> {
  const resolved = await owner(request);
  if (resolved instanceof Response) return resolved;
  if (await rateLimited(request, resolved, "write")) {
    return publicApiError(
      "Too many private recap updates. Try again shortly.",
      "PENDING_RECAP_RATE_LIMITED",
      429,
      { retryable: true },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "INVALID_JSON", 400);
  }
  const recap = validatePendingPlanRecap(body.recap);
  if (!recap) {
    return publicApiError(
      "Add a valid private Plan recap draft.",
      "INVALID_RECAP",
      400,
    );
  }

  try {
    const saved = await pendingPlanRecapStore().upsert(resolved, recap);
    if (!saved) {
      return publicApiError(
        "That private recap draft could not be saved.",
        "PENDING_RECAP_SAVE_FAILED",
        503,
        { retryable: true },
      );
    }
    return jsonNoStore({ draft: saved, private: true });
  } catch {
    return publicApiError(
      "That private recap draft could not be saved.",
      "PENDING_RECAP_STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  const resolved = await owner(request);
  if (resolved instanceof Response) return resolved;
  if (await rateLimited(request, resolved, "write")) {
    return publicApiError(
      "Too many private recap updates. Try again shortly.",
      "PENDING_RECAP_RATE_LIMITED",
      429,
      { retryable: true },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "INVALID_JSON", 400);
  }

  const action = body.action;
  if (action === "discard") {
    const completionId = typeof body.completionId === "string" ? body.completionId.trim() : "";
    if (!completionId || completionId.length > 80) {
      return publicApiError("Name the private recap to discard.", "INVALID_RECAP", 400);
    }
    await pendingPlanRecapStore().remove(resolved, completionId);
    return jsonNoStore({ discarded: true, private: true });
  }

  if (action !== "claim") {
    return publicApiError(
      "Choose bring or keep for this device recap.",
      "INVALID_RECAP_CLAIM",
      400,
    );
  }

  const choice = body.choice as PlanRecapClaimChoice | undefined;
  if (choice === "keep-device") {
    // Explicit: leave account Memories alone; device drafts stay local.
    return jsonNoStore({ claimed: false, memories: [], private: true });
  }
  if (choice !== "bring-device") {
    return publicApiError(
      "Choose bring or keep for this device recap.",
      "INVALID_RECAP_CLAIM",
      400,
    );
  }

  const items = cleanPlanRecapClaimItems(body.items);
  if (!items) {
    return publicApiError(
      "Add the private Plan recaps from this device and their Plan member capability.",
      "INVALID_RECAP_CLAIM",
      400,
    );
  }

  const memories = [];
  for (const item of items) {
    const memberToken = resolveMemberToken(request, item.recap.planId, item.memberToken);
    if (!memberToken) {
      return publicApiError(
        "Open the Plan in this browser before bringing the recap. Your local draft is safe.",
        "MEMBER_FORBIDDEN",
        403,
      );
    }
    const result = await promotePendingPlanRecapToMemory(
      resolved,
      item.recap,
      memberToken,
    );
    if (!result.ok) {
      if (
        result.error === "member_unavailable" ||
        result.error === "completion_unavailable" ||
        result.error === "save_failed"
      ) {
        await pendingPlanRecapStore().upsert(resolved, item.recap);
      }
      if (result.error === "member_forbidden") {
        return publicApiError(
          "That Plan member capability cannot bring this recap.",
          "MEMBER_FORBIDDEN",
          403,
        );
      }
      if (result.error === "conflict" || result.error === "not_completed") {
        return publicApiError(
          "The completed route changed. Refresh the recap before bringing it.",
          "RECAP_CONFLICT",
          409,
        );
      }
      if (result.error === "member_unavailable" || result.error === "completion_unavailable") {
        return publicApiError(
          "The Plan check is temporarily unavailable.",
          "MEMBER_LOOKUP_UNAVAILABLE",
          503,
          { retryable: true },
        );
      }
      return publicApiError(
        "That private recap could not be brought onto your account. Your local draft is safe.",
        "RECAP_SAVE_FAILED",
        503,
        { retryable: true },
      );
    }
    await pendingPlanRecapStore().remove(resolved, item.recap.completionId);
    memories.push({ memory: result.memory, moments: result.moments, private: true });
  }

  return jsonNoStore({ claimed: true, memories, private: true }, { status: 201 });
}
