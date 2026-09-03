// GET /api/cron/reconcile-price-trust - retry derived trust events and credits.
//
// Community-price persistence remains authoritative when this derived write is
// unavailable. The durable queue keeps the pair until one bounded run records
// its event and account credits, then acknowledges the exact queue revision.
// AUTH: CRON_SECRET Bearer (lib/cronAuth).

import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { drainPendingPriceTrustReconciliations } from "@/lib/priceTrustImpact.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const RECONCILIATION_BATCH_SIZE = 20;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  try {
    const result = await drainPendingPriceTrustReconciliations(
      RECONCILIATION_BATCH_SIZE,
    );
    if (result.degraded || result.pending > 0) {
      return publicApiError(
        "Price trust reconciliation is still pending.",
        "UNAVAILABLE",
        503,
        {
          retryable: true,
          compatibilityFields: { ok: false, ...result },
        },
      );
    }
    return jsonNoStore({ ok: true, ...result });
  } catch (error) {
    console.error("[cron:reconcile-price-trust] queue drain failed:", error);
    return publicApiError(
      "Price trust reconciliation is unavailable.",
      "UNAVAILABLE",
      503,
      { retryable: true, compatibilityFields: { ok: false } },
    );
  }
}
