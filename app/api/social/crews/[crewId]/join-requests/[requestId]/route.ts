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

type Context = { params: Promise<{ crewId: string; requestId: string }> };

const store = createSocialCrewStore();

export async function PATCH(request: Request, context: Context): Promise<Response> {
  const access = await requireVerifiedSocialActor(request);
  const authority = await socialCrewActor(access, true);
  if (!authority.ok) return authority.response;

  const idempotencyKey = socialCrewIdempotencyKey(request);
  if (!idempotencyKey) return socialCrewInvalidResponse();
  const { crewId, requestId } = await context.params;
  if (!isSocialCrewId(crewId) || !isSocialCrewId(requestId)) {
    return socialCrewNotFoundResponse();
  }
  const input = await socialCrewBody(request);
  if (!input.ok) return input.response;
  if (!socialCrewExactKeys(input.body, ["decision"]) ||
    (input.body.decision !== "accept" && input.body.decision !== "decline")) {
    return socialCrewInvalidResponse();
  }

  return socialCrewMutation(() => store.decideJoin(authority.actor, {
    crewId,
    requestId,
    decision: input.body.decision as "accept" | "decline",
    idempotencyKey,
  }));
}
