// Follow everybody in one starter pack, in one action.
//
// Every guard the single follow answers to answers here first, in the same
// order and through the same seams: the social freeze, the JWT-linked actor
// (`resolveMessageHandle`), the account law (a follow needs a bearer, so an
// anonymous write is 401 whatever handle the body names), the ownership gate
// (`gateHandleAction`), and ONE rate-limit spend for the whole pack rather than
// one per member, because the drinker made one decision. The write itself is
// `followOnce`, the shared edge write, so a pack cannot follow somebody
// differently from the profile button - and it cannot be followed by somebody
// the profile button would have refused.
//
// It is IDEMPOTENT because a follow edge is: the second tap answers 200 with
// every member reported `already`, which is the truth rather than a failure.
//
// It is HONEST about part-failure. One member's storage error does not fail the
// other eleven and does not get rounded up into "done": each member carries its
// own outcome and the summary line names the number that did not go through.
//
// A pack too thin to show is a pack you cannot follow. It answers the same 404
// as an unknown slug, so the refusal says nothing about who is in it.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { followOnce } from "@/lib/followWrite.server";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import { assertServerEnv } from "@/lib/serverEnv";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
  SOCIAL_ROLLBACK_CODE,
  SOCIAL_ROLLBACK_ERROR,
} from "@/lib/socialLaunch";
import {
  starterPackBySlug,
  starterPackFollowSummary,
  type StarterPackFollowResult,
} from "@/lib/starterPacks";
import { loadStarterPack } from "@/lib/starterPacks.server";
import {
  clientIp,
  hashIp,
  isSupabaseConfigured,
  requiresSupabaseStore,
} from "@/lib/supabase";

assertServerEnv();

/** A pack follow is a deliberate act, so the budget is small and per-actor. */
const PACK_FOLLOW_LIMIT = 6;
const PACK_FOLLOW_WINDOW_MS = 60_000;

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function notFound(): Response {
  return publicApiError("That pack isn't here.", "STARTER_PACK_NOT_FOUND", 404);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
): Promise<Response> {
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return publicApiError(SOCIAL_ROLLBACK_ERROR, SOCIAL_ROLLBACK_CODE, 503);
  }
  // Following a dozen accounts is a social write like any other.
  const frozen = socialFreezeResponse();
  if (frozen) return frozen;

  const pack = starterPackBySlug((await params).slug);
  if (!pack) return notFound();

  // An absent or empty body is fine: a signed-in browser needs to say nothing
  // but its bearer token. Malformed JSON is still malformed.
  let body: Record<string, unknown> = {};
  if (request.body !== null) {
    try {
      const parsed: unknown = await request.json();
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
    }
  }

  // ONE bearer verification for the whole write, handed down to both gates so a
  // signed-in pack follow stays a single round trip.
  const caller = await callerUserId(request);

  const follower = await resolveMessageHandle(request, readString(body.follower), caller);
  if (!follower) {
    return publicApiError("Choose a handle in your account first.", "INVALID_REQUEST", 400);
  }

  // A follow needs an ACCOUNT, on this lane as on the profile Follow button:
  // the body may name a handle, but an unlinked handle plus no bearer is how an
  // anonymous browser used to write a dozen edges at once.
  if (!caller) {
    return publicApiError("Sign in to follow them.", "UNAUTHENTICATED", 401);
  }

  const ownership = await gateHandleAction(request, follower, caller);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  // ONE spend for the whole pack: the drinker made one decision.
  const key = `starter-pack-follow:${follower}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key, PACK_FOLLOW_LIMIT, PACK_FOLLOW_WINDOW_MS)) {
    return publicApiError("Too many follow changes, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  if (requiresSupabaseStore() && !isSupabaseConfigured()) {
    return publicApiError(
      "Starter packs are unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  let view: Awaited<ReturnType<typeof loadStarterPack>>;
  try {
    view = await loadStarterPack(pack);
  } catch {
    return publicApiError(
      "Starter packs are unavailable right now.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  if (!view) return notFound();

  const results: StarterPackFollowResult[] = [];
  for (const member of view.members) {
    try {
      // Sequential on purpose: a dozen edges written at once against one actor
      // is a burst the follow graph never sees from a person.
      const outcome = await followOnce(follower, member.handle);
      results.push({ handle: member.handle, outcome });
    } catch {
      // One member's failure is one member's failure. It is reported as itself
      // and the rest of the pack still goes through.
      results.push({ handle: member.handle, outcome: "failed" });
    }
  }

  return jsonNoStore(
    {
      pack: pack.slug,
      results,
      summary: starterPackFollowSummary(results),
    },
    { status: 200 },
  );
}
