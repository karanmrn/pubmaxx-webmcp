import {
  isSocialCrewId,
  socialCrewActor,
  socialCrewBody,
  socialCrewEmptyBody,
  socialCrewExactKeys,
  socialCrewIdempotencyKey,
  socialCrewInvalidResponse,
  socialCrewMutation,
  socialCrewNotFoundResponse,
} from "@/lib/socialCrewHttp";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

type Context = { params: Promise<{ crewId: string; invitationId: string }> };

const store = createSocialCrewStore();

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { crewId, invitationId } = await context.params;
  if (!isSocialCrewId(crewId) || !isSocialCrewId(invitationId)) {
    return socialCrewNotFoundResponse();
  }
  const input = await socialCrewBody(request);
  if (!input.ok) return input.response;
  if (!socialCrewExactKeys(input.body, ["action"]) ||
    (input.body.action !== "accept" && input.body.action !== "decline")) {
    return socialCrewInvalidResponse();
  }

  return socialCrewMutation(() => store.acceptInvitation(authority.actor, {
    crewId,
    invitationId,
    action: input.body.action as "accept" | "decline",
    idempotencyKey,
  }));
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { crewId, invitationId } = await context.params;
  if (!isSocialCrewId(crewId) || !isSocialCrewId(invitationId)) {
    return socialCrewNotFoundResponse();
  }
  const input = await socialCrewBody(request, true);
  if (!input.ok) return input.response;
  if (!socialCrewEmptyBody(input.body)) return socialCrewInvalidResponse();

  return socialCrewMutation(() => store.revokeInvitation(authority.actor, {
    crewId,
    invitationId,
    idempotencyKey,
  }));
}
