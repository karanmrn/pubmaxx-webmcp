// Bounded, authenticated price-evidence mission read.
//
// GET ?venueId=...&venueId=...  → { status: ready|degraded, mission }
//
// Signed-in Pubmaxxers only. The caller already ranked the Venue IDs
// (Near or the selected Map sheet). This route never takes coordinates.
// A failed store read is `degraded`, never an empty-market claim.

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { resolveContributionIdentity } from "@/lib/contributionIdentity.server";
import { readCommunityPricesWithStatus } from "@/lib/communityPriceStore";
import { isLimited } from "@/lib/pintDrops";
import {
  parsePriceEvidenceMissionVenueIds,
  rankPriceEvidenceMission,
  toPriceEvidenceMissionDto,
  type VenueMissionRows,
} from "@/lib/priceEvidenceMissions";
import { hashIp, clientIp } from "@/lib/supabase";

export const runtime = "nodejs";

const READ_LIMIT = 60;
const READ_WINDOW_MS = 60_000;

export async function GET(request: Request): Promise<Response> {
  const contributor = await resolveContributionIdentity(request);
  if (!contributor.ok) {
    return jsonNoStore(contributor.body, { status: contributor.httpStatus });
  }

  const limitKey = `price-missions:${contributor.actor}:${hashIp(clientIp(request))}`;
  if (await isLimited(limitKey, limitKey, READ_LIMIT, READ_WINDOW_MS)) {
    return publicApiError("Too many reads, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const parsed = parsePriceEvidenceMissionVenueIds(
    new URL(request.url).searchParams.getAll("venueId"),
  );
  if (!parsed.ok) {
    return publicApiError(
      "Provide one to eight Venue IDs.",
      "INVALID_REQUEST",
      400,
    );
  }

  const now = Date.now();
  const rows: VenueMissionRows[] = await Promise.all(
    parsed.venueIds.map(async (venueId) => {
      const read = await readCommunityPricesWithStatus(venueId, now);
      return { venueId, prices: read.prices, degraded: read.degraded };
    }),
  );
  const degraded = rows.some((row) => row.degraded);
  const ranked = rankPriceEvidenceMission(rows, now);
  return jsonNoStore({
    status: degraded ? "degraded" : "ready",
    mission: ranked ? toPriceEvidenceMissionDto(ranked) : null,
  });
}
