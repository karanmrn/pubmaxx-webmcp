import "server-only";

// Durable notifications / activity feed. ONE store interface, TWO implementations
// (process-memory + Supabase public.notifications), the exact dual-backend seam
// pattern as reactions/comments/saved-pubs: Supabase when env keys exist,
// process-memory otherwise, chosen at the single notificationsStore() seam.
//
// The WRITE side is best-effort by contract: emit() NEVER throws — a failed
// notification must never fail the parent write (a follow, a reaction, a comment,
// a crawl save). A store error is logged and swallowed so the social action still
// succeeds. The READ side (list + unread count) is likewise fail-soft: an outage
// renders as an empty inbox, never a 500 on the bell / activity page.
//
// Identity is the self-asserted handle (no auth). A notification carries only
// already-public feed signal (see lib/notifications.ts), so keying reads by a
// self-asserted recipient handle is acceptable low-sensitivity exposure — noted
// honestly here and in the migration.

import {
  cleanNotification,
  isNotificationKind,
  type NewNotification,
  type NotificationDTO,
  type NotificationKind,
} from "@/lib/notifications";
import {
  canViewOnPublicSurface,
  cleanVisibility,
  findPintDropsByIds,
  type PintDrop,
  type PintDropStatus,
  type ViewerContext,
} from "@/lib/pintDrops";
import { normalizeHandle } from "@/lib/profiles";
import { PINT_DROPS_TABLE } from "@/lib/pintDropTable";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";
import { selectStore } from "@/lib/storeBackend";

// A recipient's inbox: newest-first list + how many are unread. Hard-capped so
// one busy handle can't return an unbounded list.
export const MAX_NOTIFICATIONS = 100;

export type Inbox = { notifications: NotificationDTO[]; unread: number };

export type NotificationsStore = {
  /** Best-effort emit. NEVER throws — a failure is logged + swallowed so the
   *  parent social write always succeeds. Returns true when a row was written. */
  emit(input: NewNotification): Promise<boolean>;
  /** A recipient's inbox (newest-first, capped) + unread count. Never throws. */
  list(recipientHandle: string): Promise<Inbox>;
  /** Mark a recipient's notifications read: one id, or all when id is omitted.
   *  Returns the fresh inbox. Never throws. */
  markRead(recipientHandle: string, id?: string): Promise<Inbox>;
};

const TABLE = "notifications";

// Kinds whose subjectRef points at a pint drop id — parent-drop visibility
// must cascade here so a hidden/friends/legacy drop never surfaces via inbox.
const DROP_LINKED_KINDS: ReadonlySet<NotificationKind> = new Set(["reaction", "comment"]);

function admin() {
  return requireSupabaseAdmin();
}

function isDropLinkedKind(kind: NotificationKind): boolean {
  return DROP_LINKED_KINDS.has(kind);
}

/** Resolve drops for the notification gate — ANY status so hidden parents gate. */
async function lookupPintDropsByIds(ids: readonly string[]): Promise<Map<string, PintDrop>> {
  const wanted = [...new Set(ids.map((id) => (typeof id === "string" ? id.trim() : "")).filter(Boolean))];
  const found = findPintDropsByIds(wanted);
  if (!isSupabaseConfigured()) return found;

  const missing = wanted.filter((id) => !found.has(id));
  if (missing.length === 0) return found;

  try {
    const { data, error } = await admin()
      .from(PINT_DROPS_TABLE)
      .select("id,status,visibility,handle")
      .in("id", missing);
    if (error) throw new Error(error.message);
    for (const row of data ?? []) {
      const id = String((row as { id?: unknown }).id ?? "");
      if (!id) continue;
      found.set(id, {
        id,
        venueId: "",
        handle: String((row as { handle?: unknown }).handle ?? ""),
        drink: "",
        priceGbp: null,
        passedDownNote: "",
        era: "",
        provenance: "anecdote",
        status: String((row as { status?: unknown }).status ?? "") as PintDropStatus,
        visibility: cleanVisibility((row as { visibility?: unknown }).visibility),
        createdAt: new Date(0).toISOString(),
      });
    }
  } catch {
    // Fail closed: treat unresolved ids as gated when Supabase lookup fails.
    for (const id of missing) found.set(id, { ...GATED_STUB, id });
  }
  return found;
}

// Minimal stub used only when a Supabase lookup fails — status hidden so the
// parent-child gate drops any notification referencing the id.
const GATED_STUB: PintDrop = {
  id: "",
  venueId: "",
  handle: "",
  drink: "",
  priceGbp: null,
  passedDownNote: "",
  era: "",
  provenance: "anecdote",
  status: "hidden",
  visibility: "public",
  createdAt: new Date(0).toISOString(),
};

function isDropNotificationPermitted(drop: PintDrop, recipientHandle: string): boolean {
  if (drop.status !== "visible") return false;
  const viewer: ViewerContext = { handle: normalizeHandle(recipientHandle) };
  return canViewOnPublicSurface(drop, viewer);
}

/** Parent-child visibility gate for drop-linked inbox rows. Pure over resolved drops. */
export function filterDropLinkedNotifications(
  dtos: NotificationDTO[],
  resolved: ReadonlyMap<string, PintDrop>,
  recipientHandle: string,
): NotificationDTO[] {
  const viewer: ViewerContext = { handle: normalizeHandle(recipientHandle) };
  return dtos.filter((n) => {
    if (!isDropLinkedKind(n.kind) || !n.subjectRef) return true;
    const drop = resolved.get(n.subjectRef);
    // Unresolvable id — nothing to leak; keep for demo ergonomics.
    if (!drop) return true;
    if (drop.status !== "visible") return false;
    return canViewOnPublicSurface(drop, viewer);
  });
}

async function gatedInbox(dtos: NotificationDTO[], recipientHandle: string): Promise<Inbox> {
  const dropIds = dtos
    .filter((n) => isDropLinkedKind(n.kind) && n.subjectRef)
    .map((n) => n.subjectRef as string);
  const resolved = dropIds.length > 0 ? await lookupPintDropsByIds(dropIds) : new Map<string, PintDrop>();
  return inboxFrom(filterDropLinkedNotifications(dtos, resolved, recipientHandle));
}

async function dropLinkedEmitPermitted(clean: NewNotification): Promise<boolean> {
  if (!isDropLinkedKind(clean.kind) || !clean.subjectRef) return true;
  const resolved = await lookupPintDropsByIds([clean.subjectRef]);
  const drop = resolved.get(clean.subjectRef);
  if (!drop) return true;
  return isDropNotificationPermitted(drop, clean.recipientHandle);
}

// Map a raw row → the public DTO. The single choke point that shapes the inbox.
function toDTO(row: Record<string, unknown>): NotificationDTO | null {
  const kind = row.kind;
  if (!isNotificationKind(kind)) return null;
  return {
    id: String(row.id),
    actorHandle: String(row.actor_handle ?? ""),
    kind: kind as NotificationKind,
    subjectRef: row.subject_ref ? String(row.subject_ref) : undefined,
    subjectLabel: row.subject_label ? String(row.subject_label) : undefined,
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
    read: row.read_at != null,
  };
}

function inboxFrom(dtos: NotificationDTO[]): Inbox {
  return { notifications: dtos, unread: dtos.filter((n) => !n.read).length };
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabaseNotificationsStore: NotificationsStore = {
  async emit(input) {
    const clean = cleanNotification(input);
    if (!clean) return false;
    if (!(await dropLinkedEmitPermitted(clean))) return false;
    try {
      const { error } = await admin().from(TABLE).insert({
        recipient_handle: clean.recipientHandle,
        actor_handle: clean.actorHandle,
        kind: clean.kind,
        subject_ref: clean.subjectRef ?? null,
        subject_label: clean.subjectLabel ?? null,
      });
      if (error) throw new Error(error.message);
      return true;
    } catch (err) {
      // Best-effort: never let a notification failure break the parent write.
      console.error(
        "[notifications] emit failed (parent write unaffected):",
        err instanceof Error ? err.message : err,
      );
      return false;
    }
  },

  async list(recipientHandle) {
    const key = normalizeHandle(recipientHandle);
    if (!key) return { notifications: [], unread: 0 };
    try {
      const { data, error } = await admin()
        .from(TABLE)
        .select("id, actor_handle, kind, subject_ref, subject_label, created_at, read_at")
        .eq("recipient_handle", key)
        .order("created_at", { ascending: false })
        .limit(MAX_NOTIFICATIONS);
      if (error) throw new Error(error.message);
      const dtos = (data ?? [])
        .map((r) => toDTO(r as Record<string, unknown>))
        .filter((d): d is NotificationDTO => d !== null);
      return gatedInbox(dtos, key);
    } catch (err) {
      console.error(
        "[notifications] list failed — returning empty inbox:",
        err instanceof Error ? err.message : err,
      );
      return { notifications: [], unread: 0 };
    }
  },

  async markRead(recipientHandle, id) {
    const key = normalizeHandle(recipientHandle);
    if (!key) return { notifications: [], unread: 0 };
    try {
      let update = admin()
        .from(TABLE)
        .update({ read_at: new Date().toISOString() })
        .eq("recipient_handle", key)
        .is("read_at", null);
      if (id) update = update.eq("id", id);
      const { error } = await update;
      if (error) throw new Error(error.message);
    } catch (err) {
      console.error(
        "[notifications] markRead failed:",
        err instanceof Error ? err.message : err,
      );
    }
    return this.list(key);
  },
};

// ── In-memory implementation ─────────────────────────────────────────────────
// Map<recipientHandle, MemoryRow[]>, resets on restart — right for dev/demo/test.
type MemoryRow = {
  id: string;
  actorHandle: string;
  kind: NotificationKind;
  subjectRef?: string;
  subjectLabel?: string;
  createdAt: string;
  readAt: string | null;
};

const memoryRows = new Map<string, MemoryRow[]>();
let memorySeq = 0;

function memoryToDTO(row: MemoryRow): NotificationDTO {
  return {
    id: row.id,
    actorHandle: row.actorHandle,
    kind: row.kind,
    ...(row.subjectRef ? { subjectRef: row.subjectRef } : {}),
    ...(row.subjectLabel ? { subjectLabel: row.subjectLabel } : {}),
    createdAt: row.createdAt,
    read: row.readAt != null,
  };
}

export const memoryNotificationsStore: NotificationsStore = {
  async emit(input) {
    const clean = cleanNotification(input);
    if (!clean) return false;
    if (!(await dropLinkedEmitPermitted(clean))) return false;
    const row: MemoryRow = {
      id: `n${++memorySeq}`,
      actorHandle: clean.actorHandle,
      kind: clean.kind,
      ...(clean.subjectRef ? { subjectRef: clean.subjectRef } : {}),
      ...(clean.subjectLabel ? { subjectLabel: clean.subjectLabel } : {}),
      // Distinct, monotonic timestamps so newest-first ordering is stable even
      // when two events land in the same millisecond.
      createdAt: new Date(Date.now() + memorySeq).toISOString(),
      readAt: null,
    };
    const list = memoryRows.get(clean.recipientHandle) ?? [];
    list.push(row);
    memoryRows.set(clean.recipientHandle, list);
    return true;
  },

  async list(recipientHandle) {
    const key = normalizeHandle(recipientHandle);
    if (!key) return { notifications: [], unread: 0 };
    const rows = (memoryRows.get(key) ?? [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) // newest-first
      .slice(0, MAX_NOTIFICATIONS)
      .map(memoryToDTO);
    return gatedInbox(rows, key);
  },

  async markRead(recipientHandle, id) {
    const key = normalizeHandle(recipientHandle);
    if (!key) return { notifications: [], unread: 0 };
    const rows = memoryRows.get(key) ?? [];
    const now = new Date().toISOString();
    for (const row of rows) {
      if (row.readAt != null) continue;
      if (id && row.id !== id) continue;
      row.readAt = now;
    }
    return this.list(key);
  },
};

/** The single backend selection point (mirrors the other stores). */
export function notificationsStore(): NotificationsStore {
  return selectStore(memoryNotificationsStore, supabaseNotificationsStore);
}

/**
 * The best-effort EMIT seam the write paths call. Fire-and-forget friendly: it
 * NEVER rejects (the store's emit already swallows errors, and this wraps a
 * belt-and-braces try/catch), so a caller can `void emitNotification(...)`
 * without a floating-rejection risk. A failed notification never fails the parent
 * write — that is the whole contract.
 */
export async function emitNotification(input: NewNotification): Promise<void> {
  try {
    await notificationsStore().emit(input);
  } catch (err) {
    console.error(
      "[notifications] emit seam swallowed error (parent write unaffected):",
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Resolve the owner handle of a persisted pint drop, so a reaction/comment can be
 * addressed to the drop's author. Fail-soft: returns null on any miss (unknown id,
 * demo seed, storage down) — the caller then simply doesn't emit (a notification
 * we can't address is dropped, never an error). Supabase path reads only the
 * `handle` column of pint_drops; the memory path scans the in-memory drops.
 */
export async function dropOwnerHandle(dropId: string): Promise<string | null> {
  const id = typeof dropId === "string" ? dropId.trim() : "";
  if (!id) return null;
  if (isSupabaseConfigured()) {
    try {
      const { data, error } = await admin()
        .from(PINT_DROPS_TABLE)
        .select("handle")
        .eq("id", id)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const handle = data ? normalizeHandle(String((data as { handle?: unknown }).handle ?? "")) : "";
      return handle || null;
    } catch {
      return null;
    }
  }
  // Memory path: the in-memory drops live in lib/pintDrops. Import lazily so this
  // server-only lookup never pulls the drops module into a client bundle.
  try {
    const { findPintDropsByIds } = await import("@/lib/pintDrops");
    const hit = findPintDropsByIds([id]).get(id);
    if (!hit || hit.status !== "visible") return null;
    return normalizeHandle(hit.handle) || null;
  } catch {
    return null;
  }
}

/** Test-only: clear the in-memory notification map between cases. */
export function __resetMemoryNotifications(): void {
  memoryRows.clear();
  memorySeq = 0;
}
