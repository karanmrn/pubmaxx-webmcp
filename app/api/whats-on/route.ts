// GET /api/whats-on?kind=&near=lat,lng&limit=
//
// ALWAYS the current London service day. The scope is not a parameter: a bare
// GET used to answer with every future row the bundled files held, which on a
// Sunday meant 384 Wetherspoon weekday food clubs served as tonight. See
// lib/whatsOnHandler.ts for the whole reasoning. `window=tonight` is still
// accepted and still means what it says, so existing callers are unchanged.
//
// Merged baseline + live What's-On rows (Task B1). Read-only over bundled static
// data + a fail-soft CityMCP live layer, so it never needs prod-only guards and
// never 500s: unknown params are dropped (not 400), and any failure lands as
// 200 + { rows: [], error }. Success separates servedAt from honest source
// freshness: { rows, servedAt, sourceObservedAt, sourceFreshnessKind,
// localityBasis, asOf } (asOf is a compatibility alias for sourceObservedAt).
//
// S2: per-IP rate limited (own key, isWhatsOnLimited) — the fail-soft "never
// 500" contract above is unaffected; a 429 is the one allowed exception.

import { readTrustedHandoffFlag } from "@/lib/trustedHandoffFlags.server";
import { loadOutVenueMatchIndex } from "@/lib/out/venueMatch.server";
import { handleWhatsOnRequest } from "@/lib/whatsOnHandler";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  // The single server-owned flag reader (contract 4.1) lives here at the server
  // entry and injects the resolved flag into the handler's store deps. Keeping
  // it here leaves the unit-testable handler/store free of the server-only
  // import that the reader depends on.
  return handleWhatsOnRequest(request, {
    tonightGroupingV2: readTrustedHandoffFlag("tonightGrouping"),
    loadVenueMatchIndex: () => loadOutVenueMatchIndex("london"),
  });
}
