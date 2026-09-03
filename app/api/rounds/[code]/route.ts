// A single Round's live state + the join / add-stop / close actions (GH #26).
//   GET                              → 200 { round, members, stops }  | 404
//   POST { action: "join",  handle } → 200 RoundState | 400/404/409
//   POST { action: "addStop", handle, venueId, venueName, dropRef? }
//                                    → 200 RoundState | 400/403/404/409
//   POST { action: "close",  handle } → 200 RoundState | 400/403/404
//
// The GET is what the Round page polls (~10s while open + on focus) — live-ness by
// polling, the repo convention (the notifications bell polls; no websockets). It is
// fail-soft: a store outage renders as 404 (not found), never a 500.
//
// Identity: prefer a verified Supabase Auth JWT when present — if the auth user
// has a linked profile, that handle is the actor (body handle is not trusted
// alone). When auth is absent / unconfigured / unlinked, the self-asserted
// handle still works (demo path), same as messages. The code IS the capability —
// anyone who knows it can read + (as a member) build the Round. Writes are
// rate-limited per handle + IP.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import {
  resolveContributionIdentity,
  type ContributionIdentityResolution,
} from "@/lib/contributionIdentity.server";
import { submitCommunityPrice } from "@/lib/communityPriceStore";
import { resolveMessageHandle } from "@/lib/messageAuth";
import { isLimited } from "@/lib/pintDrops";
import { gateHandleAction } from "@/lib/profileOwnership";
import {
  ROUND_PRICE_DEGRADED_RETRY_SECONDS,
  chargeRoundPriceLines,
  type RoundPriceBudget,
} from "@/lib/roundPriceBudget";
import {
  ROUND_SPEND_PRICE_LINE_MAX,
  cleanNewRoundSpend,
  firstPartyPriceItems,
  isValidRoundCode,
  type RoundSpendDTO,
  type RoundState,
} from "@/lib/rounds";
import {
  roundsStore,
  type RoundsStore,
  type RoundWriteError,
} from "@/lib/roundsStore";
import { projectRoundView } from "@/lib/roundView.server";
import { assertServerEnv } from "@/lib/serverEnv";
import { isRoundsReadLimited } from "@/lib/roundsReadRateLimit";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

assertServerEnv();

type Ctx = { params: Promise<{ code: string }> };

async function roundStateResponse(
  request: Request,
  state: RoundState,
  status = 200,
): Promise<Response> {
  return jsonNoStore(await projectRoundView(request, state), { status });
}

// Map a store write-error to an HTTP status + a grounded message.
function errorResponse(error: RoundWriteError): Response {
  const map: Record<RoundWriteError, { status: number; code: string; message: string }> = {
    not_found: { status: 404, code: "ROUND_NOT_FOUND", message: "That Round doesn't exist." },
    closed: { status: 409, code: "ROUND_CLOSED", message: "This Round has been called. It's closed." },
    invalid: { status: 400, code: "INVALID_REQUEST", message: "Check the details and try again." },
    forbidden: { status: 403, code: "FORBIDDEN", message: "You're not in this Round." },
    // A store failure is a degraded dependency (503, fail-soft), not a bug (500)
    // — the house contract every other write route uses (see pint-drops).
    error: { status: 503, code: "STORE_UNAVAILABLE", message: "Couldn't save that. Try again." },
  };
  const { status, code, message } = map[error];
  return publicApiError(message, code, status, { retryable: status >= 500 });
}

export async function GET(request: Request, ctx: Ctx): Promise<Response> {
  const { code } = await ctx.params;
  if (!isValidRoundCode(code)) {
    return publicApiError("That Round doesn't exist.", "NOT_FOUND", 404);
  }
  if (await isRoundsReadLimited(request)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }
  const state = await roundsStore().getByCode(code);
  if (!state) return publicApiError("That Round doesn't exist.", "NOT_FOUND", 404);
  return roundStateResponse(request, state);
}

type ResolvedContributor = Extract<
  ContributionIdentityResolution,
  { ok: true }
>;

function roundBudgetFailure(budget: RoundPriceBudget): Response | null {
  if (budget.allowed) return null;
  if (budget.mode === "degraded") {
    return publicApiError(
      "Your round is kept, but price sharing is unavailable. Try again shortly.",
      "UNAVAILABLE",
      503,
      {
        retryable: true,
        headers: { "Retry-After": String(ROUND_PRICE_DEGRADED_RETRY_SECONDS) },
      },
    );
  }
  if (budget.mode === "rejected") {
    return publicApiError("Your round is kept, but price sharing could not be checked.", "UNAVAILABLE", 503, { retryable: true });
  }
  return publicApiError("Your round is kept. Price logging is busy. Try those prices again.", "RATE_LIMITED", 429, { retryable: true });
}

async function preparePendingRoundPrices(input: {
  store: RoundsStore;
  code: string;
  clientRef: string;
  state: RoundState;
  contributor: ResolvedContributor;
  promotionOwner: string;
}): Promise<
  | { ok: true; state: RoundState; stored: RoundSpendDTO }
  | { ok: false; response: Response }
> {
  let state = input.state;
  let stored = state.spends.find(
    (spend) => spend.clientRef === input.clientRef,
  );
  if (!stored) return { ok: false, response: errorResponse("error") };
  const storedId = stored.id;
  const pending = stored.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.promotionStatus === "pending");
  if (pending.length === 0) return { ok: true, state, stored };

  const budget = await chargeRoundPriceLines(
    input.contributor.actor,
    input.promotionOwner,
    pending.map(({ index }) => ({
      clientRef: input.clientRef,
      spendId: storedId,
      lineIndex: index,
    })),
  );
  const failure = roundBudgetFailure(budget);
  if (failure) return { ok: false, response: failure };

  const marked = await input.store.transitionSpendPromotions(
    input.code,
    input.clientRef,
    input.promotionOwner,
    pending.map(({ index }) => ({ index, status: "ready" as const })),
  );
  if (!marked.ok) {
    return { ok: false, response: errorResponse(marked.error) };
  }
  state = marked.state;
  stored = state.spends.find(
    (spend) => spend.clientRef === input.clientRef,
  );
  return stored
    ? { ok: true, state, stored }
    : { ok: false, response: errorResponse("error") };
}

async function promoteReadyRoundPrices(input: {
  store: RoundsStore;
  code: string;
  stored: RoundSpendDTO;
  contributor: ResolvedContributor;
  request: Request;
}): Promise<Response> {
  const ready = input.stored.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.promotionStatus === "ready");
  let completed = 0;
  const recordedAt = Date.parse(input.stored.recordedAt);
  for (const { item, index } of ready) {
    const write = await submitCommunityPrice(
      {
        venueId: input.stored.venueId,
        drinkCategory: item.drinkCategory,
        priceGbp: item.pricePence / 100,
        actor: input.contributor.actor,
        contributorHandle: input.contributor.handle,
        roundSource: { spendId: input.stored.id, lineIndex: index },
      },
      recordedAt,
    );
    if (
      !write.failed &&
      write.price &&
      typeof write.sourceBecameOwner === "boolean"
    ) {
      completed += 1;
    }
  }

  if (completed !== ready.length) {
    return publicApiError("Your round is kept, but some prices need another try.", "UNAVAILABLE", 503, { retryable: true });
  }
  const state = await input.store.getByCode(input.code);
  if (!state) return errorResponse("error");
  return roundStateResponse(input.request, state);
}

// One immutable buying turn, plus the price submissions its drink lines earn.
async function recordSpend(
  request: Request,
  code: string,
  handle: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const store = roundsStore();
  const requestedVenueId = readString(body.venueId) ?? "";
  const venueLookup = await lookupCanonicalVenue(requestedVenueId);
  if (venueLookup.status === "unavailable") {
    return publicApiError("Venue list is unavailable right now, try again shortly.", "UNAVAILABLE", 503, { retryable: true });
  }
  if (venueLookup.status !== "found" || !isPubVenueKind(venueLookup.venue.kind)) {
    return publicApiError("Pick a pub from this Round.", "INVALID_REQUEST", 400);
  }
  const spendInput = {
    clientRef: body.clientRef,
    payerHandle: body.payerHandle,
    recordedByHandle: handle,
    venueId: venueLookup.canonicalId,
    venueName: venueLookup.venue.name,
    totalGbp: body.totalGbp,
    items: body.items,
  };
  const clean = cleanNewRoundSpend(spendInput);
  if (!clean) return errorResponse("invalid");

  // A plain total is a diary figure, not one drink, so it stops here.
  const observed = firstPartyPriceItems(clean.items);
  const contributor =
    observed.length > 0 ? await resolveContributionIdentity(request) : null;
  if (contributor?.ok && observed.length > ROUND_SPEND_PRICE_LINE_MAX) {
    return publicApiError(`Log up to ${ROUND_SPEND_PRICE_LINE_MAX} drink prices in one round. Keep this one, then start another.`, "INVALID_REQUEST", 400);
  }

  const hasBearer = /^Bearer\s+\S+/i.test(
    request.headers.get("authorization") ?? "",
  );
  if (
    observed.length > 0 &&
    hasBearer &&
    contributor &&
    !contributor.ok &&
    (contributor.httpStatus === 401 || contributor.httpStatus === 503)
  ) {
    return jsonNoStore(contributor.body, { status: contributor.httpStatus });
  }
  const promotionOwner = contributor?.ok ? contributor.actor : null;
  const result = await store.recordSpend(code, {
    ...spendInput,
    initialPromotionStatus:
      observed.length > 0 && promotionOwner ? "pending" : "diary_only",
    ...(promotionOwner ? { promotionActor: promotionOwner } : {}),
  });
  if (!result.ok) return errorResponse(result.error);

  if (observed.length === 0 || (!hasBearer && !contributor?.ok)) {
    return roundStateResponse(request, result.state);
  }
  if (!contributor) return errorResponse("error");
  if (!contributor.ok) {
    return jsonNoStore(contributor.body, { status: contributor.httpStatus });
  }
  if (!promotionOwner) return errorResponse("error");
  const owner = await store.claimSpendPromotionOwner(
    code,
    clean.clientRef,
    promotionOwner,
  );
  if (!owner.ok) {
    return owner.error === "forbidden"
      ? publicApiError("This saved round belongs to another account.", "FORBIDDEN", 403)
      : errorResponse(owner.error);
  }
  const reconciled = await store.reconcilePromotionKeys(
    code,
    clean.clientRef,
    promotionOwner,
  );
  if (!reconciled.ok) {
    return reconciled.error === "forbidden"
      ? publicApiError("This saved round belongs to another account.", "FORBIDDEN", 403)
      : errorResponse(reconciled.error);
  }

  const prepared = await preparePendingRoundPrices({
    store,
    code,
    clientRef: clean.clientRef,
    state: reconciled.state,
    contributor,
    promotionOwner,
  });
  if (!prepared.ok) return prepared.response;
  return promoteReadyRoundPrices({
    store,
    code,
    stored: prepared.stored,
    contributor,
    request,
  });
}

export async function POST(request: Request, ctx: Ctx): Promise<Response> {
  const { code } = await ctx.params;
  if (!isValidRoundCode(code)) {
    return publicApiError("That Round doesn't exist.", "NOT_FOUND", 404);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const action = readString(body.action);
  const handle = await resolveMessageHandle(request, readString(body.handle) ?? "");
  if (!handle) return publicApiError("Add a handle.", "INVALID_REQUEST", 400);

  const ownership = await gateHandleAction(request, handle);
  if (!ownership.allowed) {
    return publicApiErrorFromStatus(ownership.error, ownership.status);
  }

  // One limiter budget per handle+IP across every Round action.
  const key = `round-action:${handle}:${hashIp(clientIp(request))}`;
  if (await isLimited(key, key)) {
    return publicApiError("Too many updates, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const store = roundsStore();
  const state = await store.getByCode(code);
  const memberHandle = state
    ? (await projectRoundView(request, state)).viewerMemberHandle ?? handle
    : handle;
  switch (action) {
    case "join": {
      const result = await store.join(code, memberHandle);
      return result.ok
        ? roundStateResponse(request, result.state)
        : errorResponse(result.error);
    }
    case "addStop": {
      const requestedVenueId = readString(body.venueId) ?? "";
      const venueLookup = await lookupCanonicalVenue(requestedVenueId);
      if (venueLookup.status === "unavailable") {
        return publicApiError("Venue list is unavailable right now, try again shortly.", "UNAVAILABLE", 503, { retryable: true });
      }
      if (venueLookup.status !== "found" || !isPubVenueKind(venueLookup.venue.kind)) {
        return publicApiError("Pick a pub from the map.", "INVALID_REQUEST", 400);
      }
      const result = await store.addStop(code, {
        venueId: venueLookup.canonicalId,
        venueName: venueLookup.venue.name,
        addedByHandle: memberHandle,
        dropRef: body.dropRef,
      });
      return result.ok
        ? roundStateResponse(request, result.state)
        : errorResponse(result.error);
    }
    case "recordSpend":
      return recordSpend(request, code, memberHandle, body);
    case "close": {
      const result = await store.close(code, memberHandle);
      return result.ok
        ? roundStateResponse(request, result.state)
        : errorResponse(result.error);
    }
    default:
      return publicApiError("Unknown action.", "INVALID_REQUEST", 400);
  }
}
