import {
  socialCrewActor,
  socialCrewBody,
  socialCrewErrorResponse,
  socialCrewExactKeys,
  socialCrewHostCapability,
  socialCrewHouseError,
  socialCrewIdempotencyKey,
  socialCrewInvalidResponse,
  socialCrewMutation,
  socialCrewPrivateJson,
  socialCrewUnavailableResponse,
} from "@/lib/socialCrewHttp";
import { isSocialCrewVisibility } from "@/lib/socialCrew";
import { OPEN_PLAN_PLACE_REFUSED_LINE } from "@/lib/openSocialCrew";
import { resolveOpenPlanMeetingPoint } from "@/lib/openSocialCrew.server";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const store = createSocialCrewStore();

const LIST_LIMIT_MAX = 50;

/**
 * The crews this account is an active member of. `store.list` (the signed
 * member-page cursor over `read_social_crew_member_page`) has existed since the
 * crew wave shipped with no route in front of it, so a reader had no way to
 * find a crew they were already in. This exposes that read verbatim: same
 * actor, same projection, same cursor, no new authority.
 */
export async function GET(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access);
  if (!authority.ok) return authority.response;

  const params = new URL(request.url).searchParams;
  const rawCursor = params.get("cursor");
  const rawLimit = params.get("limit");
  let limit: number | undefined;
  if (rawLimit !== null) {
    const parsed = Number(rawLimit);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > LIST_LIMIT_MAX) {
      return socialCrewInvalidResponse();
    }
    limit = parsed;
  }

  try {
    return socialCrewPrivateJson(
      await store.list(authority.actor, {
        ...(rawCursor !== null ? { cursor: rawCursor } : {}),
        ...(limit !== undefined ? { limit } : {}),
      }),
    );
  } catch (error) {
    return socialCrewErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  const hostCapability = socialCrewHostCapability(request);
  if (!idempotencyKey || !hostCapability) return socialCrewInvalidResponse();
  const input = await socialCrewBody(request);
  if (!input.ok) return input.response;
  if (!socialCrewExactKeys(input.body, ["planId", "visibility"])) {
    return socialCrewInvalidResponse();
  }
  const { planId, visibility } = input.body;
  if (typeof planId !== "string" || !isSocialCrewVisibility(visibility)) {
    return socialCrewInvalidResponse();
  }
  if (visibility === "open") {
    const meeting = await resolveOpenPlanMeetingPoint(planId);
    if (meeting.ok === false && meeting.reason === "unavailable") {
      return socialCrewUnavailableResponse();
    }
    if (!meeting.ok) {
      return socialCrewHouseError(
        OPEN_PLAN_PLACE_REFUSED_LINE,
        "OPEN_PLAN_PLACE_REFUSED",
        422,
      );
    }
  }

  return socialCrewMutation(() => store.create(authority.actor, {
    planId,
    hostCapability,
    visibility,
    idempotencyKey,
  }), 201);
}
