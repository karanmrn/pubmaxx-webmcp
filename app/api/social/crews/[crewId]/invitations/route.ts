import {
  isSocialCrewId,
  socialCrewActor,
  socialCrewBody,
  socialCrewExactKeys,
  socialCrewIdempotencyKey,
  socialCrewInvalidResponse,
  socialCrewMutation,
  socialCrewNotFoundResponse,
} from "@/lib/socialCrewHttp";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import { createSocialCrewStore } from "@/lib/socialCrewStore";

type Context = { params: Promise<{ crewId: string }> };

const store = createSocialCrewStore();

export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { crewId } = await context.params;
  if (!isSocialCrewId(crewId)) return socialCrewNotFoundResponse();
  const input = await socialCrewBody(request);
  if (!input.ok) return input.response;
  if (!socialCrewExactKeys(input.body, ["targetProfileId"]) ||
    !isSocialCrewId(input.body.targetProfileId)) {
    return socialCrewInvalidResponse();
  }

  return socialCrewMutation(() => store.invite(authority.actor, {
    crewId,
    targetProfileId: input.body.targetProfileId as string,
    idempotencyKey,
  }), 201);
}
