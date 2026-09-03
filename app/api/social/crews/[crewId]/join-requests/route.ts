import {
  isSocialCrewId,
  socialCrewActor,
  socialCrewBody,
  socialCrewEmptyBody,
  socialCrewIdempotencyKey,
  socialCrewInvalidResponse,
  socialCrewMutation,
  socialCrewNotFoundResponse,
  socialCrewPrivateJson,
  socialCrewErrorResponse,
} from "@/lib/socialCrewHttp";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

type Context = { params: Promise<{ crewId: string }> };
type Access = Awaited<ReturnType<typeof requireVerifiedSocialActor>>;

const store = createSocialCrewStore();

export async function GET(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access);
  if (!authority.ok) return authority.response;

  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  try {
    return socialCrewPrivateJson(
      await store.listJoinRequests(crewId, authority.actor),
    );
  } catch (error) {
    return socialCrewErrorResponse(error);
  }
}

async function changeJoinRequest(
  request: Request,
  context: Context,
  action: "request" | "cancel",
  access: Access,
): Promise<Response> {
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  const input = await socialCrewBody(request, true);
  if (!input.ok) return input.response;
  if (!socialCrewEmptyBody(input.body)) return socialCrewInvalidResponse();

  return socialCrewMutation(() => store.requestJoin(authority.actor, {
    crewId,
    action,
    idempotencyKey,
  }), action === "request" ? 201 : 200);
}

export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  return changeJoinRequest(request, context, "request", access);
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  return changeJoinRequest(request, context, "cancel", access);
}
