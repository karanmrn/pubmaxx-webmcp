// SERVER-ONLY module. This is the storage-agnostic core of the Pint Drop domain:
// the trust-boundary validation, the in-memory store, the durable rate limiter
// (imports @/lib/supabase → node:crypto), and the visibility gating. It must
// never be imported from a "use client" component — doing so drags the Supabase
// admin client (and node:crypto) into the browser bundle and breaks the webpack
// build. The BROWSER-SAFE surface (allowlists, labels, DTO shapes) lives in
// lib/pintDropShared.ts and is re-exported below, so client code imports that
// module and validation/UI can never drift. Same pattern as lib/reactionsStore.ts
// (server) over lib/reactions.ts (browser-safe).

import "server-only";

import { randomUUID } from "crypto";

import { HANDLE_MAX, normalizeHandle as normalizeHandleCore } from "@/lib/handleNormalize";
import type { CityId } from "@/lib/cities";
import { venueIdMatchesCity } from "@/lib/cityVenueIds";
import type { Provenance } from "@/lib/curation";
import {
  demoDropsFor,
  demoPintDrops,
  demoPintDropsForCity,
} from "@/lib/pintDropSeeds";
import {
  ANON_HANDLE_LABEL,
  cleanPintDropText as clean,
  cleanVisibility,
  DEFAULT_VISIBILITY,
  PINT_DROP_MAX_NOTE,
  VIBE_TAGS,
  VISIBILITIES,
  type PintDrop,
  type PintDropInput,
  type PintDropStatus,
  type ValidationResult,
  type VibeTag,
  type ViewerContext,
  type Visibility,
} from "@/lib/pintDropShared";
import { isLiveLastTrainDecision } from "@/lib/lastTrainBadge";
import { londonDayKey } from "@/lib/pintContributions";
import {
  checkRateLimitDurableDetailed,
  isSupabaseConfigured,
} from "@/lib/supabase";
import { log } from "@/lib/log";

/** Unscoped feed/map reads: keep Manchester venue ids off the London surface. */
export function dropMatchesCityScope(
  venueId: string,
  cityId?: CityId | null,
): boolean {
  const scoped = cityId ?? "london";
  return venueIdMatchesCity(venueId, scoped);
}

// Re-export the browser-safe surface so existing importers (and tests) that pull
// these from @/lib/pintDrops keep working — single source of truth in
// lib/pintDropShared.ts, no drift.
export {
  ANON_HANDLE_LABEL,
  cleanVisibility,
  DEFAULT_VISIBILITY,
  VIBE_TAGS,
  VISIBILITIES,
  type PintDrop,
  type PintDropInput,
  type PintDropStatus,
  type ValidationResult,
  type VibeTag,
  type ViewerContext,
  type Visibility,
};

/** Moderator review lanes. `reported` is a queue view over visible rows with
 * an unreviewed report. It is not a persisted Pint Drop status. */
export type PintDropReviewStatus = "hidden" | "pending" | "reported";

const VIBE_TAG_SET: ReadonlySet<string> = new Set(VIBE_TAGS);
const MAX_VIBE_TAGS = 4;

/**
 * Normalise an untrusted vibe-tag list: accept only allow-listed tags
 * (case-insensitively), dedupe, and cap at MAX_VIBE_TAGS. Never trusts the
 * client — an unknown or malformed tag is silently dropped, not stored.
 */
export function cleanVibeTags(value: unknown): VibeTag[] {
  if (!Array.isArray(value)) return [];
  const out: VibeTag[] = [];
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const tag = raw.trim().toLowerCase();
    if (VIBE_TAG_SET.has(tag) && !out.includes(tag as VibeTag)) {
      out.push(tag as VibeTag);
      if (out.length >= MAX_VIBE_TAGS) break;
    }
  }
  return out;
}

// Visibility allowlist, default, the withheld-handle label, and cleanVisibility
// now live in the browser-safe lib/pintDropShared.ts (imported + re-exported
// above) so the composer can reuse them without pulling this server module.

// Trust boundary. Never lazy here: the client is untrusted. Strip anything that
// could be HTML/script, cap lengths, and clamp the price to a sane pub range.
const MAX_NOTE = PINT_DROP_MAX_NOTE;
const MAX_DRINK = 60;
const MAX_ERA = 40;
const MAX_PRICE = 20; // a £40 "pint" is a typo or abuse, not a data point.
// Outlier FLOOR (feat/price-drops-v2): a sub-£1 "pint" is a fat-fingered entry
// (£4.50 typed as £0.45) or deliberate noise, never a real London price — reject
// it server-side just like the > £20 ceiling. Mirrored by the DB CHECK in
// migration 0040 (defence in depth) and by the composer's inputMode UI.
const MIN_PRICE = 1;

/**
 * Validate + normalise an untrusted submission into a persistable Pint Drop.
 * A drop must carry at least one signal: a price OR a passed-down note.
 * Provenance follows the evidence: a priced drop is `contributor`
 * (photo/price evidence), a note-only drop is an unverifiable `anecdote`.
 */
export function validatePintDrop(input: unknown): ValidationResult {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "Missing submission body." };
  }
  const raw = input as Record<string, unknown>;

  const venueId = clean(raw.venueId, 64);
  if (!venueId) return { ok: false, error: "Choose a venue." };

  const handle = normalizeViewerHandle(clean(raw.handle, HANDLE_MAX));
  if (!handle) return { ok: false, error: "Add a contributor handle." };

  const note = clean(raw.passedDownNote, MAX_NOTE);

  let priceGbp: number | null = null;
  if (raw.priceGbp !== undefined && raw.priceGbp !== null && raw.priceGbp !== "") {
    const parsed = Number(raw.priceGbp);
    if (!Number.isFinite(parsed)) return { ok: false, error: "Price must be a number." };
    if (parsed < MIN_PRICE || parsed > MAX_PRICE) {
      return { ok: false, error: `Price must be between £${MIN_PRICE} and £${MAX_PRICE}.` };
    }
    priceGbp = Math.round(parsed * 100) / 100;
  }

  if (priceGbp === null && !note) {
    return { ok: false, error: "Add a price or a passed-down note." };
  }

  const provenance: Provenance = priceGbp !== null ? "contributor" : "anecdote";

  // Vibe tags are supporting metadata, not a standalone signal: they never
  // satisfy the price-or-note requirement above. Filtered to the allowlist here.
  const vibeTags = cleanVibeTags(raw.vibeTags);

  // Visibility is additive + forgiving: any off-allowlist value (or an omitted
  // field) collapses to the default `public`, so an old client that never sends
  // it behaves exactly as before. Always stamped explicitly so a persisted drop
  // carries its lane.
  const visibility = cleanVisibility(raw.visibility);

  // Wave G1: optional Last Train context from compose. Server re-filters to the
  // same live-kind + leave-by rules as lastTrainComposeFields — never persist a
  // TfL-down guess or a bare decision without a leave-by clock.
  const leaveByIsoRaw =
    typeof raw.leaveByIso === "string" ? raw.leaveByIso.trim() : "";
  const lastTrainDecisionRaw =
    typeof raw.lastTrainDecision === "string" ? raw.lastTrainDecision.trim() : "";
  const leaveByOk =
    leaveByIsoRaw !== "" && !Number.isNaN(Date.parse(leaveByIsoRaw));
  const lastTrainFields =
    leaveByOk && isLiveLastTrainDecision(lastTrainDecisionRaw)
      ? { leaveByIso: leaveByIsoRaw, lastTrainDecision: lastTrainDecisionRaw }
      : {};

  return {
    ok: true,
    value: {
      id: randomUUID(),
      venueId,
      handle,
      drink: clean(raw.drink, MAX_DRINK),
      priceGbp,
      passedDownNote: note,
      era: clean(raw.era, MAX_ERA),
      ...(vibeTags.length ? { vibeTags } : {}),
      provenance,
      status: "visible",
      visibility,
      createdAt: new Date().toISOString(),
      ...lastTrainFields,
    },
  };
}

// ── In-memory store ──────────────────────────────────────────────────────────
// Process-memory store, resets on restart — right for the prototype demo. Swap
// for the Supabase adapter (lib/pintDropsStore) when keys exist; the
// validation/provenance/moderation logic above is storage-agnostic and unchanged.
const drops = new Map<string, PintDrop[]>();

// Naive per-handle rate limit (in-memory), enough to stop one actor flooding a
// demo. Move to Redis/Supabase counters if this ever ships.
const rateWindow = new Map<string, number[]>();
const RATE_LIMIT = 8;
const RATE_WINDOW_MS = 60_000;

export function isRateLimited(
  handle: string,
  now = Date.now(),
  limit = RATE_LIMIT,
  windowMs = RATE_WINDOW_MS,
): boolean {
  const key = handle.toLowerCase();
  const hits = (rateWindow.get(key) ?? []).filter((t) => now - t < windowMs);
  hits.push(now);
  rateWindow.set(key, hits);
  return hits.length > limit;
}

/** Cap applied when the durable limiter is configured but unavailable. */
const DEGRADED_RATE_LIMIT = 3;

/**
 * Combined limiter used by every rate-limited route: durable (Supabase RPC)
 * when configured, in-memory otherwise.
 *
 * When Supabase is configured but the durable check cannot answer:
 *   • `missing-rpc` / `no-client` → full in-memory `limit` (preview/CI/demo
 *     safe — migration may not be applied yet)
 *   • `error` (transient outage) → degraded Math.min(limit, 3); or
 *     RATE_LIMIT_STRICT=1 → treat as limited (429) instead of opening wider
 *
 * No Supabase → in-memory at the normal limit (demo unchanged). A real boolean
 * durable verdict is used as-is. `checkRateLimitDurableDetailed` logs the
 * downgrade loudly.
 */
export async function isLimited(
  localKey: string,
  durableKey: string,
  limit = RATE_LIMIT,
  windowMs = RATE_WINDOW_MS,
  opts?: { failClosed?: boolean },
): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    // Pure local dev (no Supabase at all): in-memory result even for
    // fail-closed callers, so local dev keeps working.
    return isRateLimited(localKey, Date.now(), limit, windowMs);
  }

  const { verdict, reason } = await checkRateLimitDurableDetailed(
    durableKey,
    limit,
    windowMs,
  );
  if (typeof verdict === "boolean") return verdict;

  // Supabase IS configured but the durable check could not answer. For
  // cost-sensitive callers (paid LLM spend) fail CLOSED rather than falling
  // back to a scriptable per-instance budget during a misconfig/outage.
  if (opts?.failClosed) return true;

  // Transient outage only — tighten (or refuse under STRICT).
  if (reason === "error") {
    if (process.env.RATE_LIMIT_STRICT === "1") return true;
    // Fail-open (degraded): the durable limiter is unreachable, so we drop to a
    // per-instance in-memory budget tightened to DEGRADED_RATE_LIMIT. This is an
    // alertable event — on Vercel each cold-start instance gets a fresh budget,
    // so the effective cap is looser than intended exactly during an outage.
    // No PII: only the failure reason, resulting mode, and numeric caps.
    warnRateLimitFailOpen(reason, "degraded", Math.min(limit, DEGRADED_RATE_LIMIT), windowMs);
    return isRateLimited(
      localKey,
      Date.now(),
      Math.min(limit, DEGRADED_RATE_LIMIT),
      windowMs,
    );
  }

  // missing-rpc / no-client / unknown → full in-memory budget (fail-open wide).
  warnRateLimitFailOpen(reason ?? "unknown", "full", limit, windowMs);
  return isRateLimited(localKey, Date.now(), limit, windowMs);
}

/**
 * Emit ONE structured WARN whenever the durable limiter fails open to the
 * in-memory budget. Distinct from the `console.error` in
 * `checkRateLimitDurableDetailed` (which reports *why* the RPC broke): this line
 * records the *decision* — that we opened the budget and to what mode — so an
 * operator can alert on `event:"rate_limit.fail_open"` in the Vercel runtime log
 * drain (ADR 0007: Vercel owns runtime-log evidence). No key, IP, or handle is
 * logged — the shared logger would redact them anyway, but they never reach it.
 */
function warnRateLimitFailOpen(
  reason: string,
  mode: "degraded" | "full",
  effectiveLimit: number,
  windowMs: number,
): void {
  log("warn", "rate_limit.fail_open", { reason, mode, effectiveLimit, windowMs });
}

export function addPintDrop(drop: PintDrop): void {
  drops.set(drop.venueId, [drop, ...(drops.get(drop.venueId) ?? [])]);
}

/**
 * Duplicate guard (feat/price-drops-v2): has this identity already logged a
 * PRICED drop at this venue on the same London calendar day? One priced
 * observation per venue+identity+day keeps the price signal honest — a single
 * actor can't stack ten "£3 pint" rows at one pub to skew its median. Scans the
 * ORGANIC store only (demo seeds are read-only liveliness, never a dedupe
 * subject) and ignores note-only anecdotes (a memory isn't a price observation).
 * The Supabase backend enforces the same rule against its own rows; this is the
 * in-memory mirror, exactly like the report ledger's two-backend pattern.
 */
export function hasPricedDropToday(
  venueId: string,
  handle: string,
  now: Date = new Date(),
): boolean {
  const who = normalizeViewerHandle(handle);
  if (!who) return false;
  const today = londonDayKey(now);
  return (drops.get(venueId) ?? []).some(
    (d) =>
      d.priceGbp !== null &&
      d.status !== "hidden" &&
      normalizeViewerHandle(d.handle) === who &&
      londonDayKey(d.createdAt) === today,
  );
}

/** Public read: newest-first, visible-only. Demo seeds merge in here — the one
 *  read path — so seeded liveliness rides the same pipe as organic drops. */
export function listVisiblePintDrops(venueId: string): PintDrop[] {
  return [
    ...(drops.get(venueId) ?? []).filter((d) => d.status === "visible"),
    ...demoDropsFor(venueId),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Unscoped public read. `cityId` scopes demo seeds (and organic rows by venue
 * id prefix) so Manchester demo drops never noise the London feed/landing.
 * Defaults to London when omitted.
 */
export function listAllVisiblePintDrops(cityId?: CityId | null): PintDrop[] {
  return Array.from(drops.values())
    .flat()
    .filter((d) => d.status === "visible")
    .filter((d) => dropMatchesCityScope(d.venueId, cityId))
    .concat(demoPintDropsForCity(cityId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ── Visibility gating (issue #29) ────────────────────────────────────────────
// Pure predicates over the (drop, viewer) pair. The STORE applies these after a
// moderation-status filter, so a hidden drop never reaches them. Kept pure +
// exported so they can be unit-tested directly and reused by every read seam.

/** The effective visibility of a drop (old rows / demo seeds → `public`). */
export function visibilityOf(drop: Pick<PintDrop, "visibility">): Visibility {
  return drop.visibility ?? DEFAULT_VISIBILITY;
}

// ViewerContext (the friends-gating requester identity) now lives in the
// browser-safe lib/pintDropShared.ts and is re-exported above.

/**
 * Normalise a handle for viewer-identity + author matching, without importing the
 * profiles module here (lib/pintDrops.ts is the storage-agnostic core and stays
 * dependency-light). Mirrors normalizeHandle: lowercase, strip leading @s, keep
 * [a-z0-9_], cap length. Kept in step with lib/profiles.normalizeHandle. Exported
 * as `normalizeViewerHandle` for the route that builds a ViewerContext.
 */
export function normalizeViewerHandle(raw: string | null | undefined): string {
  return normalizeHandleCore(raw);
}

/** Is the viewer the author of this drop? (Self always sees own drops, in every
 *  lane.) Compares normalised handles — a self-asserted, honest-best-effort
 *  match, not a cryptographic one. */
export function isAuthor(drop: Pick<PintDrop, "handle">, viewer?: ViewerContext): boolean {
  const me = normalizeViewerHandle(viewer?.handle);
  return me !== "" && me === normalizeViewerHandle(drop.handle);
}

/**
 * Friends direction (Social Launch D3 / WP6): a `friends` drop is visible to
 * the author and to MUTUAL follows only. A viewer qualifies when the author's
 * handle is in the viewer's `mutualHandles`. A one-way follower of the author
 * sees nothing friends-only — attaching a face later must not turn stranger
 * follows into "which pub this face is in tonight".
 *
 * Check-ins already use mutuals (`lib/socialFeed.ts`); this aligns pint drops
 * with that definition. `followingHandles` is intentionally unused here (kept
 * for feed ranking only).
 */
export function qualifiesForFriends(
  drop: Pick<PintDrop, "handle">,
  viewer?: ViewerContext,
): boolean {
  const author = normalizeViewerHandle(drop.handle);
  if (!author) return false;
  return Boolean(viewer?.mutualHandles?.has(author));
}

/**
 * Can this viewer see this drop on a PUBLIC surface (feed, map, leaderboard,
 * venue list, permalink)? Applied AFTER the moderation-status filter.
 *
 *   • public     → everyone.
 *   • anonymous  → everyone (the handle is withheld at DTO time, not here).
 *   • friends    → author + mutual follows (qualifiesForFriends).
 *   • legacy     → author ONLY on public surfaces; otherwise the ledger-only
 *                  capability (listLegacyForVenue) surfaces it. Kept out of every
 *                  public signal here.
 */
export function canViewOnPublicSurface(drop: PintDrop, viewer?: ViewerContext): boolean {
  switch (visibilityOf(drop)) {
    case "public":
    case "anonymous":
      return true;
    case "friends":
      return isAuthor(drop, viewer) || qualifiesForFriends(drop, viewer);
    case "legacy":
      return isAuthor(drop, viewer);
    default:
      return true;
  }
}

/**
 * F3 (comments/reactions GET gating): is this drop fit for an UNSCOPED public
 * read — an endpoint that carries NO viewer identity at all (the comments and
 * reactions GETs)? Only a moderation-visible drop in the `public` or
 * `anonymous` lane qualifies. `friends` and `legacy` need a viewer to gate on,
 * and those endpoints have none (true viewer-scoped gating waits for Supabase
 * Auth), so their child content stays server-side rather than leaking to
 * anyone who guesses the drop id. Pure + exported so it is unit-testable and
 * reused by the batched lookup in lib/pintDropLookup.ts.
 */
export function isPubliclyReadableDrop(
  drop: Pick<PintDrop, "status" | "visibility">,
): boolean {
  if (drop.status !== "visible") return false;
  const visibility = visibilityOf(drop as Pick<PintDrop, "visibility">);
  return visibility === "public" || visibility === "anonymous";
}

/**
 * Batched id → drop lookup across the in-memory store (ANY status — a hidden
 * drop must be findable so its children can be gated) plus the demo seeds.
 * One pass over the store regardless of how many ids are asked for, so the
 * comments/reactions visibility gate never does per-id scans.
 */
export function findPintDropsByIds(ids: readonly string[]): Map<string, PintDrop> {
  const wanted = new Set(ids);
  const out = new Map<string, PintDrop>();
  if (wanted.size === 0) return out;
  for (const list of drops.values()) {
    for (const d of list) {
      if (wanted.has(d.id)) out.set(d.id, d);
    }
  }
  for (const d of demoPintDrops) {
    if (wanted.has(d.id) && !out.has(d.id)) out.set(d.id, d);
  }
  return out;
}

/** The in-memory legacy lane for one venue: legacy drops only, visible-only,
 *  newest-first (the ledger-only capability's memory backing). Author-gating on
 *  the ledger is a surface decision; this returns the venue's legacy drops so the
 *  ledger read can adopt it. Demo seeds are all `public`, so none leak in. */
export function listLegacyPintDropsForVenue(venueId: string): PintDrop[] {
  return (drops.get(venueId) ?? [])
    .filter((d) => d.status === "visible" && visibilityOf(d) === "legacy")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function findDrop(id: string): PintDrop | undefined {
  for (const list of drops.values()) {
    const hit = list.find((d) => d.id === id);
    if (hit) return hit;
  }
  return undefined;
}

// Report-abuse policy (launch PRD): anonymous reports record moderation
// metadata but never count toward hiding. The drop leaves public reads only
// after this many distinct verified accounts report it.
export const REPORT_HIDE_THRESHOLD = 2;

export type PintDropReportIdentity =
  | { kind: "verified_account"; actorHash: string }
  | { kind: "anonymous_ip"; actorHash: string };

// Per-actor report ledger (memory mirror of pint_drop_verified_reports' unique
// (pint_drop_id, actor_hash) - migration 0112): drop id to the set of
// actor keys that already reported it. Include identity kind in the key so an
// anonymous IP report can never consume the same actor key as a verified
// account report. A same-actor duplicate is an idempotent no-op. Anonymous
// reports never advance the verified counter.
const reportedActorsByDrop = new Map<string, Set<string>>();
const verifiedReportCountsByDrop = new Map<string, number>();

export function reportPintDrop(
  id: string,
  reason: string | undefined,
  identity: PintDropReportIdentity,
): boolean {
  const hit = findDrop(id);
  if (!hit) return false;

  const seen = reportedActorsByDrop.get(id) ?? new Set<string>();
  const actorKey = `${identity.kind}:${identity.actorHash}`;
  if (seen.has(actorKey)) return true;
  seen.add(actorKey);
  reportedActorsByDrop.set(id, seen);

  hit.reportedAt = new Date().toISOString();
  if (reason) hit.reportReason = reason;
  // A report reopens only after an actual moderator decision. A threshold
  // auto-hide has no moderatedAt stamp, so keep it hidden until a moderator
  // explicitly reviews it. This prevents anonymous reports from undoing the
  // verified-account threshold.
  if (hit.moderatedAt) {
    hit.moderatedAt = undefined;
    hit.moderatorNote = undefined;
  }
  if (identity.kind === "anonymous_ip") return true;

  const verifiedCount = (verifiedReportCountsByDrop.get(id) ?? 0) + 1;
  verifiedReportCountsByDrop.set(id, verifiedCount);
  if (verifiedCount >= REPORT_HIDE_THRESHOLD) hit.status = "hidden";
  return true;
}

/**
 * Return the in-memory count that may advance automatic Pint Drop hiding.
 * Legacy `reportCount` values stay on the drop as moderation history and are
 * never used as this counter's starting value.
 */
export function verifiedPintDropReportCount(id: string): number | undefined {
  return verifiedReportCountsByDrop.get(id);
}

/** Moderator read: every drop in a status, across venues, newest-first. */
export function listByStatus(status: PintDropStatus): PintDrop[] {
  return Array.from(drops.values())
    .flat()
    .filter((d) => d.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Moderator review queue for visible rows reported by an anonymous actor.
 * Anonymous reports never advance the verified-only hide counter, so these
 * rows need an explicit human lane instead of being mistaken for ordinary
 * public reads. Reporter identity stays in the server-side report ledger. */
export function listReportedPintDrops(): PintDrop[] {
  return Array.from(drops.values())
    .flat()
    .filter((d) => d.status === "visible" && Boolean(d.reportedAt) && !d.moderatedAt)
    .sort((a, b) =>
      (b.reportedAt ?? b.createdAt).localeCompare(a.reportedAt ?? a.createdAt),
    );
}

/** Moderator action: return a drop to visible and stamp the review time. */
export function restorePintDrop(id: string, note?: string): boolean {
  const hit = findDrop(id);
  if (!hit) return false;
  hit.status = "visible";
  hit.moderatedAt = new Date().toISOString();
  if (note) hit.moderatorNote = note;
  return true;
}

/** Moderator action: leave hidden and record the reversible decision. */
export function keepHiddenPintDrop(id: string, note?: string): boolean {
  const hit = findDrop(id);
  if (!hit) return false;
  hit.status = "hidden";
  hit.moderatedAt = new Date().toISOString();
  if (note) hit.moderatorNote = note;
  return true;
}

// Test-only: reset process state between cases.
export function __resetPintDrops(): void {
  drops.clear();
  rateWindow.clear();
  reportedActorsByDrop.clear();
  verifiedReportCountsByDrop.clear();
}
