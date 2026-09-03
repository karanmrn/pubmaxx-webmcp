// Community price-submission route - backs the "What's it tonight?" card on the
// venue sheet (VenuePriceSubmit). A submission is a NEW dated observation by a
// drinker standing in the pub, unlike /api/price-confirm which only counts
// vouches for a price that is already displayed. The two are siblings; this one
// is the first time a figure enters the map from the community.
//
//   POST { venueId, drinkCategory, priceGbp }              → { ok, price }
//   POST { kind: "venue-signal", venueId, signalKey, ... } → { ok, signal }
//   POST { action: "report", id, reason? }                 → { ok }
//   GET  ?venueId=<id>                                     → { prices, signals }
//
// The report branch is the public complaint side of the contribution path: it
// FLAGS an observation for a human and hides nothing on its own (a threshold
// auto-hide would be a one-tap eraser for any price a griefer disliked). Only a
// moderator hides, via POST /api/admin/community-prices - and hiding keeps the
// row, exactly like every other moderation path here. It takes an observation
// id of EITHER shape, so a wrong character or step-free answer travels the same
// flag-then-human route as a wrong figure; the ids ride on the read payload.
//
// Both observation shapes carry `corroborations` - how many independent
// submitters back them. It is derived server-side on every read and is never
// accepted from a body. A client that could set it could turn one person's
// report into an established community signal.
//
// Identity is server-derived from the authenticated account's immutable
// profile id. A body handle is ignored. This binds every new contribution to
// one claimed public handle and stops one account stacking corroborations.
//
// Bounds are checked by the SHARED validator (lib/communityPrice.ts) that the
// submit UI also runs, so a rejection reads the same friendly sentence on both
// sides of the wire. Reads are fail-soft (a hiccup degrades to no community
// price, and the sourced baseline still renders); a durable WRITE failure
// answers 503 per the house rule, so the client knows the tap didn't land.
//
// PROVENANCE: this route writes community observations and, on a priced pint
// submission, the paired pint_drops row through lib/oneTapPintDrop.server.ts.
// It never edits the venue dataset or the scraped price CSV - the scraped
// baseline survives every submission and keeps its own dated badge.
// Reads and reader reports remain keyless. New contributions require configured
// authentication plus a completed account profile.

import { publicApiError, publicApiErrorFromStatus } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { deriveCommunityPriceActor } from "@/lib/communityPriceActor";
import {
  NO_ALCOHOL_DRINK_CATEGORIES,
  validateCommunityPrice,
} from "@/lib/communityPrice";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { validateCommunityVenueSignal } from "@/lib/communityVenueSignals";
import { isDrinkCategory } from "@/lib/drinks";
import {
  readCommunityPriceCategoryIndex,
  readCommunityPrices,
  readCommunityPricesWithStatus,
  readCommunityVenueSignals,
  readCommunityVenueSignalsWithStatus,
  readProvisionalCommunityPriceVenueIds,
  reportCommunityPrice,
  submitCommunityPrice,
  submitCommunityVenueSignal,
} from "@/lib/communityPriceStore";
import {
  revertOneTapCommunityPricePairing,
  writeOneTapPintDrop,
} from "@/lib/oneTapPintDrop.server";
import { qualifyCheapPintForOwnerActor } from "@/lib/cheapPintPingQualify.server";
import { parsePriceSubmitPostBody } from "@/lib/priceSubmitPostBody.server";
import { syncTrustAfterPriceWrite } from "@/lib/priceTrustImpact.server";
import { isLimited } from "@/lib/pintDrops";
import { log } from "@/lib/log";
import {
  isUkBaseId,
  MAX_PROVISIONAL_BASE_VENUE_IDS,
} from "@/lib/ukBasePubs";
import { lookupCanonicalVenue } from "@/lib/venueIndex";
import {
  resolveWritableVenueId,
  type VenueWriteTarget,
} from "@/lib/venueWriteTarget.server";
import { readString } from "@/lib/textClean";

/**
 * Per-actor budget for the provisional-base visibility read. One request covers
 * up to MAX_PROVISIONAL_BASE_VENUE_IDS pubs and the client asks only for ids it
 * has not already read, so this covers a long session of panning while still
 * capping what one device can pull out of the store.
 *
 * Sized ABOVE one dense viewport rather than at it: a first arrival over
 * central London can render several hundred base pubs, which is a dozen or so
 * chunks before the client has cached a single id, and the key is a hashed IP -
 * so an office or carrier NAT spends one bucket between every device behind it.
 * A budget that a legitimate arrival can exhaust is a budget that mostly refuses
 * honest readers. The answer carries ids and no figures, so the ceiling here is
 * about store load, not about what a caller could learn.
 */
const PROVISIONAL_BASE_READ_LIMIT = 120;
const PROVISIONAL_BASE_READ_WINDOW_MS = 60_000;

function resolvePubVenueId(venueId: string): Promise<VenueWriteTarget> {
  return resolveWritableVenueId(venueId, { pubsOnly: true });
}

async function communityWriteIsLimited(
  actor: string,
  venueId: string,
): Promise<boolean> {
  const actorLimitKey = `price-submit-actor:${actor}`;
  if (await isLimited(actorLimitKey, actorLimitKey, 30, 3_600_000)) return true;
  const venueLimitKey = `price-submit:${actor}:${venueId}`;
  return isLimited(venueLimitKey, venueLimitKey);
}

export async function POST(request: Request): Promise<Response> {
  const parsedBody = await parsePriceSubmitPostBody(request);
  if (!parsedBody) {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }
  const { fields: body, photos: pintDropPhotos } = parsedBody;

  // Reader flag on an existing observation. Returns before every submission
  // concern below (venue lookup, submission rate limits): a report is not a
  // write of a price, and a reader must be able to complain about a figure even
  // when their own logging budget is spent.
  if (readString(body.action) === "report") {
    const id = readString(body.id);
    if (!id) return publicApiError("Missing report id.", "INVALID_REQUEST", 400);
    // Flood protection only - per-actor uniqueness is durable (the
    // community_price_reports unique pair), so a repeat that outlives this
    // window is an idempotent no-op in the store rather than a second count.
    // The "anon" sentinel exists ONLY for the rate-limit key; the store gets
    // the real (possibly absent) actor so unattributed reports stay insert-only
    // under the durable unique pair instead of collapsing into one shared actor.
    const actor = deriveCommunityPriceActor(request);
    const reporter = actor ?? "anon";
    const REPORT_PER_ACTOR_LIMIT = 1;
    if (
      (await isLimited(`price-report:${id}`, `price-report:${id}`)) ||
      (await isLimited(
        `price-report:${id}:${reporter}`,
        `price-report:${id}:${reporter}`,
        REPORT_PER_ACTOR_LIMIT,
      ))
    ) {
      return publicApiError("Too many reports, slow down.", "RATE_LIMITED", 429, { retryable: true });
    }
    const flagged = await reportCommunityPrice(id, readString(body.reason), actor);
    if (!flagged) {
      return publicApiError("We cannot find that report.", "NOT_FOUND", 404);
    }
    return jsonNoStore({ ok: true }, { status: 200 });
  }

  const contributor = await resolveContributionIdentity(request);
  if (!contributor.ok) {
    return jsonNoStore(contributor.body, { status: contributor.httpStatus });
  }

  if (readString(body.kind) === "venue-signal") {
    const parsed = validateCommunityVenueSignal(body);
    if (!parsed.ok) {
      return publicApiError(parsed.error, "INVALID_REQUEST", 400);
    }
    const resolved = await resolvePubVenueId(parsed.value.venueId);
    if (!resolved.ok) {
      return publicApiErrorFromStatus(resolved.error, resolved.status);
    }
    if (await communityWriteIsLimited(contributor.actor, resolved.venueId)) {
      return publicApiError("Too many logs, slow down.", "RATE_LIMITED", 429, { retryable: true });
    }
    const { signal, failed } = await submitCommunityVenueSignal({
      ...parsed.value,
      venueId: resolved.venueId,
      actor: contributor.actor,
    });
    if (failed || !signal) {
      return publicApiError("Could not log that pub note right now.", "UNAVAILABLE", 503, { retryable: true });
    }
    const rows = await readCommunityVenueSignals(resolved.venueId);
    const record = rows.find(
      (row) =>
        row.signalKey === signal.signalKey &&
        row.signalValue === signal.signalValue,
    );
    const questionRow = rows.find(
      (row) => row.signalKey === signal.signalKey,
    );
    return jsonNoStore(
      {
        ok: true,
        signal:
          record ??
          {
            ...signal,
            corroborations: 1,
            ...(questionRow?.establishedCandidate
              ? { establishedCandidate: questionRow.establishedCandidate }
              : {}),
          },
      },
      { status: 201 },
    );
  }

  // Sanity bounds, category allowlist and venue cleaning all live in the one
  // shared validator - the client's own pre-check is never trusted.
  const result = validateCommunityPrice(body);
  if (!result.ok) {
    return publicApiError(result.error, "INVALID_REQUEST", 400);
  }

  const resolved = await resolvePubVenueId(result.value.venueId);
  if (!resolved.ok) {
    return publicApiErrorFromStatus(resolved.error, resolved.status);
  }
  const submission = { ...result.value, venueId: resolved.venueId };

  // Cap one account across every venue before applying the tighter per-venue
  // budget. The immutable profile id is stable across handle changes and
  // devices, and cannot be reset by clearing browser storage.
  if (await communityWriteIsLimited(contributor.actor, submission.venueId)) {
    return publicApiError("Too many price logs, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // submitCommunityPrice never throws; a hard durable-write failure comes back
  // flagged so we answer 503 (degraded dependency) rather than a fake success.
  const { price, failed } = await submitCommunityPrice({
    ...submission,
    actor: contributor.actor,
    contributorHandle: contributor.handle,
  });
  if (failed || !price) {
    return publicApiError("Could not log that price right now.", "UNAVAILABLE", 503, { retryable: true });
  }

  const pintDrop = await writeOneTapPintDrop(
    {
      venueId: submission.venueId,
      handle: contributor.handle,
      drinkCategory: submission.drinkCategory,
      priceGbp: submission.priceGbp,
      verifiedAccountId: contributor.accountId,
    },
    pintDropPhotos,
  );
  if (!pintDrop.ok) {
    const reverted = await revertOneTapCommunityPricePairing(price.id);
    if (reverted) {
      if (pintDrop.kind === "invalid_photo") {
        return publicApiError(pintDrop.message, "INVALID_REQUEST", 400);
      }
      return publicApiError(pintDrop.message, "UNAVAILABLE", 503, { retryable: true });
    }
    log("error", "one_tap_pint_drop.pairing_repair_required", {
      priceId: price.id,
      venueId: submission.venueId,
      drinkCategory: submission.drinkCategory,
    });
    return publicApiError(
      "Could not finish that price log. Try again later.",
      "PAIRING_REPAIR_REQUIRED",
      503,
      { retryable: true },
    );
  } else {
    void qualifyCheapPintForOwnerActor(contributor.actor);
  }

  const trust = await syncTrustAfterPriceWrite(
    submission.venueId,
    price.drinkCategory,
  );
  // Read the venue back so the response carries this figure's authoritative
  // `corroborations` - the number that decides whether the submitter's tap
  // moves a pin or only lands on the pub's sheet. The client cannot derive it
  // (it never sees other contributors' rows), and counting it in the store's one
  // read path rather than a second time on write keeps a single definition of
  // "how much the community backs this price".
  //
  // Adopted only when the read-back is still THIS submission's figure. When it
  // is not - another contributor holds the freshest row for this drink at a
  // different price, or the read degraded - answering with that row would show
  // the submitter a price they never typed, so we answer with their own at an
  // explicit one voice. A figure that is not even the record for its drink is
  // certainly not driving the map, and stating the 1 beats omitting it and
  // leaving the client to infer the same thing. The category's mapCandidate
  // still rides along on that fallback: dropping it would let this submitter's
  // own map transiently un-paint an already-corroborated figure until the next
  // read. Only when the read-back really produced a row, though - a degraded
  // or empty read stays candidate-less rather than inventing one.
  const categoryRow = (await readCommunityPrices(submission.venueId)).find(
    (row) => row.drinkCategory === price.drinkCategory,
  );
  const record = categoryRow?.priceGbp === price.priceGbp ? categoryRow : undefined;
  return jsonNoStore(
    {
      ok: true,
      attribution: {
        status: "credited",
        handle: contributor.handle,
      },
      trustReconciliation:
        trust.status === "synced" ? "synced" : "pending",
      price:
        record ??
        {
          ...price,
          corroborations: 1,
          ...(categoryRow?.mapCandidate ? { mapCandidate: categoryRow.mapCandidate } : {}),
        },
    },
    { status: 201 },
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    const searchParams = new URL(request.url).searchParams;
    if (searchParams.get("scope") === "provisional-base") {
      const venueIds = searchParams.getAll("venueId");
      if (
        venueIds.length === 0 ||
        venueIds.length > MAX_PROVISIONAL_BASE_VENUE_IDS ||
        venueIds.some((venueId) => !isUkBaseId(venueId))
      ) {
        return publicApiError("Pick pubs from the visible map.", "INVALID_REQUEST", 400);
      }
      // Budget it like every mutating path here. This branch is
      // unauthenticated, answers `no-store` so nothing is shared between
      // callers, and pages the durable store per request - unlike the two GET
      // branches below it, where a venue read is one bounded query and the
      // lens index is process-memoised. Panning the map is the honest caller
      // and it reads only ids it has not seen, so a minute's browsing sits
      // well inside this; a scripted sweep of the country does not.
      const readActor = deriveCommunityPriceActor(request);
      const readLimitKey = `provisional-base:${readActor ?? "anon"}`;
      if (
        await isLimited(
          readLimitKey,
          readLimitKey,
          PROVISIONAL_BASE_READ_LIMIT,
          PROVISIONAL_BASE_READ_WINDOW_MS,
        )
      ) {
        // Name the window rather than making the client guess it. The durable
        // limiter records a hit even when it refuses one, so a caller that
        // retries blind holds its own bucket shut; Retry-After is what lets a
        // panning map stand down for exactly as long as the budget needs.
        return publicApiError("Too many map reads, slow down.", "RATE_LIMITED", 429, {
          retryable: true,
          headers: {
            "Retry-After": String(
              Math.ceil(PROVISIONAL_BASE_READ_WINDOW_MS / 1_000),
            ),
          },
        });
      }
      const result = await readProvisionalCommunityPriceVenueIds(venueIds);
      return jsonNoStore(
        result.degraded
          ? { venueIds: result.venueIds, degraded: true }
          : { venueIds: result.venueIds },
        { status: 200 },
      );
    }
    if (searchParams.get("lens") === "no-alcohol") {
      const result = await readCommunityPriceCategoryIndex(
        NO_ALCOHOL_DRINK_CATEGORIES,
      );
      return jsonNoStore(
        {
          prices: result.prices,
          truncated: result.truncated,
          ...(result.degraded ? { degraded: true } : {}),
        },
        { status: 200 },
      );
    }
    const drinkCategory = searchParams.get("drinkCategory");
    if (isDrinkCategory(drinkCategory)) {
      const result = await readCommunityPriceCategoryIndex([drinkCategory]);
      return jsonNoStore(
        {
          prices: result.prices,
          truncated: result.truncated,
          ...(result.degraded ? { degraded: true } : {}),
        },
        { status: 200 },
      );
    }
    const venueId = (searchParams.get("venueId") ?? "").trim();
    if (!venueId) return jsonNoStore({ prices: [] }, { status: 200 });
    let priceVenueId = venueId;
    if (!isUkBaseId(venueId)) {
      const venueLookup = await lookupCanonicalVenue(venueId);
      if (venueLookup.status !== "found") {
        return jsonNoStore({ prices: [] }, { status: 200 });
      }
      priceVenueId = venueLookup.canonicalId;
    }
    const [result, signalResult] = await Promise.all([
      readCommunityPricesWithStatus(priceVenueId),
      readCommunityVenueSignalsWithStatus(priceVenueId),
    ]);
    const degraded = result.degraded || signalResult.degraded;
    return jsonNoStore(
      degraded
        ? {
            prices: result.prices,
            signals: signalResult.signals,
            degraded: true,
          }
        : { prices: result.prices, signals: signalResult.signals },
      { status: 200 },
    );
  } catch {
    // The reader never 500s. Mark observations unavailable so sourced venue
    // data can still render without turning "could not check" into "none".
    return jsonNoStore(
      { prices: [], signals: [], degraded: true },
      { status: 200 },
    );
  }
}
