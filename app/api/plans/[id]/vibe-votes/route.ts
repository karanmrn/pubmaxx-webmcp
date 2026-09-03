import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { isLimited } from "@/lib/pintDrops";
import { isPlanId } from "@/lib/plan";
import { collaborationErrorResponse, collaborationIdempotencyKey } from "@/lib/planCollaborationHttp";
import { planCollaborationStore } from "@/lib/planCollaborationStore";
import { planMemberCapability } from "@/lib/planMemberCapability";
import { clientIp, hashIp } from "@/lib/supabase";
import { isVibeChipId } from "@/lib/vibeChips";

// Vibe votes for the share-loop tally (docs/VIBE_LAYER_SPEC_2026-07-19.md,
// surface 3). POST records one vibe per plan member (member-capability bound,
// rate-limited, idempotent, upsert on revote). GET returns the aggregate tally
// (counts + top vibe) for the public share card and card-side reads — counts
// only, no member identity, so it needs no capability.

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  const result = await planCollaborationStore().vibeTally(id);
  if (!result.ok) return collaborationErrorResponse(result.error);
  return jsonNoStore(result, { status: 200 });
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const { id } = await context.params;
  if (!isPlanId(id)) return publicApiError("That Plan doesn't exist.", "PLAN_NOT_FOUND", 404);
  // Rate limit per plan + hashed IP (raw IP never keyed); this is also the
  // route's abuse boundary in the write-surface certification (rate_limit).
  const limiterKey = `plan-vibe-vote:${id}:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many votes, slow down.", "PLAN_VIBE_VOTE_RATE_LIMITED", 429, { retryable: true });
  }
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400); }
  if (!isVibeChipId(body.vibe)) return publicApiError("Pick one of the vibe chips.", "PLAN_VIBE_INVALID", 400);
  const result = await planCollaborationStore().recordVibeVote(id, planMemberCapability(request, body.memberToken), body.vibe, collaborationIdempotencyKey(request, body));
  if (!result.ok) return collaborationErrorResponse(result.error);
  return jsonNoStore(result, { status: 201 });
}
