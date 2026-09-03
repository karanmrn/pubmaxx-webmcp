import type { PintDropDTO } from "@/lib/feed";
import type { Visibility } from "@/lib/spill";
import type { LastPintDecisionKind } from "@/lib/tfl";
import { discardBody } from "@/lib/responseBody";
import { venueMapUrl } from "@/lib/venueMapUrl";

export const OPTIMISTIC_SPILL_STORAGE_KEY = "pubmax:optimistic-spill-posts:v1";
export const OPTIMISTIC_SPILL_EVENT = "pubmax:optimistic-spill-posts-changed";

export type StoredOptimisticSpill = {
  clientRequestId: string;
  drop: PintDropDTO;
  retry?: OptimisticSpillRetryPayload;
};

export type OptimisticSpillInput = {
  clientRequestId: string;
  venueId: string;
  venueName?: string;
  handle: string;
  priceGbp: string;
  drink: string;
  passedDownNote: string;
  era: string;
  visibility: Visibility;
  vibeTags: string[];
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  createdAt: string;
  /** Wave G1: optional Last Train context when a live decision was on screen. */
  leaveByIso?: string;
  lastTrainDecision?: LastPintDecisionKind;
};

export type OptimisticSpillRetryPayload = {
  venueId: string;
  venueName?: string;
  handle: string;
  priceGbp: string;
  drink: string;
  passedDownNote: string;
  era: string;
  visibility: Visibility;
  vibeTags: string[];
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  leaveByIso?: string;
  lastTrainDecision?: LastPintDecisionKind;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type ResolvePhotoPreview = (url: string) => Promise<Blob>;

function parsePrice(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

function cleanString(value: string): string {
  return value.replace(/[<>]/g, "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
}

export function newOptimisticSpillClientId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function shouldOptimisticallyAppearInFeed(visibility: Visibility): boolean {
  return visibility === "public" || visibility === "anonymous";
}

export function buildOptimisticSpillDrop(input: OptimisticSpillInput): PintDropDTO {
  const priceGbp = parsePrice(input.priceGbp);
  const hasPhoto = Boolean(input.pintPhotoUrl || input.venuePhotoUrl);
  const handle =
    input.visibility === "anonymous" ? "a PUBMAXXER" : cleanString(input.handle) || "PUBMAXXER";

  return {
    id: `optimistic-${input.clientRequestId}`,
    handle,
    priceGbp,
    drink: cleanString(input.drink),
    passedDownNote: cleanString(input.passedDownNote),
    era: cleanString(input.era),
    provenance: priceGbp === null ? "anecdote" : "contributor",
    venueId: input.venueId,
    createdAt: input.createdAt,
    vibeTags: input.vibeTags,
    pintPhotoUrl: input.pintPhotoUrl,
    venuePhotoUrl: input.venuePhotoUrl,
    venueName: cleanString(input.venueName ?? "") || undefined,
    venueMapUrl: venueMapUrl(input.venueId),
    ...(input.leaveByIso ? { leaveByIso: input.leaveByIso } : {}),
    ...(input.lastTrainDecision ? { lastTrainDecision: input.lastTrainDecision } : {}),
    optimistic: {
      state: hasPhoto ? "uploading" : "pending",
      message: hasPhoto ? "Posting Spill, uploading photo" : "Posting Spill",
      uploadProgress: hasPhoto ? 0 : null,
      canRetry: false,
      clientRequestId: input.clientRequestId,
    },
  };
}

export function buildOptimisticSpillRetryPayload(
  input: OptimisticSpillInput,
): OptimisticSpillRetryPayload {
  return {
    venueId: input.venueId,
    venueName: input.venueName,
    handle: input.handle,
    priceGbp: input.priceGbp,
    drink: input.drink,
    passedDownNote: input.passedDownNote,
    era: input.era,
    visibility: input.visibility,
    vibeTags: input.vibeTags,
    pintPhotoUrl: input.pintPhotoUrl,
    venuePhotoUrl: input.venuePhotoUrl,
    ...(input.leaveByIso ? { leaveByIso: input.leaveByIso } : {}),
    ...(input.lastTrainDecision ? { lastTrainDecision: input.lastTrainDecision } : {}),
  };
}

export function upsertOptimisticSpill(
  stored: StoredOptimisticSpill[],
  drop: PintDropDTO,
  retry?: OptimisticSpillRetryPayload,
): StoredOptimisticSpill[] {
  const clientRequestId = drop.optimistic?.clientRequestId;
  if (!clientRequestId) return stored;
  const next = stored.filter((entry) => entry.clientRequestId !== clientRequestId);
  return [{ clientRequestId, drop, ...(retry ? { retry } : {}) }, ...next];
}

export function reconcileOptimisticSpill(
  stored: StoredOptimisticSpill[],
  clientRequestId: string,
  serverDrop: PintDropDTO,
): StoredOptimisticSpill[] {
  const withoutDraft = stored.filter((entry) => entry.clientRequestId !== clientRequestId);
  return [{ clientRequestId, drop: serverDrop }, ...withoutDraft];
}

export function failOptimisticSpill(
  stored: StoredOptimisticSpill[],
  clientRequestId: string,
  message: string,
): StoredOptimisticSpill[] {
  return stored.map((entry) => {
    if (entry.clientRequestId !== clientRequestId) return entry;
    return {
      ...entry,
      drop: {
        ...entry.drop,
        optimistic: {
          state: "failed",
          message,
          uploadProgress: null,
          canRetry: true,
          clientRequestId,
        },
      },
    };
  });
}

export function markOptimisticSpillRetrying(
  stored: StoredOptimisticSpill[],
  clientRequestId: string,
): StoredOptimisticSpill[] {
  return stored.map((entry) => {
    if (entry.clientRequestId !== clientRequestId) return entry;
    const hasPhoto = Boolean(entry.drop.pintPhotoUrl || entry.drop.venuePhotoUrl);
    return {
      ...entry,
      drop: {
        ...entry.drop,
        optimistic: {
          state: hasPhoto ? "uploading" : "pending",
          message: hasPhoto ? "Retrying Spill, uploading photo" : "Retrying Spill",
          uploadProgress: hasPhoto ? 0 : null,
          canRetry: false,
          clientRequestId,
        },
      },
    };
  });
}

async function resolveBlobPreview(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    discardBody(response);
    throw new Error("Photo preview is no longer available. Open the composer and attach it again.");
  }
  return response.blob();
}

async function appendRetryPhoto(
  body: FormData,
  field: "pint_photo" | "venue_photo",
  url: string | null,
  resolvePhotoPreview: ResolvePhotoPreview,
) {
  if (!url) return;
  if (!url.startsWith("blob:")) return;
  const blob = await resolvePhotoPreview(url);
  const extension = blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : "jpg";
  body.set(field, blob, `${field}.${extension}`);
}

export async function buildOptimisticSpillRetryFormData(
  payload: OptimisticSpillRetryPayload,
  resolvePhotoPreview: ResolvePhotoPreview = resolveBlobPreview,
): Promise<FormData> {
  const body = new FormData();
  body.set("venueId", payload.venueId);
  body.set("handle", payload.handle);
  body.set("drink", payload.drink);
  body.set("priceGbp", payload.priceGbp);
  body.set("passedDownNote", payload.passedDownNote);
  body.set("era", payload.era);
  body.set("visibility", payload.visibility);
  for (const tag of payload.vibeTags) body.append("vibe_tags", tag);
  if (payload.leaveByIso) body.set("leaveByIso", payload.leaveByIso);
  if (payload.lastTrainDecision) body.set("lastTrainDecision", payload.lastTrainDecision);
  await appendRetryPhoto(body, "pint_photo", payload.pintPhotoUrl, resolvePhotoPreview);
  await appendRetryPhoto(body, "venue_photo", payload.venuePhotoUrl, resolvePhotoPreview);
  return body;
}

export function mergeOptimisticSpillDrops(
  serverDrops: PintDropDTO[],
  stored: StoredOptimisticSpill[],
): PintDropDTO[] {
  const localDrops = stored.map((entry) => entry.drop);
  const localIds = new Set(localDrops.map((drop) => drop.id));
  const localClientIds = new Set(
    localDrops.map((drop) => drop.optimistic?.clientRequestId).filter(Boolean),
  );
  return [
    ...localDrops,
    ...serverDrops.filter(
      (drop) => !localIds.has(drop.id) && !localClientIds.has(drop.optimistic?.clientRequestId),
    ),
  ];
}

function isStoredOptimisticSpill(value: unknown): value is StoredOptimisticSpill {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<StoredOptimisticSpill>;
  return (
    typeof entry.clientRequestId === "string" &&
    Boolean(entry.clientRequestId) &&
    typeof entry.drop === "object" &&
    entry.drop !== null &&
    typeof (entry.drop as Partial<PintDropDTO>).id === "string"
  );
}

export function readOptimisticSpills(storage: StorageLike): StoredOptimisticSpill[] {
  try {
    const raw = storage.getItem(OPTIMISTIC_SPILL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isStoredOptimisticSpill) : [];
  } catch {
    return [];
  }
}

export function writeOptimisticSpills(
  storage: StorageLike,
  entries: StoredOptimisticSpill[],
): void {
  try {
    if (entries.length === 0) {
      storage.removeItem(OPTIMISTIC_SPILL_STORAGE_KEY);
      return;
    }
    storage.setItem(OPTIMISTIC_SPILL_STORAGE_KEY, JSON.stringify(entries.slice(0, 10)));
  } catch {
    // Storage can be full or disabled; the in-memory submit path still proceeds.
  }
}

export function emitOptimisticSpillChange(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPTIMISTIC_SPILL_EVENT));
}
