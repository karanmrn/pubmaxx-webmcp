import type { NightMomentKind } from "@/lib/nightMemory";

export const MOMENT_DRAFT_VERSION = 1 as const;
export const MOMENT_DRAFT_CHANNEL = "pubmaxx:moment-drafts:v1";

export type MomentMediaDraft = {
  id: string;
  type: "image" | "video";
  name: string;
  mimeType: string;
  size: number;
  blob: Blob;
  /** Ephemeral preview URL. Never persisted as an authoritative media URL. */
  objectUrl: string | null;
  width: number | null;
  height: number | null;
  focalX: number;
  focalY: number;
  alt: string;
};

export type MomentDraftV1 = {
  version: typeof MOMENT_DRAFT_VERSION;
  id: string;
  ownerKey: string;
  serverMemoryId: string | null;
  visibility: "private";
  memoryTitle: string;
  caption: string;
  kind: Exclude<NightMomentKind, "pint_drop">;
  venueId: string;
  occurredAt: string;
  media: MomentMediaDraft[];
  createdAt: string;
  updatedAt: string;
  revision: number;
};

export function createMomentDraft(
  ownerKey: string,
  id = crypto.randomUUID(),
  timestamp = new Date().toISOString(),
): MomentDraftV1 {
  return {
    version: MOMENT_DRAFT_VERSION,
    id,
    ownerKey,
    serverMemoryId: null,
    visibility: "private",
    memoryTitle: "",
    caption: "",
    kind: "photo",
    venueId: "",
    occurredAt: timestamp,
    media: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
  };
}

export function selectMomentMedia(
  current: MomentMediaDraft[],
  incoming: MomentMediaDraft[],
): { media: MomentMediaDraft[]; error: string | null } {
  const combined = [...current, ...incoming];
  const videos = combined.filter((item) => item.type === "video");
  const images = combined.filter((item) => item.type === "image");
  if (videos.length > 0 && images.length > 0) {
    return { media: current, error: "Choose one video or up to four photos, not both." };
  }
  if (videos.length > 1) {
    return { media: current, error: "A Moment can contain one video." };
  }
  if (images.length > 4) {
    return { media: current, error: "A Moment can contain up to four photos." };
  }
  return { media: combined, error: null };
}

const DB_NAME = "pubmaxx-moment-drafts";
const STORE_NAME = "drafts";

function fallbackKey(ownerKey: string): string {
  return `pubmaxx:moment-draft:v1:${ownerKey}`;
}

function openDraftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "ownerKey" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Draft storage unavailable."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDraftDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = run(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Draft storage failed."));
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => reject(transaction.error ?? new Error("Draft storage was interrupted."));
  });
}

export async function loadMomentDraft(ownerKey: string): Promise<MomentDraftV1 | null> {
  if (typeof window === "undefined") return null;
  try {
    const value = await withStore<MomentDraftV1 | undefined>("readonly", (store) => store.get(ownerKey));
    return value?.version === MOMENT_DRAFT_VERSION ? value : null;
  } catch {
    try {
      const raw = window.localStorage.getItem(fallbackKey(ownerKey));
      const value = raw ? JSON.parse(raw) as MomentDraftV1 : null;
      return value?.version === MOMENT_DRAFT_VERSION ? value : null;
    } catch {
      return null;
    }
  }
}

export async function saveMomentDraft(draft: MomentDraftV1): Promise<void> {
  if (typeof window === "undefined") return;
  const next = { ...draft, updatedAt: new Date().toISOString() };
  try {
    await withStore<IDBValidKey>("readwrite", (store) => store.put(next));
  } catch {
    const metadataOnly = { ...next, media: [] };
    try { window.localStorage.setItem(fallbackKey(draft.ownerKey), JSON.stringify(metadataOnly)); } catch { /* unavailable storage */ }
  }
}

export async function deleteMomentDraft(ownerKey: string): Promise<void> {
  if (typeof window === "undefined") return;
  try { await withStore<undefined>("readwrite", (store) => store.delete(ownerKey)); } catch { /* fallback below */ }
  try { window.localStorage.removeItem(fallbackKey(ownerKey)); } catch { /* unavailable storage */ }
}
