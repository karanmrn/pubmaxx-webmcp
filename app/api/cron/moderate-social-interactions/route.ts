import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { socialInteractionStore } from "@/lib/socialInteractionStore";
import {
  isOpenAISocialModerationConfigured,
  OpenAISocialPostModerationAdapter,
} from "@/lib/socialPostModeration";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
} from "@/lib/socialLaunch";
import { thrownMessage } from "@/lib/thrownMessage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(request: Request): Promise<Response> {
  const denied = assertCronRequest(request);
  if (denied) return denied;
  if (!isSocialFriendsLaunchEnabled(process.env[SOCIAL_FRIENDS_LAUNCH_ENV])) {
    return jsonNoStore({ ok: true, skipped: "social_rollback" });
  }
  try {
    if (!isOpenAISocialModerationConfigured()) {
      console.warn(
        "[cron:moderate-social-interactions] OPENAI_API_KEY absent: moderation queue skipped.",
      );
      return jsonNoStore({ ok: true, skipped: "openai_not_configured" });
    }
    const result = await socialInteractionStore().processModerationQueue(
      new OpenAISocialPostModerationAdapter(),
      20,
    );
    if (result.processed === 0) {
      // A claim leases nothing when the queue is empty AND when every held job
      // is in backoff or has exhausted its retries. This lane has no backlog
      // inspector, so it may not call that "queue empty".
      return jsonNoStore({ ok: true, skipped: "no_jobs_claimed", ...result });
    }
    return jsonNoStore({ ok: true, ...result });
  } catch (error) {
    console.error(
      "[cron:moderate-social-interactions] queue drain failed:",
      thrownMessage(error),
    );
    return publicApiError("Social interaction moderation is unavailable.", "UNAVAILABLE", 503, {
      retryable: true,
      compatibilityFields: { ok: false },
    });
  }
}
