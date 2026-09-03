// GET /api/cron/refresh-weather — scheduled weather freshness job.
//
// Vercel cron hits this every 6h (see vercel.json). It fetches fresh Open-Meteo
// readings for every night area (keyless provider — always runs) and persists
// them to the durable weather store, which the read side (tonight-conditions via
// lib/weatherSnapshots.server.ts) reads store-first. On Vercel the committed
// snapshot file is read-only, so this durable write is the ONLY way a scheduled
// function can keep weather fresh.
//
// AUTH: CRON_SECRET Bearer (lib/cronAuth). Directly hittable, so the handler
// re-checks the secret as defence in depth. See docs/CRON_PLANE_RUNBOOK.md.
//
// HONESTY: provider failures degrade loud-but-soft — a per-area drop is skipped
// and reported; a total provider outage persists NOTHING and answers 502 rather
// than faking a snapshot. This route is a mutating-by-effect GET; it is NOT part
// of the public mutating-verb inventory (docs/WRITE_SURFACE_CERTIFICATION.md).

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { assertCronRequest } from "@/lib/cronAuth";
import { fetchNightAreaObservations } from "@/lib/weatherProvider";
import { weatherSnapshotStore } from "@/lib/weatherSnapshotStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 20 keyless provider calls in parallel; generous ceiling for a cold start.
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  let fetched;
  try {
    fetched = await fetchNightAreaObservations();
  } catch (err) {
    console.error("[cron:refresh-weather] provider fetch failed:", err instanceof Error ? err.message : String(err));
    return publicApiError("Weather provider unavailable.", "PROVIDER_UNAVAILABLE", 502, { retryable: true });
  }

  const { observations, skipped } = fetched;

  if (observations.length === 0) {
    // Nothing survived the contract — never persist fake data; report honestly.
    console.error(`[cron:refresh-weather] no valid observations (skipped ${skipped.length}); nothing written.`);
    return publicApiError("No valid weather observations.", "PROVIDER_EMPTY", 502, {
      retryable: true,
      details: { skipped },
    });
  }

  const generatedAt = new Date().toISOString();
  const outcome = await weatherSnapshotStore().writeSnapshot(observations, generatedAt);

  if (outcome.failed) {
    console.error("[cron:refresh-weather] durable write failed: snapshot NOT persisted.");
    return publicApiError("Weather store unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }

  console.log(`[cron:refresh-weather] wrote ${outcome.written} observations at ${generatedAt} (skipped ${skipped.length}).`);
  return jsonNoStore({
    ok: true,
    feed: "weather",
    generatedAt,
    written: outcome.written,
    skipped,
  });
}
