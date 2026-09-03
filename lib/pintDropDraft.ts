import { VIBE_TAGS, cleanVisibility, type VibeTag, type Visibility } from "@/lib/pintDropShared";

export type PintDropDraftForm = {
  price: string;
  drink: string;
  note: string;
  era: string;
  withWho: string;
};

export type PintDropDraft = {
  form: PintDropDraftForm;
  visibility: Visibility;
  vibeTags: VibeTag[];
  updatedAt: string;
};
type PintDropDraftV2 = PintDropDraft & { version: 2 };

const DRAFT_KEY_PREFIX = "pubmax_pint_drop_draft:";
const MAX_FIELD_LENGTH = 500;
const MAX_VIBE_TAGS = 4;
const VIBE_TAG_SET: ReadonlySet<string> = new Set(VIBE_TAGS);

const EMPTY_FORM: PintDropDraftForm = {
  price: "",
  drink: "",
  note: "",
  era: "",
  withWho: "",
};

function cleanField(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_FIELD_LENGTH) : "";
}

function cleanVibeTags(value: unknown): VibeTag[] {
  if (!Array.isArray(value)) return [];
  const out: VibeTag[] = [];
  for (const tag of value) {
    if (typeof tag !== "string" || !VIBE_TAG_SET.has(tag) || out.includes(tag as VibeTag)) {
      continue;
    }
    out.push(tag as VibeTag);
    if (out.length >= MAX_VIBE_TAGS) break;
  }
  return out;
}

function cleanUpdatedAt(value: unknown): string {
  if (typeof value !== "string") return new Date(0).toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

export function emptyPintDropDraftForm(): PintDropDraftForm {
  return { ...EMPTY_FORM };
}

export function pintDropDraftStorageKey(venueId: string): string {
  return `${DRAFT_KEY_PREFIX}${encodeURIComponent(venueId)}`;
}

export function normalisePintDropDraft(value: unknown): PintDropDraft | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as {
    version?: unknown;
    form?: Partial<Record<keyof PintDropDraftForm, unknown>>;
    visibility?: unknown;
    vibeTags?: unknown;
    updatedAt?: unknown;
  };
  const form = raw.form ?? {};
  return {
    form: {
      price: cleanField(form.price),
      drink: cleanField(form.drink),
      note: raw.version === 2 ? cleanField(form.note) : "",
      era: cleanField(form.era),
      withWho: cleanField(form.withWho),
    },
    visibility: cleanVisibility(raw.visibility),
    vibeTags: cleanVibeTags(raw.vibeTags),
    updatedAt: cleanUpdatedAt(raw.updatedAt),
  };
}

export function isEmptyPintDropDraft(draft: PintDropDraft): boolean {
  return (
    draft.form.price.trim() === "" &&
    draft.form.drink.trim() === "" &&
    draft.form.note.trim() === "" &&
    draft.form.era.trim() === "" &&
    draft.form.withWho.trim() === "" &&
    draft.vibeTags.length === 0 &&
    draft.visibility === "public"
  );
}

export function readPintDropDraft(
  storage: Pick<Storage, "getItem"> | null | undefined,
  venueId: string,
): PintDropDraft | null {
  if (!storage || !venueId) return null;
  try {
    const raw = storage.getItem(pintDropDraftStorageKey(venueId));
    if (!raw) return null;
    return normalisePintDropDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writePintDropDraft(
  storage: Pick<Storage, "removeItem" | "setItem"> | null | undefined,
  venueId: string,
  draft: PintDropDraft,
): void {
  if (!storage || !venueId) return;
  const key = pintDropDraftStorageKey(venueId);
  try {
    if (isEmptyPintDropDraft(draft)) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify({ ...draft, version: 2 } satisfies PintDropDraftV2));
  } catch {
    // Storage can be unavailable or full in private/locked-down contexts. Draft
    // persistence is a convenience; the composer must still work without it.
  }
}

/** Voice transcripts are never written; only the pre-dictation typed note is recoverable. */
export function pintDropDraftForPersistence(draft: PintDropDraft, transientVoiceNoteBaseline: string | null): PintDropDraft {
  return transientVoiceNoteBaseline === null
    ? draft
    : { ...draft, form: { ...draft.form, note: transientVoiceNoteBaseline } };
}

export function clearPintDropDraft(
  storage: Pick<Storage, "removeItem"> | null | undefined,
  venueId: string,
): void {
  if (!storage || !venueId) return;
  try {
    storage.removeItem(pintDropDraftStorageKey(venueId));
  } catch {
    // Same storage-failure posture as writes: fail soft.
  }
}
