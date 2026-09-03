import { publicApiError } from "@/lib/apiError";
import { assertServerEnv } from "@/lib/serverEnv";
import { resolveSocialAccess } from "@/lib/socialAccessServer";
import { socialDraftScope } from "@/lib/socialDraftScope.server";

assertServerEnv();

function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

export async function GET(request: Request): Promise<Response> {
  const access = await resolveSocialAccess(request);
  if (!access.available) {
    return publicApiError(access.error, access.code, 503, {
      retryable: true,
      compatibilityFields: { available: false, state: access.state },
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  return privateJson({
    state: access.state,
    ...(access.state === "verified" ? {
      viewerHandle: access.actor.handle,
      draftScope: socialDraftScope(access.actor.profileId),
    } : {}),
    // Whether the one tap is this account's way through. Absent means no, so
    // the boundary shows the plain refusal rather than a button that would
    // change nothing.
    ...(access.state !== "verified" && access.adultPrompt
      ? { adultPrompt: true }
      : {}),
  });
}
