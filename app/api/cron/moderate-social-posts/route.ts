import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { assertCronRequest } from "@/lib/cronAuth";
import { notifySocialModerationFindings } from "@/lib/socialModerationNotify";
import {
  isOpenAISocialModerationConfigured,
  OpenAISocialPostModerationAdapter,
} from "@/lib/socialPostModeration";
import { socialPostStore } from "@/lib/socialPostStore";
import {
  isSocialFriendsLaunchEnabled,
  SOCIAL_FRIENDS_LAUNCH_ENV,
} from "@/lib/socialLaunch";
import { thrownMessage } from "@/lib/thrownMessage";
import { purgeDetachedSocialPhotos } from "@/lib/socialPostMedia.server";

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
    const action = new URL(request.url).searchParams.get("action");
    if (action === "requeue-terminal") {
      const requeued = await socialPostStore().requeueTerminalModeration(20);
      return jsonNoStore({ ok: true, requeued });
    }
    if (action === "purge-detached-media") {
      const purged = await purgeDetachedSocialPhotos(50);
      return jsonNoStore({ ok: true, purged });
    }
    if (action === "inspect-backlog") {
      // Operator read of stranded/growing pending without claiming jobs.
      const backlog = await socialPostStore().inspectModerationBacklog();
      const findings = await notifySocialModerationFindings(backlog);
      return jsonNoStore({ ok: true, backlog, ...findings });
    }
    if (action !== null) {
      return publicApiError("Unknown moderation action.", "INVALID_REQUEST", 400, {
        compatibilityFields: { ok: false },
      });
    }
    const store = socialPostStore();
    if (!isOpenAISocialModerationConfigured()) {
      console.warn(
        "[cron:moderate-social-posts] OPENAI_API_KEY absent: moderation queue skipped.",
      );
      const skippedBacklog = await store.inspectModerationBacklog();
      const skippedFindings = await notifySocialModerationFindings(skippedBacklog);
      return jsonNoStore({
        ok: true,
        skipped: "openai_not_configured",
        backlog: skippedBacklog,
        ...skippedFindings,
      });
    }
    const result = await store.processModerationQueue(
      new OpenAISocialPostModerationAdapter(),
      20,
    );
    // After every drain: a growing pending backlog or exhausted retries is its
    // own named finding. An outage must never read as "nothing to review".
    const backlog = await store.inspectModerationBacklog();
    const findings = await notifySocialModerationFindings(backlog, result);
    if (result.processed === 0 && backlog.pending === 0) {
      return jsonNoStore({ ok: true, skipped: "queue_empty", ...result, backlog, ...findings });
    }
    return jsonNoStore({ ok: true, ...result, backlog, ...findings });
  } catch (error) {
    console.error("[cron:moderate-social-posts] queue drain failed:", thrownMessage(error));
    return publicApiError("Social post moderation queue is unavailable.", "UNAVAILABLE", 503, {
      retryable: true,
      compatibilityFields: { ok: false },
    });
  }
}
