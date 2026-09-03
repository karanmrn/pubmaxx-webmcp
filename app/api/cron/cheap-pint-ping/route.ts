// GET /api/cron/cheap-pint-ping — weekday 5pm cheap-pint ping fan-out.
//
// One lifetime push per opted-in account with a grounded listed price.
// AUTH: CRON_SECRET Bearer via assertCronRequest.

import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { dispatchCheapPintPings } from "@/lib/cheapPintPingDispatch.server";
import { isCheapPintPingWindow } from "@/lib/cheapPintPing";
import { isVapidConfigured } from "@/lib/pushProvider";
import { isSupabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  const now = new Date();

  if (!isCheapPintPingWindow(now)) {
    return jsonNoStore({ ok: true, skipped: "outside_send_window" }, { status: 200 });
  }

  if (!isVapidConfigured()) {
    console.info(
      "[cron:cheap-pint-ping] not sent: set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.",
    );
    return jsonNoStore({ ok: true, skipped: "vapid_not_configured" }, { status: 200 });
  }
  if (!isSupabaseConfigured()) {
    console.info("[cron:cheap-pint-ping] not sent: durable store unavailable.");
    return jsonNoStore({ ok: true, skipped: "store_unconfigured" }, { status: 200 });
  }

  const summary = await dispatchCheapPintPings(now);
  console.info(
    `[cron:cheap-pint-ping] considered=${summary.considered} sent=${summary.sent} skippedNotReady=${summary.skippedNotReady} skippedNoGroundedPint=${summary.skippedNoGroundedPint} skippedNoAccount=${summary.skippedNoAccount} pruned=${summary.pruned} errors=${summary.errors}`,
  );

  return jsonNoStore({ ok: true, ...summary }, { status: 200 });
}
