// Price-confirm micro-contribution route — backs the "Still £4.20?" chip on the
// venue sheet (VenuePriceStory). A confirm is a one-tap community signal that an
// already-displayed price is still right; it is NOT a new price. See
// lib/priceConfirmStore.ts for the honest, keyless, fail-soft store behind it.
//
//   POST { venueId, priceGbp }            → { ok: true, confirms, lastConfirmedAt }
//   GET  ?venueId=<id>&priceGbp=<number>  → { confirms, lastConfirmedAt }
//
// Identity is server-derived (hashActor of the hashed client IP), never trusted
// from the body — one device de-duplicates to one confirm per (venue, price), so
// the tally stays an honest count of distinct confirmers. Reads are fail-soft
// (a hiccup degrades to a zero tally); a durable WRITE failure answers 503 per
// the house rule, so the client knows the tap didn't land. No Supabase and no
// env are required.

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { isLimited } from "@/lib/pintDrops";
import { confirmPrice, readPriceConfirm } from "@/lib/priceConfirmStore";
import { clientIp, hashActor, hashIp } from "@/lib/supabase";

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// Best-effort, server-derived confirmer token. Never throws — if IP hashing is
// unavailable the store falls back to a per-call token (still counts, just can't
// de-dupe that tap).
function deriveActor(request: Request): string | undefined {
  try {
    return hashActor(`price-confirm:${hashIp(clientIp(request))}`);
  } catch {
    return undefined;
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return publicApiError("Malformed request body.", "MALFORMED_REQUEST", 400);
  }

  const venueId = typeof body.venueId === "string" ? body.venueId.trim() : "";
  const priceGbp = readNumber(body.priceGbp);
  if (!venueId) return publicApiError("Choose a venue.", "INVALID_REQUEST", 400);
  if (priceGbp === null || priceGbp <= 0) {
    return publicApiError("Add a valid price.", "INVALID_REQUEST", 400);
  }

  const actor = deriveActor(request);

  // Rate-limit the tap so one device can't spam confirms; keyed on the derived
  // actor + venue (falls back to venue alone if the actor couldn't be derived).
  const limitKey = `price-confirm:${actor ?? "anon"}:${venueId}`;
  if (await isLimited(limitKey, limitKey)) {
    return publicApiError("Too many confirmations, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  // confirmPrice never throws; a hard durable-write failure comes back flagged
  // so we answer 503 (degraded dependency) rather than a fake success.
  const { failed, ...result } = await confirmPrice({ venueId, priceGbp, actor });
  if (failed) {
    return publicApiError("Could not record the confirmation right now.", "UNAVAILABLE", 503, { retryable: true });
  }
  return jsonNoStore({ ok: true, ...result }, { status: 200 });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const venueId = (params.get("venueId") ?? "").trim();
    const priceGbp = readNumber(params.get("priceGbp"));
    if (!venueId || priceGbp === null) {
      return jsonNoStore({ confirms: 0, lastConfirmedAt: null, recentConfirms: 0 }, { status: 200 });
    }
    return jsonNoStore(await readPriceConfirm({ venueId, priceGbp }), { status: 200 });
  } catch {
    // The reader never 500s — degrade to a zero tally.
    return jsonNoStore({ confirms: 0, lastConfirmedAt: null, recentConfirms: 0 }, { status: 200 });
  }
}
