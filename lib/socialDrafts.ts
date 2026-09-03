import type { NightMomentKind } from "@/lib/nightMemory";

const STUDIO_KINDS = ["event", "venue", "quote", "person", "side_quest"] as const;
type StudioMomentKind = Exclude<NightMomentKind, "photo" | "pint_drop">;

export type MemoryStudioDraft = {
  memoryTitle: string;
  selectedMemoryId: string;
  momentKind: StudioMomentKind;
  momentCaption: string;
  venueId: string;
  storyTitle: string;
  storySummary: string;
};

export type MemoryStudioDraftV1 = {
  version: 1;
  savedAt: string;
  draft: MemoryStudioDraft;
};

export type CommentDraft = {
  body: string;
  replyTo: string | null;
  replyBody: string;
};

export type CommentDraftV1 = {
  version: 1;
  savedAt: string;
  draft: CommentDraft;
};

export const EMPTY_MEMORY_STUDIO_DRAFT: MemoryStudioDraft = {
  memoryTitle: "",
  selectedMemoryId: "",
  momentKind: "side_quest",
  momentCaption: "",
  venueId: "",
  storyTitle: "",
  storySummary: "",
};

export const EMPTY_COMMENT_DRAFT: CommentDraft = {
  body: "",
  replyTo: null,
  replyBody: "",
};

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.localStorage; } catch { return null; }
}

function legacyStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try { return window.sessionStorage; } catch { return null; }
}

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length <= max ? value : null;
}

function studioKey(userId: string): string {
  return `pubmaxx.memory-studio.v1:${encodeURIComponent(userId)}`;
}

function commentKey(dropId: string): string {
  return `pubmaxx.comment-draft.v1:${encodeURIComponent(dropId)}`;
}

function subscribeKey(key: string, listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.storageArea === window.localStorage && event.key === key) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export function subscribeMemoryStudioDraft(userId: string, listener: () => void): () => void {
  return subscribeKey(studioKey(userId), listener);
}

export function subscribeCommentDraft(dropId: string, listener: () => void): () => void {
  return subscribeKey(commentKey(dropId), listener);
}

export function validateMemoryStudioDraft(value: unknown): MemoryStudioDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<MemoryStudioDraft>;
  const momentKind = STUDIO_KINDS.includes(raw.momentKind as StudioMomentKind)
    ? raw.momentKind as StudioMomentKind
    : null;
  const memoryTitle = text(raw.memoryTitle, 120);
  const selectedMemoryId = text(raw.selectedMemoryId, 120);
  const momentCaption = text(raw.momentCaption, 500);
  const venueId = text(raw.venueId, 80);
  const storyTitle = text(raw.storyTitle, 120);
  const storySummary = text(raw.storySummary, 500);
  if (!momentKind || memoryTitle === null || selectedMemoryId === null || momentCaption === null || venueId === null || storyTitle === null || storySummary === null) return null;
  return { memoryTitle, selectedMemoryId, momentKind, momentCaption, venueId, storyTitle, storySummary };
}

export function readMemoryStudioDraft(userId: string): MemoryStudioDraft {
  try {
    const target = storage();
    const raw = JSON.parse(target?.getItem(studioKey(userId)) ?? "null") as Partial<MemoryStudioDraftV1> | null;
    if (raw?.version === 1) return validateMemoryStudioDraft(raw.draft) ?? EMPTY_MEMORY_STUDIO_DRAFT;
    const legacyKey = studioKey(userId);
    const legacy = JSON.parse(legacyStorage()?.getItem(legacyKey) ?? "null") as Partial<MemoryStudioDraftV1> | MemoryStudioDraft | null;
    const migrated = legacy && "version" in legacy && legacy.version === 1
      ? validateMemoryStudioDraft(legacy.draft)
      : validateMemoryStudioDraft(legacy);
    if (!migrated) return EMPTY_MEMORY_STUDIO_DRAFT;
    writeMemoryStudioDraft(userId, migrated);
    legacyStorage()?.removeItem(legacyKey);
    return migrated;
  } catch {
    return EMPTY_MEMORY_STUDIO_DRAFT;
  }
}

export function writeMemoryStudioDraft(userId: string, draft: MemoryStudioDraft): void {
  const safe = validateMemoryStudioDraft(draft);
  if (!safe) return;
  try {
    const target = storage();
    if (!target) return;
    const existing = JSON.parse(target.getItem(studioKey(userId)) ?? "null") as Partial<MemoryStudioDraftV1> | null;
    if (existing?.version === 1 && JSON.stringify(validateMemoryStudioDraft(existing.draft)) === JSON.stringify(safe)) return;
    target.setItem(studioKey(userId), JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      draft: safe,
    } satisfies MemoryStudioDraftV1));
  } catch {
    // Session recovery is best effort in private or quota-constrained browsers.
  }
}

export function validateCommentDraft(value: unknown): CommentDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CommentDraft>;
  const body = text(raw.body, 500);
  const replyBody = text(raw.replyBody, 500);
  const replyTo = raw.replyTo === null ? null : text(raw.replyTo, 120);
  if (body === null || replyBody === null || replyTo === null && raw.replyTo !== null) return null;
  return { body, replyTo, replyBody };
}

export function readCommentDraft(dropId: string): CommentDraft {
  try {
    const raw = JSON.parse(storage()?.getItem(commentKey(dropId)) ?? "null") as Partial<CommentDraftV1> | null;
    if (raw?.version === 1) return validateCommentDraft(raw.draft) ?? EMPTY_COMMENT_DRAFT;
    const legacyKey = commentKey(dropId);
    const legacy = JSON.parse(legacyStorage()?.getItem(legacyKey) ?? "null") as Partial<CommentDraftV1> | CommentDraft | null;
    const migrated = legacy && "version" in legacy && legacy.version === 1
      ? validateCommentDraft(legacy.draft)
      : validateCommentDraft(legacy);
    if (!migrated) return EMPTY_COMMENT_DRAFT;
    writeCommentDraft(dropId, migrated);
    legacyStorage()?.removeItem(legacyKey);
    return migrated;
  } catch {
    return EMPTY_COMMENT_DRAFT;
  }
}

export function writeCommentDraft(dropId: string, draft: CommentDraft): void {
  const safe = validateCommentDraft(draft);
  if (!safe) return;
  try {
    const target = storage();
    if (!target) return;
    if (!safe.body && !safe.replyBody && !safe.replyTo) {
      target.removeItem(commentKey(dropId));
      return;
    }
    const existing = JSON.parse(target.getItem(commentKey(dropId)) ?? "null") as Partial<CommentDraftV1> | null;
    if (existing?.version === 1 && JSON.stringify(validateCommentDraft(existing.draft)) === JSON.stringify(safe)) return;
    target.setItem(commentKey(dropId), JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      draft: safe,
    } satisfies CommentDraftV1));
  } catch {
    // Session recovery is best effort in private or quota-constrained browsers.
  }
}
