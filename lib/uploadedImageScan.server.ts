import "server-only";

// ONE scan policy for every owned-image surface: the avatar, the cover, a pub
// wall photo and a photo sent in a message all ask this module the same
// question about the same bytes.
//
// The scan is ADVISORY. A verdict this reaches is honoured - a refusal still
// refuses, and refused bytes never reach a serving key. But a scan that cannot
// RUN is not a verdict about the image: no provider key, no adapter, a provider
// outage, a model that answers nothing, or no signed URL to hand it are all
// facts about us rather than about the photo. The upload proceeds, and the skip
// is logged once with its reason so an operator can see the safety net is down.
//
// This replaced a fail-closed gate that answered 503 on any of those, which
// meant a broken provider blocked every upload on the site. The report/hide
// moderator lane is the safety net that stays.
//
// It lives beside `lib/uploadedImage.server.ts` for the reason that module
// exists: four surfaces, one journey, and the thing that must not drift here
// is which failures count as a verdict.

import { log } from "@/lib/log";
import type { ProfileAvatarModerationAdapter } from "@/lib/profileAvatarModeration";

/** Which owned-image surface asked. Log-only; nothing branches on it. */
export type UploadedImageScanSurface =
  | "profile-avatar"
  | "profile-cover"
  | "venue-photo"
  | "message-photo";

/** Why a scan produced no verdict. Every one of these lets the upload through. */
export type UploadedImageScanSkipReason =
  | "no_signed_url"
  | "adapter_unavailable"
  | "scan_failed"
  | "no_decision";

export type UploadedImageScanResult =
  | { verdict: "approved" }
  | { verdict: "refused" }
  | { verdict: "skipped"; reason: UploadedImageScanSkipReason };

function skip(
  surface: UploadedImageScanSurface,
  reason: UploadedImageScanSkipReason,
  detail?: unknown,
): UploadedImageScanResult {
  // One quiet line, naming the surface and why. `warn` rather than `error`: the
  // upload is fine, the safety net is not.
  log("warn", "uploaded_image.scan_skipped", {
    surface,
    reason,
    ...(detail === undefined
      ? {}
      : { detail: detail instanceof Error ? detail.message : String(detail) }),
  });
  return { verdict: "skipped", reason };
}

/**
 * Run the safety scan over one staged image and say what it decided.
 *
 * `approved` and `refused` are the adapter's own verdicts. `skipped` means the
 * scan never reached a verdict, and the caller promotes the image anyway.
 */
export async function scanUploadedImage(options: {
  surface: UploadedImageScanSurface;
  /** Short-lived signed URL for the staged bytes; null when signing failed. */
  signedUrl: string | null;
  adapter: () => ProfileAvatarModerationAdapter;
}): Promise<UploadedImageScanResult> {
  const { surface, signedUrl, adapter } = options;

  if (!signedUrl) return skip(surface, "no_signed_url");

  let scanner: ProfileAvatarModerationAdapter;
  try {
    scanner = adapter();
  } catch (error) {
    // Missing key, unconfigured provider, anything a constructor threw.
    return skip(surface, "adapter_unavailable", error);
  }

  let decision: unknown;
  try {
    ({ decision } = await scanner.moderate(signedUrl));
  } catch (error) {
    return skip(surface, "scan_failed", error);
  }

  if (decision === "approved") return { verdict: "approved" };
  if (decision === "needs_review") return { verdict: "refused" };
  // An adapter that answered something outside its own contract said nothing
  // about the image, so it is a skip rather than a refusal.
  return skip(surface, "no_decision", String(decision));
}
