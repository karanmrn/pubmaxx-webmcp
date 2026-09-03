import { NextResponse } from "next/server";

import { publicApiError } from "@/lib/apiError";
import {
  NEAR_PRICE_TRUST_COLLECTED_DATE,
  resolveNearPriceTrust,
  type NearPriceTrustItem,
  type NearPriceTrustResponse,
} from "@/lib/nearPriceTrust";
import { isVenueDetailId, lookupVenueDetail } from "@/lib/venueDetailIndex";

const MAX_VENUE_IDS = 5;
const NO_STORE = "private, max-age=0, no-store";

function json(body: NearPriceTrustResponse, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": NO_STORE },
  });
}

function badRequest(): Response {
  return publicApiError(
    "Provide one to five valid Venue IDs.",
    "INVALID_REQUEST",
    400,
    { headers: { "Cache-Control": NO_STORE } },
  );
}

export async function GET(request: Request): Promise<Response> {
  const rawIds = new URL(request.url).searchParams.getAll("venueId");
  if (rawIds.length === 0 || rawIds.length > MAX_VENUE_IDS) return badRequest();
  const ids = [...new Set(rawIds.map((id) => id.trim()))];
  if (ids.some((id) => !isVenueDetailId(id))) return badRequest();

  const reads = await Promise.allSettled(ids.map((id) => lookupVenueDetail(id)));
  const results: NearPriceTrustItem[] = [];
  let degraded = false;
  for (const read of reads) {
    if (read.status === "rejected") {
      degraded = true;
      continue;
    }
    if (read.value.status === "unavailable") {
      degraded = true;
      continue;
    }
    if (read.value.status === "missing") continue;
    const evidence = resolveNearPriceTrust(read.value.venue);
    if (evidence) results.push(evidence);
  }
  return json({
    status: degraded ? "degraded" : "ready",
    collectedAt: NEAR_PRICE_TRUST_COLLECTED_DATE,
    results,
  });
}
