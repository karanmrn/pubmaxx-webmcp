import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isWhatsOnLimited } from "@/lib/citymcpRateLimit";
import { coarsenViewerPoint } from "@/lib/geo";
import type { OutVenueMatchIndex } from "@/lib/out/venueMatch";
import { isWhatsOnKind, type WhatsOnKind, type WhatsOnKindObservedAt } from "@/lib/whatsOn";
import {
  loadWhatsOn,
  type LoadWhatsOnDeps,
  type LoadWhatsOnParams,
  type WhatsOnLocalityBasis,
  type WhatsOnSourceFreshnessKind,
} from "@/lib/whatsOnStore";
import type { WhatsOnRow } from "@/lib/whatsOn";

const MAX_LIMIT = 100;

export type WhatsOnResponse = {
  rows: WhatsOnRow[];
  servedAt: string;
  sourceObservedAt: string | null;
  sourceFreshnessKind: WhatsOnSourceFreshnessKind;
  /** Freshest confirmation per kind, so a single-source lane dates itself from
   *  its OWN source rather than borrowing the freshest thing on the page. */
  kindObservedAt: WhatsOnKindObservedAt;
  localityBasis: WhatsOnLocalityBasis;
  /** Compatibility alias for pre-L15 clients; always equals sourceObservedAt. */
  asOf: string | null;
};

export type WhatsOnHandlerDeps = LoadWhatsOnDeps & {
  loadVenueMatchIndex?: () => Promise<OutVenueMatchIndex | null>;
};

function parseKind(raw: string | null): WhatsOnKind | undefined {
  if (!raw) return undefined;
  const v = raw.trim().toLowerCase();
  return isWhatsOnKind(v) ? v : undefined; // unknown kind dropped, not 400
}

function parseLimit(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.min(n, MAX_LIMIT);
}

function parseNear(raw: string | null): { lat: number; lng: number } | undefined {
  if (!raw) return undefined;
  const parts = raw.split(",").map((s) => Number.parseFloat(s.trim()));
  if (parts.length !== 2) return undefined;
  const [lat, lng] = parts;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return undefined;
  return coarsenViewerPoint({ lat, lng });
}

// Handler with injectable store deps.
export async function handleWhatsOnRequest(
  request: Request,
  deps: WhatsOnHandlerDeps = {},
): Promise<Response> {
  try {
    // Own key/budget (lib/citymcpRateLimit.ts): whats-on is partly served from
    // bundled data, so it must not share (and prematurely exhaust) the CityMCP
    // proxy surface's budget. A 429 here is an allowed exception to the "never
    // 500" fail-soft contract described above — upstream failures still 200.
    // Keep the limiter inside this boundary: a keyless or unavailable limiter
    // is a failed dependency, not a reason for this read to escape as 500.
    if (await isWhatsOnLimited(request)) {
      return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true, compatibilityFields: { rows: [] } });
    }

    const params = new URL(request.url).searchParams;
    const load: LoadWhatsOnParams = {};
    const kind = parseKind(params.get("kind"));
    if (kind) load.kind = kind;
    // THIS ROUTE SERVES ONE NIGHT, and it is the one happening now.
    //
    // The window used to be opt-in, so a bare GET answered with every future
    // row the bundled files held. On Sunday 30 August 2026 that was 384
    // Wetherspoon weekday food clubs and 244 KB - Tuesday burgers, served as
    // what is on tonight, on a night this same read had nothing for. Every
    // in-app caller already asked for `tonight`; the only reader getting the
    // whole horizon was the one nobody wrote, and it was the dishonest answer.
    //
    // So the service day is the DEFAULT scope. `londonServiceDayBounds` owns
    // where a night starts and ends, and an unrecognised `window` lands here
    // too, the same way an unknown `kind` is dropped rather than 400ed. A night
    // with nothing on it answers with nothing, which is the honest empty, and a
    // kind with no rows tonight is simply absent rather than advertised.
    //
    // A caller that genuinely wants another day asks the store directly rather
    // than this route: Pub Pal's what's-on tool keeps its weekday lane that way
    // (lib/ask/tools.ts), so nothing here narrows a question somebody asked.
    load.window = "tonight";
    const near = parseNear(params.get("near"));
    if (near) load.near = near;
    const limit = parseLimit(params.get("limit"));
    if (limit) load.limit = limit;
    if (params.get("pubOnly") === "1") {
      try {
        const venueMatchIndex = await deps.loadVenueMatchIndex?.();
        if (!venueMatchIndex) {
          return jsonNoStore({ rows: [], error: "Could not check listings." });
        }
        load.pubOnly = true;
        load.venueMatchIndex = venueMatchIndex;
      } catch {
        return jsonNoStore({ rows: [], error: "Could not check listings." });
      }
    }

    // The tonightGrouping V2 flag arrives via deps (the server route reads the
    // canonical registry and injects it — the flag reader depends on server-only,
    // which unit tests cannot resolve). Absent dep means safe off.
    const result = await loadWhatsOn(load, deps);
    const response: WhatsOnResponse = {
      rows: result.rows,
      servedAt: result.servedAt,
      sourceObservedAt: result.sourceObservedAt,
      sourceFreshnessKind: result.sourceFreshnessKind,
      kindObservedAt: result.kindObservedAt,
      localityBasis: result.localityBasis,
      asOf: result.sourceObservedAt,
    };
    // A bundled read that could not answer is not a quiet night. The client
    // already treats a named `error` as status "error", distinct from empty.
    if (result.readStatus === "degraded") {
      return jsonNoStore({ ...response, error: "Could not check listings." });
    }
    return jsonNoStore(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "What's-On request failed";
    return jsonNoStore({ rows: [], error: message });
  }
}
