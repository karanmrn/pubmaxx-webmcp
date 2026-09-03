import "server-only";

import { createHash } from "node:crypto";

import type { SocialPostCommentPolicy, SocialPostDTO, SocialPostVisibility } from "@/lib/socialPosts";

export const SOCIAL_DESIRED_INTERACTIONS = ["cheer", "save", "repost"] as const;
export const SOCIAL_FEATURE_STATUSES = ["submitted", "planned", "shipped", "declined"] as const;
export const SOCIAL_REPORT_REASONS = ["harassment", "hate", "threat", "doxxing", "spam", "other"] as const;

export type SocialDesiredInteraction = (typeof SOCIAL_DESIRED_INTERACTIONS)[number];
export type SocialFeatureStatus = (typeof SOCIAL_FEATURE_STATUSES)[number];
export type SocialReportReason = (typeof SOCIAL_REPORT_REASONS)[number];
export type SocialModerationState = "pending" | "approved" | "needs_review";

export type SocialInteractionActor = {
  accountId: string;
  profileId: string;
  handle: string;
};

export type SocialInteractionSummary = {
  cheered: boolean;
  saved: boolean;
  reposted: boolean;
  cheerCount: number;
  repostCount: number;
};

export type SocialCommentDTO = {
  id: string;
  postId: string;
  body: string;
  author: { handle: string };
  moderationState: SocialModerationState;
  createdAt: string;
};

export type SocialDerivativeDTO = {
  id: string;
  kind: "repost" | "quote";
  sourcePost: SocialPostDTO;
  body: string | null;
  visibility: SocialPostVisibility;
  author: { handle: string };
  moderationState: "approved" | SocialModerationState;
  createdAt: string;
};

export type SocialNotificationDTO = {
  id: string;
  kind: "cheer" | "comment" | "repost" | "quote" | "feature_update" | "tag_proposal";
  sourcePostId: string;
  readAt: string | null;
  createdAt: string;
};

export type SocialFeatureUpdateDTO = {
  id: string;
  status: SocialFeatureStatus;
  response: string;
  staff: "PUBMAXX team";
  createdAt: string;
};

export type SocialContentReportDTO = {
  id: string;
  kind: "post" | "comment" | "quote";
  contentId: string;
  reason: SocialReportReason;
  state: "queued" | "reviewing";
  createdAt: string;
};

export type SocialCommentInput = { body: string; idempotencyKey: string };
export type SocialQuoteInput = {
  body: string;
  visibility: SocialPostVisibility;
  idempotencyKey: string;
};
export type SocialFeatureUpdateInput = {
  status: Exclude<SocialFeatureStatus, "submitted">;
  response: string;
  idempotencyKey: string;
};

export function cleanSocialText(value: unknown, cap: number): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text && text.length <= cap ? text : null;
}

export function validIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{4,128}$/.test(value);
}

export function payloadDigest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function emptyInteractionSummary(): SocialInteractionSummary {
  return { cheered: false, saved: false, reposted: false, cheerCount: 0, repostCount: 0 };
}

export function isSocialCommentPolicy(value: unknown): value is SocialPostCommentPolicy {
  return value === "open" || value === "friends" || value === "locked";
}
