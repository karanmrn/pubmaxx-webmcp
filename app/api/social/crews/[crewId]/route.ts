import {
  isSocialCrewId,
  socialCrewActor,
  socialCrewBody,
  socialCrewErrorResponse,
  socialCrewExactKeys,
  socialCrewHouseError,
  socialCrewIdempotencyKey,
  socialCrewInvalidResponse,
  socialCrewMutation,
  socialCrewNotFoundResponse,
  socialCrewPrivateJson,
  socialCrewUnavailableResponse,
} from "@/lib/socialCrewHttp";
import { isSocialCrewVisibility } from "@/lib/socialCrew";
import { OPEN_PLAN_PLACE_REFUSED_LINE } from "@/lib/openSocialCrew";
import { resolveOpenMeetingFromStops } from "@/lib/openSocialCrew.server";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ crewId: string }> };

const store = createSocialCrewStore();

export async function GET(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access);
  if (!authority.ok) return authority.response;
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  try {
    return socialCrewPrivateJson(await store.read(crewId, authority.actor));
  } catch (error) {
    return socialCrewErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  const input = await socialCrewBody(request);
  if (!input.ok) return input.response;
  if (!socialCrewExactKeys(input.body, ["visibility", "expectedAuthorityRevision"])) {
    return socialCrewInvalidResponse();
  }
  const { visibility, expectedAuthorityRevision } = input.body;
  if (
    !isSocialCrewVisibility(visibility) ||
    !Number.isSafeInteger(expectedAuthorityRevision) ||
    Number(expectedAuthorityRevision) < 0 ||
    Number(expectedAuthorityRevision) > 2_147_483_647
  ) {
    return socialCrewInvalidResponse();
  }
  if (visibility === "open") {
    try {
      const crew = await store.read(crewId, authority.actor);
      if (crew.kind !== "member") return socialCrewInvalidResponse();
      const meeting = await resolveOpenMeetingFromStops(crew.plan.stops);
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
    } catch (error) {
      return socialCrewErrorResponse(error);
    }
  }

  return socialCrewMutation(() => store.updateVisibility(authority.actor, {
    crewId,
    visibility,
    expectedAuthorityRevision: Number(expectedAuthorityRevision),
    idempotencyKey,
  }));
}
