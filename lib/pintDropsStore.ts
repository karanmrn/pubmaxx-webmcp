import "server-only";

// Pint Drop storage layer. ONE interface (PintDropStore), TWO implementations:
// process-memory (wrapping lib/pintDrops.ts, dev/demo only) and Supabase
// (pint_drops table + Storage). The API route picks an implementation at a
// single point and talks to the interface only (M4 / PRD P2.7). Every Supabase
// function assumes admin access exists — if getSupabaseAdmin() is null we
// throw, we don't silently no-op, so the route can 503 deliberately.

import sharp from "sharp";

import type { CityId } from "@/lib/cities";
import type { Provenance } from "@/lib/curation";
import { detectImageKind, magicBytesOk as magicBytesOkPure, stripImageMetadata } from "@/lib/imageSafety";
import { log } from "@/lib/log";
import { demoDropsFor, demoPintDropsForCity } from "@/lib/pintDropSeeds";
import {
  addPintDrop,
  ANON_HANDLE_LABEL,
  canViewOnPublicSurface,
  cleanVibeTags,
  cleanVisibility,
  dropMatchesCityScope,
  hasPricedDropToday as hasPricedDropTodayMemory,
  keepHiddenPintDrop,
  listReportedPintDrops,
  listAllVisiblePintDrops,
  listByStatus,
  listLegacyPintDropsForVenue,
  listVisiblePintDrops,
  normalizeViewerHandle,
  REPORT_HIDE_THRESHOLD,
  reportPintDrop,
  restorePintDrop,
  visibilityOf,
  verifiedPintDropReportCount,
  type PintDrop,
  type PintDropReportIdentity,
  type PintDropReviewStatus,
  type PintDropStatus,
  type ViewerContext,
  type VibeTag,
} from "@/lib/pintDrops";

/** Like cleanVibeTags but collapses an empty result to undefined, so the
 *  optional `vibeTags` field stays absent (not `[]`) on drops with no tags. */
function cleanVibeTagsOrUndefined(value: unknown): VibeTag[] | undefined {
  const tags = cleanVibeTags(value);
  return tags.length ? tags : undefined;
}
import { isSupabaseConfigured, requireSupabaseAdmin, STORAGE_BUCKET } from "@/lib/supabase";
import { isLiveLastTrainDecision } from "@/lib/lastTrainBadge";
import { londonDayKey } from "@/lib/pintContributions";
import { PINT_DROPS_TABLE } from "@/lib/pintDropTable";

const TABLE = PINT_DROPS_TABLE;

/** Bounded public reads: the visible listing never returns more than this. */
export const MAX_PUBLIC_DROPS = 500;

// The create path attaches uploaded Storage keys here before persisting. Kept
// off the core PintDrop type in lib/pintDrops.ts (photos are a Supabase-only
// concern); the in-memory store ignores them entirely.
export type PersistableDrop = PintDrop & {
  pintPhotoKey?: string;
  venuePhotoKey?: string;
};

// Public read shape. Storage keys never leave the server — they map to public
// URLs (or null for hidden/pending rows) — and report/moderation metadata is
// stripped: with the report threshold a once-reported drop stays publicly
// visible, and its reporter trail must not ride along. The ONLY transparency
// exception is `reportCount`: a bare count on a still-visible drop (see toDTO)
// so a reporter can see their report registered. Reasons, reporter metadata,
// moderator notes, and hidden photos never leave the server.
export type PintDropDTO = Omit<
  PintDrop,
  "reportedAt" | "reportReason" | "reportCount" | "moderatedAt" | "moderatorNote"
> & {
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
  reportCount?: number;
};

// The label a public DTO carries for an `anonymous` drop. A safe, public string
// (issue #29): the real handle is swapped for this in EVERY DTO — it never
// leaves the server for an anonymous drop.
export { ANON_HANDLE_LABEL };

// Moderator read shape. Same photo-URL swap, but a moderator must see the
// evidence they are judging, so photos resolve even on hidden rows and the
// report metadata (reportedAt/reportReason/reportCount) is kept.
export type ModeratorDrop = PintDrop & {
  pintPhotoUrl: string | null;
  venuePhotoUrl: string | null;
};

export type PintDropPhotos = { pint: File | null; venue: File | null };

/** The one seam the API route talks to. Both implementations below. */
export type PintDropStore = {
  /** Persist a validated drop (photos where supported); returns the public DTO. Throws on storage failure. */
  create(drop: PintDrop, photos: PintDropPhotos): Promise<PintDropDTO>;
  /**
   * Public read: visible drops + demo seeds, newest-first, capped at
   * MAX_PUBLIC_DROPS, with per-drop VISIBILITY applied server-side (issue #29).
   *
   * The returned set is what `viewer` is allowed to see on a PUBLIC surface:
   *   • public + anonymous → always (anonymous handle already withheld in the DTO);
   *   • friends → only if the viewer is the author or one of the author's followers;
   *   • legacy → excluded (ledger-only, via listLegacyForVenue) — except the author.
   *
   * `viewer` is the requester's self-asserted identity (handle + the handles they
   * follow). Omitted/anonymous viewer ⇒ public + anonymous only. This is an
   * honest-best-effort courtesy curtain (self-asserted handles, no auth yet), the
   * same trust posture as lib/notifications.ts.
   */
  /**
   * @param authorHandle When set, only drops authored by this handle (normalized)
   *   are returned — used by passport / profile surfaces so clients never pull
   *   the global public feed just to filter client-side.
   */
  listVisible(
    venueId?: string,
    viewer?: ViewerContext,
    authorHandle?: string,
    /** Scopes unscoped reads (no venueId) so Manchester demo seeds stay off London feeds. */
    cityId?: CityId | null,
  ): Promise<PintDropDTO[]>;
  /**
   * The LEGACY (family/heirloom) lane for one venue — the ledger-only capability
   * issue #27 (Family Table) can adopt (issue #29 exposes it, doesn't build its
   * UI). Returns visible `legacy` drops for the venue, newest-first, as public
   * DTOs. Legacy drops are deliberately kept OUT of listVisible's public surface,
   * so the ledger is the one place they read. Author-gating (a family group) is a
   * surface decision left for #27; this returns the venue's legacy drops.
   */
  listLegacyForVenue(venueId: string): Promise<PintDropDTO[]>;
  /** Moderator review queue: unreviewed drops in a status, with report metadata. */
  listForReview(status: PintDropReviewStatus): Promise<ModeratorDrop[]>;
  /**
   * Public report: every server-derived identity records metadata. Only distinct
   * verified accounts advance the atomic auto-hide threshold; anonymous IP
   * reports leave the count unchanged. False means unknown id.
   */
  report(
    id: string,
    reason: string | undefined,
    identity: PintDropReportIdentity,
  ): Promise<boolean>;
  /** Moderator decision: set the final status and stamp the review. False = unknown id. */
  moderate(id: string, status: PintDropStatus, note?: string): Promise<boolean>;
  /**
   * Duplicate guard (feat/price-drops-v2): true when `handle` has already logged
   * a PRICED drop at `venueId` on the current London calendar day. The route
   * pre-checks this and returns 409 before create, so one identity can't stack
   * multiple price observations at one pub in a day. Note-only anecdotes are
   * exempt (a memory is not a price observation). Both backends enforce the same
   * venue+identity+day rule against their own rows. `now` is injectable (default
   * `Date.now()`) so the London-day comparison is testable against a fixed clock.
   */
  hasPricedDropToday(venueId: string, handle: string, now?: number): Promise<boolean>;
};

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5MB

/**
 * Pure photo check so it is testable without a real File. Returns a user-safe
 * error string, or null when the file is acceptable.
 */
export function validatePhoto(type: string, size: number, maxBytes = MAX_PHOTO_BYTES): string | null {
  if (!ALLOWED_TYPES.has(type)) {
    return "Photo must be a JPEG, PNG, or WebP image.";
  }
  if (size > maxBytes) {
    return `Photo must be ${Math.round(maxBytes / (1024 * 1024))}MB or smaller.`;
  }
  return null;
}

/**
 * Content-sniff the leading bytes against the declared MIME so a client can't
 * pass the type/size check with a mislabelled or crafted file (e.g. a script
 * renamed .jpg). Pure so it is testable without a real File. JPEG = FF D8 FF,
 * PNG = 89 50 4E 47 0D 0A 1A 0A, WebP = "RIFF"....\"WEBP" (bytes 8..11).
 * Unknown MIME is rejected — validatePhoto has already gated the allow-list,
 * this is defence in depth on the same allow-list.
 *
 * Re-exported from lib/imageSafety.ts (Issue #33), which is the pure,
 * dependency-free home for magic-byte detection AND metadata stripping. Kept
 * as a named export here too so existing callers/tests are unaffected.
 */
export const magicBytesOk = magicBytesOkPure;

function admin() {
  return requireSupabaseAdmin();
}

async function recordAnonymousReport(
  id: string,
  reason: string | undefined,
  actorHash: string,
): Promise<boolean> {
  const { data, error } = await admin().rpc("report_pint_drop_anonymous", {
    p_id: id,
    p_actor_hash: actorHash,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
  return data === true;
}

// pint_drops (snake_case) <-> PintDrop (camelCase). Kept in one place so a
// column rename is a one-line change on each side.
function toRow(drop: PersistableDrop) {
  return {
    id: drop.id,
    venue_id: drop.venueId,
    handle: drop.handle,
    drink: drop.drink,
    price_gbp: drop.priceGbp,
    passed_down_note: drop.passedDownNote,
    era: drop.era,
    // Persisted as a dedicated text[]/jsonb column (`vibe_tags`) — the values
    // are already a server-filtered subset of VIBE_TAGS, so this is a plain
    // one-line map on each side (like every other field here). Defaults to an
    // empty array so an old row / notes-only drop round-trips cleanly.
    vibe_tags: drop.vibeTags ?? [],
    // Per-drop visibility (issue #29). Defaults to 'public' so an old row / a
    // write that omits it stays public — matches the DB column default.
    visibility: visibilityOf(drop),
    pint_photo_key: drop.pintPhotoKey ?? null,
    venue_photo_key: drop.venuePhotoKey ?? null,
    provenance: drop.provenance,
    status: drop.status,
    created_at: drop.createdAt,
    authority_key: drop.authorityKey ?? null,
    reported_at: drop.reportedAt ?? null,
    report_reason: drop.reportReason ?? null,
    report_count: drop.reportCount ?? 0,
    moderated_at: drop.moderatedAt ?? null,
    moderator_note: drop.moderatorNote ?? null,
    // Wave G1 / F0: optional Last Train context captured at Spill compose time.
    // Null when the composer had no live decision (or TfL was down).
    leave_by_iso: drop.leaveByIso ?? null,
    last_train_decision: drop.lastTrainDecision ?? null,
  };
}

export function pintDropReportCountFromRow(row: Record<string, unknown>): number | undefined {
  const value = row.verified_report_count ?? row.report_count;
  return value === null || value === undefined ? undefined : Number(value);
}

function fromRow(row: Record<string, unknown>): PersistableDrop {
  return {
    id: String(row.id),
    venueId: String(row.venue_id),
    handle: String(row.handle),
    drink: String(row.drink ?? ""),
    priceGbp: row.price_gbp === null || row.price_gbp === undefined ? null : Number(row.price_gbp),
    passedDownNote: String(row.passed_down_note ?? ""),
    era: String(row.era ?? ""),
    // Re-filter on the way out too (defence in depth): a hand-edited or legacy
    // row can't smuggle an off-allowlist tag into a public read. Undefined when
    // empty so the field stays cleanly optional on old rows.
    vibeTags: cleanVibeTagsOrUndefined(row.vibe_tags),
    provenance: row.provenance as Provenance,
    status: row.status as PintDropStatus,
    // Coerce on the way out too (defence in depth): an old row (pre-0012, column
    // absent → undefined) or a hand-edited value collapses to the safe `public`.
    visibility: cleanVisibility(row.visibility),
    createdAt: String(row.created_at),
    authorityKey:
      typeof row.authority_key === "string" && row.authority_key.trim()
        ? row.authority_key
        : undefined,
    pintPhotoKey: row.pint_photo_key ? String(row.pint_photo_key) : undefined,
    venuePhotoKey: row.venue_photo_key ? String(row.venue_photo_key) : undefined,
    reportedAt: row.reported_at ? String(row.reported_at) : undefined,
    reportReason: row.report_reason ? String(row.report_reason) : undefined,
    reportCount: pintDropReportCountFromRow(row),
    moderatedAt: row.moderated_at ? String(row.moderated_at) : undefined,
    moderatorNote: row.moderator_note ? String(row.moderator_note) : undefined,
    leaveByIso: row.leave_by_iso ? String(row.leave_by_iso) : undefined,
    lastTrainDecision: (() => {
      const raw = row.last_train_decision ? String(row.last_train_decision) : "";
      return isLiveLastTrainDecision(raw) ? raw : undefined;
    })(),
  };
}

// A Storage key becomes a signed URL only when access is granted — hidden/pending
// drops read as null so a reported photo stops being served. Keys never reach
// the client. Signed URLs expire (SIGNED_URL_TTL_SEC) so a previously-shared
// public URL cannot keep working after takedown once the bucket is private.
export const SIGNED_URL_TTL_SEC = 3600;

/** Resolve one Storage object to a short-lived signed URL, or null when denied. */
export async function resolveStorageUrl(
  key: string | null | undefined,
  grant: boolean,
): Promise<string | null> {
  if (!key || !grant) return null;
  try {
    const { data, error } = await admin()
      .storage.from(STORAGE_BUCKET)
      .createSignedUrl(key, SIGNED_URL_TTL_SEC);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch {
    return null;
  }
}

/** Resolve many Storage keys to signed URLs in one (or few) Storage API calls. */
export async function resolveStorageUrlsBatch(
  keys: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const unique = [...new Set(keys.filter((k): k is string => typeof k === "string" && k.length > 0))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;

  const CHUNK = 100;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    try {
      const { data, error } = await admin()
        .storage.from(STORAGE_BUCKET)
        .createSignedUrls(chunk, SIGNED_URL_TTL_SEC);
      if (error || !data) continue;
      for (const row of data) {
        if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
      }
    } catch {
      // Fall through — callers treat missing keys as null URLs.
    }
  }
  return out;
}

export async function resolveDropPhotoUrls(
  drop: PersistableDrop,
  grant: boolean,
  urlByKey?: Map<string, string>,
): Promise<{ pint: string | null; venue: string | null }> {
  if (!grant) return { pint: null, venue: null };
  if (urlByKey) {
    return {
      pint: drop.pintPhotoKey ? (urlByKey.get(drop.pintPhotoKey) ?? null) : null,
      venue: drop.venuePhotoKey ? (urlByKey.get(drop.venuePhotoKey) ?? null) : null,
    };
  }
  const [pint, venue] = await Promise.all([
    resolveStorageUrl(drop.pintPhotoKey, true),
    resolveStorageUrl(drop.venuePhotoKey, true),
  ]);
  return { pint, venue };
}

/** Public DTO with signed photo URLs (Supabase path). */
export async function toDTOWithPhotos(
  drop: PersistableDrop,
  urlByKey?: Map<string, string>,
): Promise<PintDropDTO> {
  const grant = drop.status === "visible";
  return toDTO(drop, await resolveDropPhotoUrls(drop, grant, urlByKey));
}

/** Moderator DTO with signed photo URLs (evidence must resolve for review). */
export async function toModeratorDTOWithPhotos(
  drop: PersistableDrop,
  urlByKey?: Map<string, string>,
): Promise<ModeratorDrop> {
  return toModeratorDTO(drop, await resolveDropPhotoUrls(drop, true, urlByKey));
}

async function toDTOsWithBatchedPhotos(drops: PersistableDrop[]): Promise<PintDropDTO[]> {
  const keys = drops.flatMap((d) =>
    d.status === "visible" ? [d.pintPhotoKey, d.venuePhotoKey] : [],
  );
  const urlByKey = await resolveStorageUrlsBatch(keys);
  return Promise.all(drops.map((d) => toDTOWithPhotos(d, urlByKey)));
}

async function toModeratorDTOsWithBatchedPhotos(drops: PersistableDrop[]): Promise<ModeratorDrop[]> {
  const keys = drops.flatMap((d) => [d.pintPhotoKey, d.venuePhotoKey]);
  const urlByKey = await resolveStorageUrlsBatch(keys);
  return Promise.all(drops.map((d) => toModeratorDTOWithPhotos(d, urlByKey)));
}

/** Public DTO: strip Storage keys AND report/moderation metadata, emit photo
 *  URLs. The only shape the public API returns. `reportCount` is the single
 *  transparency exception — surfaced ONLY as a bare count, ONLY on a visible
 *  drop that has actually been reported (> 0), so a reporter sees their report
 *  land. Reasons, reporter metadata, moderator notes, and hidden photos are
 *  never exposed. Pass `photoUrls` from resolveDropPhotoUrls on the Supabase path. */
export function toDTO(
  drop: PersistableDrop,
  photoUrls?: { pint: string | null; venue: string | null },
): PintDropDTO {
  const visible = drop.status === "visible";
  const visibility = visibilityOf(drop);
  // ANONYMITY GUARANTEE (issue #29): an `anonymous` drop's real handle NEVER
  // rides a public DTO — it is swapped for ANON_HANDLE_LABEL here, the ONE public
  // choke point every backend routes through. The real handle stays server-side
  // (row/moderation/rate-limits) and only leaves via toModeratorDTO. The price,
  // note, tags, and photos are still public content on an anonymous drop — only
  // the identity is withheld.
  const handle = visibility === "anonymous" ? ANON_HANDLE_LABEL : drop.handle;
  const dto: PintDropDTO = {
    id: drop.id,
    venueId: drop.venueId,
    handle,
    drink: drop.drink,
    priceGbp: drop.priceGbp,
    passedDownNote: drop.passedDownNote,
    era: drop.era,
    provenance: drop.provenance,
    status: drop.status,
    visibility,
    createdAt: drop.createdAt,
    pintPhotoUrl: visible ? (photoUrls?.pint ?? null) : null,
    venuePhotoUrl: visible ? (photoUrls?.venue ?? null) : null,
  };
  if (drop.authorityKey) dto.authorityKey = drop.authorityKey;
  // Vibe tags are public, safe content — always exposed when present. Kept
  // additive (absent, not []) so the public JSON shape stays backward-compatible.
  if (drop.vibeTags && drop.vibeTags.length) dto.vibeTags = drop.vibeTags;
  if (visible && (drop.reportCount ?? 0) > 0) dto.reportCount = drop.reportCount;
  if (drop.leaveByIso) dto.leaveByIso = drop.leaveByIso;
  if (drop.lastTrainDecision) dto.lastTrainDecision = drop.lastTrainDecision;
  return dto;
}

/** Moderator DTO: strip Storage keys but resolve photos even on hidden rows —
 *  the reviewer must see the evidence. Report metadata rides along. */
export function toModeratorDTO(
  drop: PersistableDrop,
  photoUrls?: { pint: string | null; venue: string | null },
): ModeratorDrop {
  const { pintPhotoKey, venuePhotoKey, ...rest } = drop;
  void pintPhotoKey;
  void venuePhotoKey;
  return {
    ...rest,
    pintPhotoUrl: photoUrls?.pint ?? null,
    venuePhotoUrl: photoUrls?.venue ?? null,
  };
}

/** L4: the ONE merge point for organic drops + demo seeds — newest-first,
 *  hard-capped. Both implementations route their public read through this. */
function newestFirstCapped<T extends { createdAt: string }>(drops: T[]): T[] {
  return [...drops]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_PUBLIC_DROPS);
}

/**
 * Keep memory and Supabase report DTOs on one authority boundary. A memory
 * drop may carry a legacy `reportCount`; the verified ledger is authoritative
 * once its column exists, including its zero value for legacy-only rows.
 */
function withVerifiedReportCount(drop: PersistableDrop): PersistableDrop {
  return { ...drop, reportCount: verifiedPintDropReportCount(drop.id) ?? 0 };
}

// ── In-memory implementation ─────────────────────────────────────────────────
// Wraps the process-memory primitives in lib/pintDrops.ts. Resets on restart —
// right for dev/demo; production refuses it at the route.
export const memoryPintDropStore: PintDropStore = {
  async create(drop) {
    addPintDrop(drop); // photos ignored: there is no Storage without Supabase
    return toDTO(drop);
  },
  async listVisible(venueId, viewer, authorHandle, cityId) {
    const rows = venueId
      ? listVisiblePintDrops(venueId)
      : listAllVisiblePintDrops(cityId);
    const author = normalizeViewerHandle(authorHandle);
    // Visibility applied server-side (issue #29). Legacy is EXCLUDED from the
    // public surface for EVERYONE (including the author — they read it via the
    // ledger's listLegacyForVenue, not the feed), matching the Supabase backend's
    // `.neq("visibility","legacy")`. Friends is then gated on the viewer's follow
    // graph; public + anonymous always pass (anonymous handle withheld at toDTO).
    const permitted = rows.filter(
      (d) =>
        visibilityOf(d) !== "legacy" &&
        canViewOnPublicSurface(d, viewer) &&
        (!author || normalizeViewerHandle(d.handle) === author),
    );
    return newestFirstCapped(permitted).map((d) => toDTO(withVerifiedReportCount(d)));
  },
  async listLegacyForVenue(venueId) {
    return newestFirstCapped(listLegacyPintDropsForVenue(venueId)).map((d) =>
      toDTO(withVerifiedReportCount(d)),
    );
  },
  async listForReview(status) {
    const rows = status === "reported" ? listReportedPintDrops() : listByStatus(status);
    return rows
      .slice(0, MAX_PUBLIC_DROPS)
      .map((d) => toModeratorDTO(withVerifiedReportCount(d)));
  },
  async report(id, reason, identity) {
    return reportPintDrop(id, reason, identity);
  },
  async moderate(id, status, note) {
    return status === "visible" ? restorePintDrop(id, note) : keepHiddenPintDrop(id, note);
  },
  async hasPricedDropToday(venueId, handle, now = Date.now()) {
    return hasPricedDropTodayMemory(venueId, handle, new Date(now));
  },
};

// Additive-column rollout safety: recognise the specific "the `vibe_tags`
// column does not exist yet" error so create() can retry without that key while
// migration 0005 is still pending on the live DB. This is NOT general error
// swallowing — it matches ONLY a missing-`vibe_tags` column error; every other
// insert error still throws.
//
// Two provider shapes:
//   • Postgres error code 42703 (undefined_column) — the raw Postgres code.
//   • PostgREST PGRST204 — PostgREST's schema cache doesn't know the column
//     (its message reads e.g. "Could not find the 'vibe_tags' column …").
// We require the vibe_tags name to appear so a coincidental 42703 on some other
// column can't silently drop data — it will (correctly) throw.
function isMissingVibeTagsColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  const mentionsVibeTags = message.includes("vibe_tags");
  return (code === "42703" || code === "PGRST204") && mentionsVibeTags;
}

// Same additive-rollout guard as isMissingVibeTagsColumnError, for the
// `visibility` column (migration 0012). Matches ONLY a missing-`visibility`
// column error (42703 undefined_column / PGRST204 schema-cache miss that names
// the column), so a coincidental 42703 on some other column still throws.
function isMissingVisibilityColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (code === "42703" || code === "PGRST204") && message.includes("visibility");
}

// Additive-rollout guard for verified Pint Price authority (migration 0117).
// A pre-migration database may still keep the Pint Drop, but it must keep it as
// provisional. The retry therefore removes the key from both the inserted row
// and the returned DTO.
function isMissingAuthorityKeyColumnError(error: {
  code?: string;
  message?: string;
} | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  return (
    (code === "42703" || code === "PGRST204") &&
    message.includes("authority_key")
  );
}

// Additive-rollout guard for Wave G1 Last Train columns (migration 0021).
function isMissingLastTrainColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();
  const mentions =
    message.includes("leave_by_iso") || message.includes("last_train_decision");
  return (code === "42703" || code === "PGRST204") && mentions;
}


// ── Supabase implementation ──────────────────────────────────────────────────
export const supabasePintDropStore: PintDropStore = {
  async create(drop, photos) {
    const persistable: PersistableDrop = { ...drop };
    const uploaded: string[] = [];
    try {
      // Photos upload BEFORE the insert — a bad file throws before anything
      // persists; a failed insert leaves exact keys to clean up.
      if (photos.pint) {
        persistable.pintPhotoKey = await uploadPhoto("pint", drop.venueId, drop.id, photos.pint);
        uploaded.push(persistable.pintPhotoKey);
      }
      if (photos.venue) {
        persistable.venuePhotoKey = await uploadPhoto("venue", drop.venueId, drop.id, photos.venue);
        uploaded.push(persistable.venuePhotoKey);
      }
      let row = toRow(persistable);
      // First attempt includes vibe_tags + Last Train columns. Once migrations
      // 0005 / 0021 are applied this is the only path that ever runs.
      let { error } = await admin().from(TABLE).insert(row);
      if (error && isMissingAuthorityKeyColumnError(error)) {
        console.warn(
          "[pint-drops] authority_key missing - saving this drop as provisional (apply migration 0117):",
          error.message,
        );
        const { authority_key: _omitAuthority, ...rowWithoutAuthority } = row;
        void _omitAuthority;
        delete persistable.authorityKey;
        row = rowWithoutAuthority as typeof row;
        ({ error } = await admin().from(TABLE).insert(row));
      }
      if (error && isMissingLastTrainColumnError(error)) {
        console.warn(
          "[pint-drops] leave_by_iso/last_train_decision missing — inserting without them (apply migration 0021):",
          error.message,
        );
        const {
          leave_by_iso: _omitLeave,
          last_train_decision: _omitDecision,
          ...rowWithoutLastTrain
        } = row;
        void _omitLeave;
        void _omitDecision;
        row = rowWithoutLastTrain as typeof row;
        ({ error } = await admin().from(TABLE).insert(row));
      }
      if (error) {
        if (!isMissingVibeTagsColumnError(error)) throw new Error(error.message);
        // Migration 0005 (vibe_tags column) is not applied to this DB yet.
        // Retry the insert WITHOUT vibe_tags so the drop still persists — the
        // rest of the drop is fully valid; only the tags are lost until the
        // migration lands. One-line warning so the pending migration is visible
        // in logs (not silent), then re-throw only if the retry genuinely fails.
        console.warn(
          "[pint-drops] vibe_tags column missing — inserting without it (apply migration 0005):",
          error.message,
        );
        const { vibe_tags: _omit, ...rowWithoutVibeTags } = row;
        void _omit;
        const { error: retryError } = await admin().from(TABLE).insert(rowWithoutVibeTags);
        if (retryError) throw new Error(retryError.message);
      }
    } catch (err) {
      // Log the storage/insert failure (safe fields only — no buffers, no keys)
      // before cleaning up and re-throwing. The route still maps this to the
      // same 503/400 for the user; logging is purely additive observability.
      log("error", "pint_drops.create_failed", {
        dropId: drop.id,
        venueId: drop.venueId,
        uploadedCount: uploaded.length,
        error: err instanceof Error ? err.message : String(err),
      });
      await deletePhotos(uploaded); // no orphans on any failure after an upload
      throw err;
    }
    return toDTOWithPhotos(persistable);
  },

  /** Demo seeds (in-repo, never written to Supabase) merge with the organic
   *  rows in newestFirstCapped so both backends serve one read-merge path. */
  async listVisible(venueId, viewer, authorHandle, cityId) {
    const author = normalizeViewerHandle(authorHandle);
    // Base visible read, newest-first, capped. Split from the visibility filter
    // so we can retry WITHOUT it if migration 0012 isn't applied to this DB yet
    // (pre-0012 every row is effectively `public`, so an unfiltered read is safe).
    const base = () => {
      let q = admin()
        .from(TABLE)
        .select("*")
        .eq("status", "visible")
        .order("created_at", { ascending: false })
        .limit(MAX_PUBLIC_DROPS);
      if (venueId) q = q.eq("venue_id", venueId);
      if (author) q = q.eq("handle", author);
      return q;
    };
    // Legacy (family/heirloom) drops NEVER ride the public surface — they read
    // only via listLegacyForVenue (the ledger). Excluding them at the DB keeps
    // their price/note/handle out of every public signal (issue #29). `friends`
    // gating is per-viewer, applied in memory below.
    let { data, error } = await base().neq("visibility", "legacy");
    if (error && isMissingVisibilityColumnError(error)) {
      console.warn(
        "[pint-drops] visibility column missing — reading without the visibility filter (apply migration 0012):",
        error.message,
      );
      ({ data, error } = await base());
    }
    if (error) throw new Error(error.message);
    // Per-venue: all city seeds for that id. Unscoped: city-scoped seeds so
    // Manchester demo drops never noise the London feed/landing.
    const seeds = (venueId ? demoDropsFor(venueId) : demoPintDropsForCity(cityId)).filter(
      (d) => !author || normalizeViewerHandle(d.handle) === author,
    );
    // Apply the same pure predicate the memory store uses over the fetched page.
    // Legacy is already excluded above; public + anonymous always pass, friends
    // gate on the viewer's follow graph. Unscoped reads also city-scope organic
    // rows by venue id prefix (venue-mcr- ↔ Manchester).
    const permitted = (data ?? [])
      .map(fromRow)
      .concat(seeds)
      .filter((d) => venueId || dropMatchesCityScope(d.venueId, cityId))
      .filter((d) => canViewOnPublicSurface(d, viewer));
    const capped = newestFirstCapped(permitted);
    return toDTOsWithBatchedPhotos(capped);
  },

  /** The LEGACY lane for one venue (ledger-only capability for issue #27).
   *  Visible `legacy` rows for the venue, newest-first, as public DTOs. */
  async listLegacyForVenue(venueId) {
    const query = admin()
      .from(TABLE)
      .select("*")
      .eq("status", "visible")
      .eq("visibility", "legacy")
      .eq("venue_id", venueId)
      .order("created_at", { ascending: false })
      .limit(MAX_PUBLIC_DROPS);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const rows = newestFirstCapped((data ?? []).map(fromRow));
    return toDTOsWithBatchedPhotos(rows);
  },

  async listForReview(status) {
    const query = status === "reported"
      ? admin()
          .from(TABLE)
          .select("*")
          .eq("status", "visible")
          .not("reported_at", "is", null)
          .is("moderated_at", null)
          .order("reported_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(MAX_PUBLIC_DROPS)
      : admin()
          .from(TABLE)
          .select("*")
          .eq("status", status)
          .order("created_at", { ascending: false })
          .limit(MAX_PUBLIC_DROPS);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return toModeratorDTOsWithBatchedPhotos((data ?? []).map(fromRow));
  },

  /** ONE atomic RPC (migration 0112) writes the verified-account report ledger
   *  (pint_drop_verified_reports, unique (pint_drop_id, actor_hash)) and increments /
   *  stamps / hides pint_drops in a single statement. Two concurrent
   *  reports cannot lose an increment, and a same-account duplicate is an
   *  idempotent no-op. Null data means unknown id. */
  async report(id, reason, identity) {
    if (identity.kind === "anonymous_ip") {
      return recordAnonymousReport(id, reason, identity.actorHash);
    }

    const { data: v2Data, error: v2Error } = await admin().rpc("report_pint_drop_v2", {
      p_id: id,
      p_actor_hash: identity.actorHash,
      p_reason: reason ?? null,
      p_hide_threshold: REPORT_HIDE_THRESHOLD,
    });
    if (v2Error) throw new Error(v2Error.message);
    const reported = v2Data !== null && v2Data !== undefined;
    return reported;
  },

  async moderate(id, status, note) {
    const { data, error } = await admin()
      .from(TABLE)
      .update({
        status,
        moderated_at: new Date().toISOString(),
        ...(note ? { moderator_note: note } : {}),
      })
      .eq("id", id)
      .select("id");
    if (error) throw new Error(error.message);
    const ok = (data ?? []).length > 0;
    return ok;
  },

  /**
   * Duplicate guard: the contributor's most recent PRICED drop at this venue,
   * compared against the current London day in JS. We read the single newest
   * priced row (indexed by migration 0040's
   * (venue_id, handle, created_at) partial index) rather than computing a
   * London-day boundary in SQL — `timezone('Europe/London', ...)` is only STABLE,
   * not IMMUTABLE, so it can't anchor a durable unique index, and a one-row read
   * keeps the day-bucket logic in the same londonDayKey() the streak uses (no
   * drift). Handles are normalized on write, so the equality match is exact.
   */
  async hasPricedDropToday(venueId, handle, now = Date.now()) {
    const who = normalizeViewerHandle(handle);
    if (!who) return false;
    const { data, error } = await admin()
      .from(TABLE)
      .select("created_at")
      .eq("venue_id", venueId)
      .eq("handle", who)
      .not("price_gbp", "is", null)
      .neq("status", "hidden")
      .order("created_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const latest = (data ?? [])[0] as { created_at?: string } | undefined;
    if (!latest?.created_at) return false;
    return londonDayKey(latest.created_at) === londonDayKey(new Date(now));
  },
};

// PRD §7.2: we normalize EVERY upload to JPEG, so the stored object is always
// `.jpg` / `image/jpeg` regardless of what the client sent. One output format
// keeps the storage-key + content-type derivation trivial and side-steps
// format-specific metadata quirks; JPEG q80 at ≤1200px is plenty for a pint
// photo. (If we ever want format-preserving output, branch here and in the
// sharp pipeline together.)
const NORMALIZED_EXT = "jpg";
const NORMALIZED_CONTENT_TYPE = "image/jpeg";
const MAX_IMAGE_DIMENSION = 1200;
const JPEG_QUALITY = 80;

/**
 * PRD §7.2 — decode the uploaded bytes and re-emit a privacy-safe, normalized
 * JPEG. Phone photos embed GPS + device data in EXIF; uploading the raw file
 * leaks the contributor's location. sharp strips ALL metadata by default (we
 * never call `.withMetadata()`), and `.rotate()` bakes the EXIF orientation
 * into the pixels before that metadata is dropped so the image still displays
 * upright. We also downscale to a sane max and re-encode so a huge original
 * can't be served verbatim.
 *
 * Throws on a decode/encode failure so the caller can FAIL SAFE — we must never
 * fall back to uploading the raw (EXIF-bearing) bytes, which would defeat the
 * whole point of stripping.
 */
/** The single backend selection point (mirrors the other stores). */
export function pintDropsStore(): PintDropStore {
  return isSupabaseConfigured() ? supabasePintDropStore : memoryPintDropStore;
}


async function normalizeImage(input: Uint8Array): Promise<Buffer> {
  return sharp(input)
    // Apply the EXIF orientation to the pixels, THEN let sharp drop the EXIF
    // (default) — the tag is gone but the image is no longer sideways.
    .rotate()
    .resize({
      width: MAX_IMAGE_DIMENSION,
      height: MAX_IMAGE_DIMENSION,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
}

/**
 * Validate + normalize + upload one photo (pint or venue) to Storage. Returns
 * the object key to stash on the drop. Keys are deterministic
 * (`${venueId}/${dropId}/${slot}.${ext}`) so a failed insert has an exact key
 * to clean up — no orphan hunt. Throws a user-safe Error on an invalid file
 * (trust boundary — the client is untrusted, so type/size are checked here, not
 * just in the browser).
 */
export async function uploadPhoto(
  slot: "pint" | "venue",
  venueId: string,
  dropId: string,
  file: File,
  maxBytes = MAX_PHOTO_BYTES,
): Promise<string> {
  const invalid = validatePhoto(file.type, file.size, maxBytes);
  if (invalid) throw new Error(invalid);

  // Read the bytes once, sniff the signature, then strip + normalize. A
  // mislabelled/crafted file that passed the MIME check is rejected here with
  // the same user-safe "Photo must…" error path (route → 400).
  const buffer = new Uint8Array(await file.arrayBuffer());
  if (!magicBytesOk(buffer, file.type)) {
    throw new Error("Photo must be a JPEG, PNG, or WebP image.");
  }

  // Issue #33: pure-TypeScript, dependency-free metadata strip (JPEG segment /
  // PNG chunk / WebP RIFF-chunk rewrite — see lib/imageSafety.ts) BEFORE the
  // sharp re-encode below. This is an explicit, auditable belt-and-braces
  // layer on top of sharp's own metadata drop: it never trusts a native
  // binary to be the only thing standing between an uploaded file and a
  // leaked GPS tag, and it fails closed on a malformed/truncated byte stream
  // that magicBytesOk's leading-signature check wouldn't catch. Order:
  // magic-byte check → strip → normalize → upload. A strip failure is FAIL
  // CLOSED — reject, never fall through to the original (unstripped) bytes.
  const kind = detectImageKind(buffer);
  if (!kind) {
    // Should be unreachable given magicBytesOk just passed, but keep the
    // fail-closed guarantee explicit rather than assuming the two checks can
    // never disagree.
    throw new Error("Photo must be a JPEG, PNG, or WebP image.");
  }
  let stripped: Uint8Array;
  try {
    stripped = stripImageMetadata(buffer, kind);
  } catch (err) {
    log("error", "pint_drops.metadata_strip_failed", {
      slot,
      venueId,
      dropId,
      contentType: file.type,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error("Photo must be a valid, uncorrupted image.");
  }

  // PRD §7.2: strip EXIF (incl. GPS) + normalize BEFORE upload. A processing
  // failure must FAIL SAFE — log it and reject the upload; we never fall
  // through to the raw, EXIF-bearing bytes. `slot`/`dropId`/`venueId` are safe
  // to log (opaque ids); the image bytes are NEVER logged.
  let processed: Buffer;
  try {
    processed = await normalizeImage(stripped);
  } catch (err) {
    log("error", "pint_drops.image_normalize_failed", {
      slot,
      venueId,
      dropId,
      contentType: file.type,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new Error("Photo could not be processed. Choose a different image and try again.");
  }

  const key = `${venueId}/${dropId}/${slot}.${NORMALIZED_EXT}`;

  const { error } = await admin()
    .storage.from(STORAGE_BUCKET)
    .upload(key, processed, { contentType: NORMALIZED_CONTENT_TYPE, upsert: false });
  if (error) {
    log("error", "pint_drops.photo_upload_failed", {
      slot,
      venueId,
      dropId,
      error: error.message,
    });
    throw new Error(error.message);
  }
  return key;
}

/** Best-effort delete of uploaded objects — called to undo orphans when the
 *  DB insert fails after upload. Never throws: cleanup must not mask the
 *  original 503. */
export async function deletePhotos(keys: string[]): Promise<void> {
  const present = keys.filter(Boolean);
  if (!present.length) return;
  try {
    await admin().storage.from(STORAGE_BUCKET).remove(present);
  } catch (err) {
    // Never re-throw — cleanup must not mask the original failure. But log a
    // warning (safe fields only: a count, not the keys) so orphaned objects are
    // observable rather than silently accumulating.
    log("warn", "pint_drops.photo_cleanup_failed", {
      keyCount: present.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
