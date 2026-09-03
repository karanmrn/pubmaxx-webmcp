// Wanted Wave A — private list + create / delete / fulfil.
//
//   GET                           → 200 { status, wanteds } (owner only)
//   GET ?open=1                   → 200 { status, wanteds } open only
//   POST { venueId, venueName, venueKind?, sourceUrl?, note?, rawPaste? }
//                                 → 201 { wanted }
//   POST { action: "pending", rawPaste, sourceUrl?, note? }
//                                 → 201 { wanted } (unresolvable paste)
//   POST { action: "fulfil", venueId }
//                                 → 200 { fulfilled: WantedDTO[] }
//   POST { action: "delete", id } → 200 { ok: true }
//
// Auth-gated via resolveContributionIdentity. Rate-limited. publicApiError
// envelope. Never returns another account's Wanteds. No viewer coordinates.

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { log } from "@/lib/log";
import { isLimited } from "@/lib/pintDrops";
import { isListTypeEligibleForVenue } from "@/lib/savedListPolicy";
import { savedListPath } from "@/lib/savedListUrl";
import {
  cleanListType,
  savedListsStore,
} from "@/lib/savedPubsStore";
import { clientIp, hashIp } from "@/lib/supabase";
import { readString } from "@/lib/textClean";
import { validateWantedCreate } from "@/lib/wanted";
import { fulfilWantedsAtVenue } from "@/lib/wantedFulfil.server";
import { wantedStore } from "@/lib/wantedStore";
import { promoteWantedToSavedList } from "@/lib/wantedPromotion.server";
import { resolveVenue } from "@/lib/venueIndex";
import { isPubVenueKind } from "@/lib/venueKindFilters";

export const runtime = "nodejs";

const CREATE_WINDOW_MS = 60_000;

function profileIdFromActor(actor: string): string {
  return actor.startsWith("profile:") ? actor.slice("profile:".length).trim() : "";
}

async function parseJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function requireOwner(request: Request) {
  const contributor = await resolveContributionIdentity(request);
  if (!contributor.ok) {
    return { ok: false as const, response: jsonNoStore(contributor.body, { status: contributor.httpStatus }) };
  }
  return { ok: true as const, contributor };
}

async function handlePromotion(
  body: Record<string, unknown>,
  owner: { actor: string; handle: string },
): Promise<Response> {
  const id = readString(body.id);
  const listType = cleanListType(body.listType);
  if (!id) return publicApiError("Wanted place not found.", "NOT_FOUND", 404);
  if (!listType) return publicApiError("Add a list name.", "INVALID_REQUEST", 400);

  const wanted = await wantedStore().getById(owner.actor, id);
  if (!wanted) return publicApiError("Wanted place not found.", "NOT_FOUND", 404);
  if (wanted.status !== "open" || wanted.venueKind !== "curated" || !wanted.venueId) {
    return publicApiError(
      "Only an open matched pub can join a public list.",
      "WANTED_NOT_PROMOTABLE",
      409,
    );
  }
  if (wanted.promotedListType && wanted.promotedListType !== listType) {
    return publicApiError(
      "This Wanted place is already on a public list.",
      "WANTED_ALREADY_PROMOTED",
      409,
    );
  }

  const venue = await resolveVenue(wanted.venueId);
  if (!venue || !isPubVenueKind(venue.kind)) {
    return publicApiError(
      "Match this Wanted place to a current pub first.",
      "WANTED_NOT_PROMOTABLE",
      409,
    );
  }
  if (!isListTypeEligibleForVenue(listType, venue.kind)) {
    return publicApiError("Choose a list that matches this venue.", "INVALID_REQUEST", 400);
  }

  const profileId = profileIdFromActor(owner.actor);
  if (!profileId) {
    return publicApiError(
      "Your public profile is unavailable right now.",
      "IDENTITY_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }
  const result = await promoteWantedToSavedList({
    ownerActor: owner.actor,
    profileId,
    handle: owner.handle,
    wantedId: wanted.id,
    venueId: wanted.venueId,
    listType,
  });
  if (result.status === "not_found") {
    return publicApiError("Wanted place not found.", "NOT_FOUND", 404);
  }
  if (result.status === "not_promotable") {
    return publicApiError(
      "Only an open matched pub can join a public list.",
      "WANTED_NOT_PROMOTABLE",
      409,
    );
  }
  if (result.status === "already_promoted") {
    return publicApiError(
      "This Wanted place is already on a public list.",
      "WANTED_ALREADY_PROMOTED",
      409,
    );
  }
  if (
    result.status !== "saved"
    && result.status !== "already_saved"
  ) {
    return publicApiError(
      "Could not add this pub to your list. Try again.",
      "STORE_UNAVAILABLE",
      503,
      { retryable: true },
    );
  }

  await savedListsStore().createList(owner.handle, listType);
  return jsonNoStore({
    outcome: result.status,
    venueId: wanted.venueId,
    listType,
    listUrl: savedListPath(owner.handle, listType),
    wanted: {
      ...wanted,
      promotedListType: result.promotedListType,
      promotedAt: result.promotedAt,
    },
  }, { status: 200 });
}

export async function GET(request: Request): Promise<Response> {
  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;

  const openOnly = new URL(request.url).searchParams.get("open") === "1";
  try {
    const result = openOnly
      ? await wantedStore().listOpenForOwner(owner.contributor.actor)
      : await wantedStore().listForOwner(owner.contributor.actor);
    return jsonNoStore(result, { status: 200 });
  } catch (err) {
    log("error", "wanteds.list_failed", {
      route: "GET /api/wanted",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}

export async function POST(request: Request): Promise<Response> {
  const body = await parseJson(request);
  if (!body) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const owner = await requireOwner(request);
  if (!owner.ok) return owner.response;

  const ipHash = hashIp(clientIp(request));
  const key = `wanted:${owner.contributor.actor}:${ipHash}`;
  if (await isLimited(key, key, undefined, CREATE_WINDOW_MS)) {
    return publicApiError("Too many submissions, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  const action = readString(body.action);

  if (action === "promote") {
    return handlePromotion(body, owner.contributor);
  }

  if (action === "fulfil") {
    const venueId = readString(body.venueId);
    if (!venueId) {
      return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);
    }
    const fulfilled = await fulfilWantedsAtVenue(owner.contributor.actor, venueId);
    return jsonNoStore({ fulfilled }, { status: 200 });
  }

  if (action === "delete") {
    const id = readString(body.id);
    if (!id) {
      return publicApiError("Wanted place not found.", "NOT_FOUND", 404);
    }
    try {
      const done = await wantedStore().delete(owner.contributor.actor, id);
      return done
        ? jsonNoStore({ ok: true }, { status: 200 })
        : publicApiError("Wanted place not found.", "NOT_FOUND", 404);
    } catch (err) {
      log("error", "wanteds.delete_failed", {
        route: "POST /api/wanted",
        error: err instanceof Error ? err.message : String(err),
      });
      return publicApiError("Storage is unavailable.", "STORE_UNAVAILABLE", 503, {
        retryable: true,
      });
    }
  }

  const pending = action === "pending";
  const result = validateWantedCreate({
    ownerActor: owner.contributor.actor,
    venueKind: pending ? "pending" : body.venueKind,
    venueId: pending ? "" : body.venueId,
    venueName: pending ? "" : body.venueName,
    sourceUrl: body.sourceUrl,
    note: body.note,
    rawPaste: body.rawPaste ?? body.paste,
  });
  if (!result.ok) {
    return publicApiError(result.error, "INVALID_WANTED", 400);
  }

  try {
    const wanted = await wantedStore().create(result.value);
    return jsonNoStore({ wanted }, { status: 201 });
  } catch (err) {
    log("error", "wanteds.create_failed", {
      route: "POST /api/wanted",
      error: err instanceof Error ? err.message : String(err),
    });
    return publicApiError("Storage is unavailable. Try again shortly.", "STORE_UNAVAILABLE", 503, {
      retryable: true,
    });
  }
}
