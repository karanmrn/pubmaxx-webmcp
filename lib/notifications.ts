// Notification model — the shared vocabulary + the best-effort EMIT helper the
// write paths call. Types + validation live here (no store import), so a route
// can import the emit seam without pulling the storage backend into scope until
// it is actually used.
//
// A notification is keyed by the recipient's self-asserted `handle` (no auth yet
// — same trust boundary as the rest of the social layer). It carries only signal
// that is already public in the feed: someone followed you, reacted to your drop,
// commented on your drop, or saved your crawl. No private content. See
// supabase/migrations/0010_notifications.sql for the honest low-sensitivity note.

import { normalizeHandle } from "@/lib/profiles";
import { cleanText } from "@/lib/textClean";

// The four event kinds a notification can carry. Kept in lockstep with the
// notifications_kind_chk constraint in migration 0010.
export const NOTIFICATION_KINDS = ["follow", "reaction", "comment", "crawl_save"] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

const KIND_SET: ReadonlySet<string> = new Set(NOTIFICATION_KINDS);
export function isNotificationKind(value: unknown): value is NotificationKind {
  return typeof value === "string" && KIND_SET.has(value);
}

// The public DTO a recipient's inbox renders. `subjectRef` is an opaque pointer
// the read side turns into a link (a drop id, a crawl slug, the actor handle);
// `subjectLabel` is a short human hint (a pub name, a crawl title) resolved at
// emit time so the read side never needs a second lookup.
export type NotificationDTO = {
  id: string;
  actorHandle: string;
  kind: NotificationKind;
  subjectRef?: string;
  subjectLabel?: string;
  createdAt: string;
  read: boolean;
};

// The write payload. Every field is re-cleaned at the store boundary; the emit
// helper below is the one call site the write paths use.
export type NewNotification = {
  recipientHandle: string;
  actorHandle: string;
  kind: NotificationKind;
  subjectRef?: string;
  subjectLabel?: string;
};

const MAX_SUBJECT_REF = 200;
const MAX_SUBJECT_LABEL = 120;

/**
 * Normalise an untrusted notification. Returns null when it can't be delivered:
 * a missing/blank recipient or actor handle, an unknown kind, or a self-directed
 * event (you don't get notified about your own action). A self-notification is
 * dropped here so no write path needs to special-case it.
 */
export function cleanNotification(input: NewNotification): NewNotification | null {
  const recipientHandle = normalizeHandle(input.recipientHandle);
  const actorHandle = normalizeHandle(input.actorHandle);
  if (!recipientHandle || !actorHandle) return null;
  if (recipientHandle === actorHandle) return null; // never notify yourself
  if (!isNotificationKind(input.kind)) return null;
  const subjectRef = cleanText(input.subjectRef, MAX_SUBJECT_REF);
  const subjectLabel = cleanText(input.subjectLabel, MAX_SUBJECT_LABEL);
  return {
    recipientHandle,
    actorHandle,
    kind: input.kind,
    ...(subjectRef ? { subjectRef } : {}),
    ...(subjectLabel ? { subjectLabel } : {}),
  };
}
