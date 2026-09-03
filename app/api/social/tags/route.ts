import { publicApiError } from "@/lib/apiError";
import { clientIp, hashIp } from "@/lib/supabase";
import { isLimited } from "@/lib/pintDrops";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { SocialPostConsentStoreError, socialPostConsentStore } from "@/lib/socialPostConsentStore";
import { boundedJson } from "@/lib/boundedRequest.server";

const ACTIONS = new Set(["approve", "decline", "withdraw", "cancel"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function json(body: unknown, status = 200): Response { return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } }); }

function page(request: Request): { lane: "proposed" | "approved"; cursor: string | null; limit: number } | null {
  const params = new URL(request.url).searchParams;
  const lane = params.get("lane") ?? "proposed";
  const cursor = params.get("cursor");
  const limit = Number(params.get("limit") ?? 20);
  if ((lane !== "proposed" && lane !== "approved") || !Number.isInteger(limit) || limit < 1 || limit > 50 ||
    [...params.keys()].some((key) => key !== "lane" && key !== "cursor" && key !== "limit")) return null;
  return { lane, cursor, limit };
}

export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return publicApiError(access.error, access.code, access.status, { headers: { "Cache-Control": "private, no-store" } });
  const input = page(request);
  if (!input) return publicApiError("Tag page is not valid.", "MALFORMED_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
  try { return json(await socialPostConsentStore.tagInbox(access.actor, input)); }
  catch (error) {
    if (error instanceof SocialPostConsentStoreError && /page is not valid/i.test(error.message)) {
      return publicApiError("Tag page is not valid.", "MALFORMED_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
    }
    return publicApiError("Photo tags are unavailable right now.", "SOCIAL_TAGS_UNAVAILABLE", 503, { retryable: true, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `social-tag-action:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey, 30)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const access = await requireVerifiedSocialActor(request);
  if (!access.ok) return publicApiError(access.error, access.code, access.status, { headers: { "Cache-Control": "private, no-store" } });
  let input: unknown;
  try { input = await boundedJson(request); } catch { return publicApiError("Tag request is not valid.", "MALFORMED_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } }); }
  const value = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  const expectedKeys = value?.action === "approve" ? 3 : 2;
  if (!value || Object.keys(value).length !== expectedKeys || typeof value.proposalId !== "string" ||
    !UUID.test(value.proposalId) || typeof value.action !== "string" || !ACTIONS.has(value.action)) {
    return publicApiError("Tag request is not valid.", "MALFORMED_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
  }
  const expectedAudienceRevision = value.expectedAudienceRevision;
  if (value.action === "approve" && (!Number.isInteger(expectedAudienceRevision) || Number(expectedAudienceRevision) < 0)) {
    return publicApiError("Review this photo tag again.", "MALFORMED_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    await socialPostConsentStore.actOnTag(
      access.actor,
      value.proposalId,
      value.action as "approve" | "decline" | "withdraw" | "cancel",
      value.action === "approve" ? Number(expectedAudienceRevision) : undefined,
    );
    return json({ ok: true });
  } catch (error) {
    if (error instanceof Error && /audience changed/i.test(error.message)) {
      return publicApiError("Review this photo tag again.", "TAG_REVIEW_STALE", 409, { headers: { "Cache-Control": "private, no-store" } });
    }
    return publicApiError("Tag choice was not saved.", "TAG_ACTION_DENIED", 403, { headers: { "Cache-Control": "private, no-store" } });
  }
}
