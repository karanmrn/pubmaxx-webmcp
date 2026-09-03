import { normalizeHandle } from "@/lib/profiles";
import {
  validateSocialPostCreate,
  validateSocialPostEdit,
  type SocialPostFields,
} from "@/lib/socialPosts";

type SubmissionErrorCode =
  | "INVALID_POST"
  | "INVALID_AREA"
  | "FEATURE_REQUEST_BODY_REQUIRED"
  | "PHOTO_ALT_REQUIRED"
  | "INVALID_TAGS";

type SubmissionError = { ok: false; code: SubmissionErrorCode; error: string };

export type SocialCreateSubmission =
  | {
      ok: true;
      post: Omit<SocialPostFields, "photo">;
      photoAltText: string | null;
      tagHandles: string[];
    }
  | SubmissionError;

export type SocialEditSubmission =
  | {
      ok: true;
      expectedMutationVersion: number;
      changes: Partial<SocialPostFields>;
      moderationSensitive: boolean;
      removePhoto: boolean;
      photoAltText: string | null;
      tagHandles: string[];
    }
  | SubmissionError;

const CREATE_EXTRA_KEYS = new Set(["photoAltText", "tagHandles"]);
const EDIT_EXTRA_KEYS = new Set(["photoAltText", "tagHandles", "removePhoto"]);
const CREATE_KEYS = new Set([
  "kind", "visibility", "body", "area", "venueId", "hashtags", "commentPolicy",
]);
const EDIT_KEYS = new Set([
  "expectedMutationVersion", "kind", "visibility", "body", "area", "venueId", "hashtags", "commentPolicy",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanAlt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  return text || null;
}

function tags(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 10) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") return null;
    const prepared = candidate.trim().toLowerCase().replace(/^@+/, "");
    const handle = normalizeHandle(candidate);
    if (!handle || handle !== prepared) return null;
    if (!seen.has(handle)) {
      seen.add(handle);
      result.push(handle);
    }
  }
  return result;
}

function base(
  raw: Record<string, unknown>,
  allowed: Set<string>,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(raw).filter(([key]) => allowed.has(key)));
}

export function parseSocialCreateSubmission(
  input: unknown,
  hasPhoto: boolean,
): SocialCreateSubmission {
  const raw = record(input);
  if (!raw || Object.keys(raw).some((key) => !CREATE_KEYS.has(key) && !CREATE_EXTRA_KEYS.has(key))) {
    return { ok: false, code: "INVALID_POST", error: "Post details are not valid." };
  }
  const tagHandles = tags(raw.tagHandles);
  if (!tagHandles || (!hasPhoto && tagHandles.length > 0)) {
    return { ok: false, code: "INVALID_TAGS", error: "Photo tags need an attached photo." };
  }
  const photoAltText = cleanAlt(raw.photoAltText);
  if (hasPhoto && !photoAltText) {
    return { ok: false, code: "PHOTO_ALT_REQUIRED", error: "Add photo alt text." };
  }
  if (!hasPhoto && raw.photoAltText !== undefined) {
    return { ok: false, code: "INVALID_POST", error: "Post details are not valid." };
  }
  const validation = validateSocialPostCreate(base(raw, CREATE_KEYS), hasPhoto
    ? {
        trustedPhoto: {
          mediaId: "00000000-0000-4000-8000-000000000000",
          altText: photoAltText!,
        },
      }
    : {});
  if (!validation.ok) return validation;
  const post = {
    kind: validation.value.kind,
    visibility: validation.value.visibility,
    body: validation.value.body,
    area: validation.value.area,
    venueId: validation.value.venueId,
    hashtags: validation.value.hashtags,
    commentPolicy: validation.value.commentPolicy,
  };
  return { ok: true, post, photoAltText, tagHandles };
}

export function parseSocialEditSubmission(
  input: unknown,
  hasPhoto: boolean,
): SocialEditSubmission {
  const raw = record(input);
  if (!raw || Object.keys(raw).some((key) => !EDIT_KEYS.has(key) && !EDIT_EXTRA_KEYS.has(key))) {
    return { ok: false, code: "INVALID_POST", error: "Post changes are not valid." };
  }
  const removePhoto = raw.removePhoto === true;
  if ((raw.removePhoto !== undefined && typeof raw.removePhoto !== "boolean") || (removePhoto && hasPhoto)) {
    return { ok: false, code: "INVALID_POST", error: "Post changes are not valid." };
  }
  const tagHandles = tags(raw.tagHandles);
  if (!tagHandles || (!hasPhoto && tagHandles.length > 0)) {
    return { ok: false, code: "INVALID_TAGS", error: "Photo tags need an attached photo." };
  }
  const photoAltText = cleanAlt(raw.photoAltText);
  if (hasPhoto && !photoAltText) {
    return { ok: false, code: "PHOTO_ALT_REQUIRED", error: "Add photo alt text." };
  }
  if (!hasPhoto && raw.photoAltText !== undefined && (!photoAltText || removePhoto)) {
    return { ok: false, code: photoAltText ? "INVALID_POST" : "PHOTO_ALT_REQUIRED", error: photoAltText ? "Post changes are not valid." : "Add photo alt text." };
  }
  const baseInput = base(raw, EDIT_KEYS);
  const validation = validateSocialPostEdit(baseInput);
  const altOnly = !hasPhoto && Boolean(photoAltText) && Object.keys(baseInput).every((key) => key === "expectedMutationVersion") &&
    Number.isInteger(raw.expectedMutationVersion) && Number(raw.expectedMutationVersion) >= 0;
  if (!validation.ok && !altOnly) return validation;
  return {
    ok: true,
    expectedMutationVersion: validation.ok ? validation.expectedMutationVersion : Number(raw.expectedMutationVersion),
    changes: validation.ok ? validation.value : {},
    moderationSensitive: (validation.ok && validation.moderationSensitive) || hasPhoto || removePhoto || Boolean(photoAltText),
    removePhoto,
    photoAltText,
    tagHandles,
  };
}
