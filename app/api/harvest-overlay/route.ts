// GET /api/harvest-overlay?venueId= — lazy website, menu, and cited lore
// for one OSM-identified venue. Never rides in pin or slim payloads.
// A miss is unknown, not "no history". A failed read is degraded.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { mergePublicHarvestOverlays, toPublicOverlay } from "@/lib/harvestFold";
import { harvestOverlayStore } from "@/lib/harvestOverlayStore";
import { resolveHarvestOverlayVenue } from "@/lib/harvestOverlayVenue";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

export async function GET(request: Request): Promise<Response> {
  const ipHash = hashIp(clientIp(request));
  if (
    (await isLimited(`harvest-overlay:${ipHash}`, `harvest-overlay:${ipHash}`, 120)) ||
    (await isLimited("harvest-overlay:global", "harvest-overlay:global", 1200))
  ) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const venueId = new URL(request.url).searchParams.get("venueId")?.trim() ?? "";
  if (!venueId) {
    return publicApiError("Add a venue id.", "INVALID_REQUEST", 400);
  }

  try {
    const resolution = await resolveHarvestOverlayVenue(venueId);
    if (resolution.status === "unavailable") {
      return jsonNoStore({ status: "degraded", overlay: null }, { status: 200 });
    }
    const reads =
      resolution.status === "resolved"
        ? await Promise.all(
            resolution.venueIds.map((osmId) =>
              harvestOverlayStore().getByVenueId(osmId),
            ),
          )
        : [{ status: "ready" as const, overlay: null }];
    if (reads.some((read) => read.status === "degraded")) {
      return jsonNoStore({ status: "degraded", overlay: null }, { status: 200 });
    }
    const publicOverlays = reads.flatMap((read) =>
      read.status === "ready" && read.overlay ? [toPublicOverlay(read.overlay)] : [],
    );
    const overlay = mergePublicHarvestOverlays(publicOverlays);
    if (!overlay.website && !overlay.menuUrl && !overlay.lore) {
      return Response.json(
        { status: "ready", overlay: null },
        { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
      );
    }
    return Response.json(
      {
        status: "ready",
        overlay,
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch {
    return jsonNoStore({ status: "degraded", overlay: null }, { status: 200 });
  }
}
