import {
  isSocialCrewId,
  socialCrewPublicErrorResponse,
  socialCrewPublicJson,
  socialCrewPublicNotFoundResponse,
  socialCrewPublicUnavailableResponse,
} from "@/lib/socialCrewHttp";
import { resolveOpenMeetingPoint } from "@/lib/openSocialCrew.server";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
} from "@/lib/socialLaunch";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ crewId: string }> };

const store = createSocialCrewStore();

/**
 * Account-free read for a listed Open Crew. The database is the visibility and
 * lifecycle authority; the current venue/POI index is the meeting-point
 * authority. Joining remains on the verified Social route.
 */
export async function GET(_request: Request, context: Context): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return socialCrewPublicUnavailableResponse();
  }
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewPublicNotFoundResponse();

  try {
    const source = await store.readPublicPreview(crewId);
    const resolution = await resolveOpenMeetingPoint(source.stopVenueId);
    if (!resolution.ok) {
      return resolution.reason === "unavailable"
        ? socialCrewPublicUnavailableResponse()
        : socialCrewPublicNotFoundResponse();
    }
    const { cityId, ...meetingPoint } = resolution.meetingPoint;
    void cityId;
    return socialCrewPublicJson({
      kind: "public",
      crewId: source.crewId,
      title: source.title,
      hostHandle: source.hostHandle,
      startsAt: new Date(source.startsAt).toISOString(),
      meetingPoint,
    });
  } catch (error) {
    return socialCrewPublicErrorResponse(error);
  }
}
