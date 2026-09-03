// GET /api/cron/refresh-night-signals — scheduled Night Signal candidate sweep.
//
// The EXA candidate ingestion (scripts/ingest_night_signal_candidates.mjs) was
// stranded on the retired GitHub Actions runner. EXA_API_KEY is now present in
// Vercel, so this cron runs the SAME tested sweep in a function: it queries Exa
// for recent, dated, attributable London pub buzz and returns PENDING candidates,
// then stamps an honest freshness observation so /api/freshness and the
// freshness-audit see that candidate ingestion is running.
//
// HONEST SCOPE (mirrors refresh-whats-on): a serverless function cannot own the
// git-PR human-review flow the script uses to STAGE candidates for approval, nor
// write the committed reviewed snapshot. So this cron NEVER publishes and NEVER
// advances the reviewed `night_signals` feed — every candidate stays PENDING and
// human review still gates what ships. Durable candidate persistence + a
// store-based review surface are the follow-up (see docs/CRON_PLANE_RUNBOOK.md).
//
// AUTH: CRON_SECRET Bearer (lib/cronAuth). Mutating-by-effect GET; not part of the
// public mutating-verb inventory (docs/WRITE_SURFACE_CERTIFICATION.md).

import { jsonNoStore } from "@/lib/apiResponses";
import { publicApiError } from "@/lib/apiError";
import { assertCronRequest } from "@/lib/cronAuth";
import { feedFreshnessStore } from "@/lib/feedFreshnessStore";
import { NIGHT_SIGNAL_CANDIDATES_FEED_KEY } from "@/lib/freshnessStoreOverlay";
import { ingestNightSignalCandidates } from "@/lib/nightSignalIngest.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// 3 Exa queries in series; a full sweep is bounded well under this ceiling.
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  let result;
  try {
    result = await ingestNightSignalCandidates();
  } catch (err) {
    console.error(
      "[cron:refresh-night-signals][night-signals][ALERT] Exa ingestion failed:",
      err instanceof Error ? err.message : String(err),
    );
    return publicApiError("Night Signal provider unavailable.", "PROVIDER_UNAVAILABLE", 502, { retryable: true });
  }

  if (result.status === "skipped") {
    // Documented keyless default: safe no-op, never a fake stamp.
    console.warn("[cron:refresh-night-signals] EXA_API_KEY absent: candidate ingestion skipped (safe no-op).");
    return jsonNoStore({ ok: true, feed: "night_signal_candidates", skipped: "no-exa-key", staged: 0 });
  }

  const observedAt = new Date().toISOString();
  const outcome = await feedFreshnessStore().stamp({
    feed: NIGHT_SIGNAL_CANDIDATES_FEED_KEY,
    observedAt,
    rowsServed: result.candidates.length,
    note: `${result.candidates.length} pending candidate(s) swept (awaiting human review)`,
  });
  if (outcome.failed) {
    console.error(
      "[cron:refresh-night-signals][night-signals][ALERT] freshness stamp failed: ingestion ran but freshness NOT recorded.",
    );
    return publicApiError("Night Signal freshness store unavailable.", "STORE_UNAVAILABLE", 503, { retryable: true });
  }

  console.log(`[cron:refresh-night-signals] swept ${result.candidates.length} pending candidate(s) at ${observedAt}.`);
  return jsonNoStore({
    ok: true,
    feed: "night_signal_candidates",
    observedAt,
    staged: result.candidates.length,
    // PENDING only — never published; human review still gates the reviewed feed.
    candidates: result.candidates,
  });
}
