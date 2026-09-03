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

type Context = { params: Promise<{ crewId: string; memberId: string }> };

const store = createSocialCrewStore();

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { crewId, memberId } = await context.params;
  if (!isSocialCrewId(crewId) || !isSocialCrewId(memberId)) {
    return socialCrewNotFoundResponse();
  }
  const input = await socialCrewBody(request);
  if (!input.ok) return input.response;

  if (socialCrewExactKeys(input.body, ["action", "role"]) &&
    input.body.action === "set_role" &&
    (input.body.role === "cohost" || input.body.role === "member")) {
    return socialCrewMutation(() => store.setRole(authority.actor, {
      crewId,
      memberId,
      role: input.body.role as "cohost" | "member",
      idempotencyKey,
    }));
  }
  if (socialCrewExactKeys(input.body, ["action"]) &&
    input.body.action === "transfer_owner") {
    return socialCrewMutation(() => store.transferOwner(authority.actor, {
      crewId,
      memberId,
      idempotencyKey,
    }));
  }
  return socialCrewInvalidResponse();
}

export async function DELETE(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { crewId, memberId } = await context.params;
  if (!isSocialCrewId(crewId) || !isSocialCrewId(memberId)) {
    return socialCrewNotFoundResponse();
  }
  const input = await socialCrewBody(request, true);
  if (!input.ok) return input.response;
  if (!socialCrewEmptyBody(input.body)) return socialCrewInvalidResponse();

  return socialCrewMutation(() => store.removeMember(authority.actor, {
    crewId,
    memberId,
    idempotencyKey,
  }));
}
