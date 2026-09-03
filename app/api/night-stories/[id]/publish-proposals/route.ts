import { publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { findPublishAltTextGap, proposeNightStoryPublication } from "@/lib/nightMemoryStore";
import { socialFreezeResponse } from "@/lib/opsFreeze";

/** Value-first, photo-naming message when publication is blocked on alt text. */
function altTextBlockMessage(label: string): string {
  return `“${label}” still needs a one-line photo description so someone using a screen reader can picture it. Add it, then publish. It stays private until you do.`;
}

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context): Promise<Response> {
  const limiterKey = `night-story-publish-propose:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // Solo-operator emergency freeze (U15): proposing a Story publication is a social write.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const actorId = await callerUserId(request);
  if (!actorId) return publicApiError("Sign in to propose Story publication.", "UNAUTHENTICATED", 401);
  let body: unknown;
  try { body = await request.json(); } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const { id } = await context.params;
  const proposal = await proposeNightStoryPublication(actorId, id, body);
  if (proposal) return jsonNoStore(proposal, { status: 201 });
  // Distinguish the accessibility block from the consent block so the author gets
  // a specific, value-first message naming which photo needs a description.
  const momentIds = body && typeof body === "object" ? (body as { momentIds?: unknown }).momentIds : undefined;
  const gap = await findPublishAltTextGap(actorId, id, momentIds);
  return gap
    ? publicApiError(altTextBlockMessage(gap.label), "MOMENT_ALT_TEXT_REQUIRED", 409, {
      compatibilityFields: { momentId: gap.momentId },
    })
    : publicApiError("Every selected Moment needs current owner approval.", "CONFLICT", 409);
}
