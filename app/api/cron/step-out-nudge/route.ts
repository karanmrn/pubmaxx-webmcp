// GET /api/cron/step-out-nudge — weekly Step Out nudge fan-out.
//
// Place-bound, opt-in only. Skips users with nothing owed. Frequency capped
// per subscription (one push / week). AUTH: CRON_SECRET Bearer via
// assertCronRequest. Logs counts only — never subscription endpoints.

import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { dispatchStepOutNudges } from "@/lib/stepOutNudgeDispatch.server";
import { isVapidConfigured } from "@/lib/pushProvider";
import { isSupabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;

  if (!isVapidConfigured()) {
    console.info(
      "[cron:step-out-nudge] not sent: set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.",
    );
    return jsonNoStore({ ok: true, skipped: "vapid_not_configured" }, { status: 200 });
  }
  if (!isSupabaseConfigured()) {
    console.info(
      "[cron:step-out-nudge] not sent: durable store unavailable.",
    );
    return jsonNoStore({ ok: true, skipped: "store_unconfigured" }, { status: 200 });
  }

  const summary = await dispatchStepOutNudges(new Date());
  console.info(
    `[cron:step-out-nudge] considered=${summary.considered} sent=${summary.sent} skippedFrequency=${summary.skippedFrequency} skippedNothingOwed=${summary.skippedNothingOwed} skippedNoAccount=${summary.skippedNoAccount} pruned=${summary.pruned} errors=${summary.errors}`,
  );

  return jsonNoStore({ ok: true, ...summary }, { status: 200 });
}
