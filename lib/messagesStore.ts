import "server-only";

// Durable 1:1 messaging store. ONE store interface, TWO implementations
// (process-memory + Supabase public.conversations/messages), the same dual-backend
// seam as notifications/reactions/comments: Supabase when env keys exist,
// process-memory otherwise, chosen at the single messagesStore() seam.
//
// ─────────────────────────────────────────────────────────────────────────────
// COURTESY-CURTAIN, NOT PRIVACY. Identity is a self-asserted `handle` (no auth).
// The store enforces the participant check on reads (a non-participant gets
// nothing back), but that check trusts the asserted handle — it is a courtesy
// curtain, not cryptographic privacy. Reads are DENY-ALL at the DB (RLS on, no
// policy — migration 0019); ALL access goes through the service-role admin client
// here. Keep content low-sensitivity by design; `report` is the abuse seam.
// ─────────────────────────────────────────────────────────────────────────────
//
// The WRITE path (send) surfaces real failures to the route (a dropped message
// must not silently vanish). The READ path (list/messages) is fail-soft: an
// outage renders as an empty inbox / empty thread, never a 500.

import {
  isMessagePhotoServingKey,
  MESSAGE_ATTACHMENT_KINDS,
  messageAttachmentPreview,
  messagePhotoServePath,
  messagePhotoServingKey,
  type MessageAttachment,
  type MessageAttachmentKind,
  type MessageAttachmentWrite,
} from "@/lib/messageAttachments";
import {
  cleanAttachedBody,
  cleanBody,
  isParticipant,
  normalizePair,
  unreadForViewer,
  type ConversationDTO,
  type HandlePair,
  type MessageDTO,
} from "@/lib/messages";
import { normalizeHandle } from "@/lib/profiles";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { selectStore } from "@/lib/storeBackend";

// Hard caps so one busy handle can't return an unbounded payload.
export const MAX_CONVERSATIONS = 100;
export const MAX_MESSAGES = 200;

export type MessagesStore = {
  /** Find-or-create the conversation for an unordered pair. Returns the
   *  conversation id, or null when the pair is invalid (blank / self-pair). */
  openConversation(a: string, b: string): Promise<string | null>;
  /** Append a message. `sender` must be a participant of the conversation and
   *  the message must carry SOMETHING: a body that survives cleaning, an
   *  attachment, or both. Returns the new MessageDTO, or null on any reject
   *  (unknown conversation, non-participant sender, nothing to send).
   *
   *  A PHOTO attachment brings its own id, minted by the writer BEFORE the bytes
   *  were staged, because the storage key is built from it. Passing it
   *  explicitly is what keeps the row and its object in agreement: deriving one
   *  from the other would let a write drift into a row whose serve route 404s. */
  send(
    conversationId: string,
    sender: string,
    body: string,
    attachment?: MessageAttachmentWrite,
  ): Promise<MessageDTO | null>;
  /** A handle's inbox: newest-first conversations with last-message preview +
   *  per-viewer unread count. Never throws (empty on error). */
  listConversations(handle: string): Promise<ConversationDTO[]>;
  /** A conversation's thread, oldest-first, ONLY IF `handle` is a participant.
   *  A non-participant (or unknown conversation) gets null — the caller turns
   *  that into a 404 so a thread never leaks. Marks the viewer's received
   *  messages read as a side effect. Never throws on a valid participant read. */
  listMessages(conversationId: string, handle: string): Promise<MessageDTO[] | null>;
  /** Flag a message for the admin queue (abuse seam). Returns true when a row was
   *  flagged. Reuses the moderation posture — the message is marked, not deleted. */
  report(
    conversationId: string,
    messageId: string,
    reporterHandle: string,
  ): Promise<boolean>;
  /** The serving key of ONE message photo, only for a participant, and only
   *  while the message is unflagged. Null for everything else — an unknown id,
   *  an outsider, a text message and a reported photo answer alike, so the
   *  refusal says nothing about which of them it was. Reading a photo is NOT
   *  reading the thread, so this never marks anything read. */
  photoObjectKey(
    conversationId: string,
    messageId: string,
    handle: string,
  ): Promise<string | null>;
};

const CONVERSATIONS = "conversations";
const MESSAGES = "messages";
const memoryFallbackWarnings = new Set<string>();

// ONE column list behind every message read, so a lane that forgot the
// attachment columns cannot quietly serve a photo message as a bare line of
// text — the same reason the public profile has one projection.
const MESSAGE_COLUMNS =
  "id, conversation_id, sender_handle, body, created_at, read_at, flagged_at, " +
  "attachment_kind, attachment_object_key, attachment_width, attachment_height, attachment_venue_id";

/**
 * The inbox preview for one last message. Words when there are words; otherwise
 * the noun for what it carried, because a blank row reads as a message that did
 * not arrive.
 */
function previewBody(body: string, kind: unknown): string {
  if (body) return body;
  return MESSAGE_ATTACHMENT_KINDS.includes(kind as MessageAttachmentKind)
    ? messageAttachmentPreview(kind as MessageAttachmentKind)
    : "";
}

/** The insert half of the same list. A message with no attachment writes nulls. */
function attachmentColumns(
  attachment: MessageAttachmentWrite | undefined,
): Record<string, unknown> {
  if (!attachment) return {};
  if (attachment.kind === "venue") {
    return { attachment_kind: "venue", attachment_venue_id: attachment.venueId };
  }
  return {
    id: attachment.messageId,
    attachment_kind: "photo",
    attachment_object_key: attachment.objectKey,
    attachment_width: attachment.width,
    attachment_height: attachment.height,
  };
}

/**
 * The stored columns, read back as the thread's attachment.
 *
 * A FLAGGED message carries none: a report is the lane that takes a message
 * photo down, and the row plus its provenance stay for a moderator while the
 * picture stops travelling. The serving key is rebuilt from the row's own ids
 * rather than trusted off it, so a hand-edited object_key cannot make the serve
 * route read somebody else's object.
 */
function rowToAttachment(row: Record<string, unknown>): MessageAttachment | undefined {
  if (row.flagged_at != null) return undefined;
  const kind = row.attachment_kind;
  if (kind === "venue") {
    const venueId = typeof row.attachment_venue_id === "string" ? row.attachment_venue_id : "";
    return venueId ? { kind: "venue", venueId, card: null } : undefined;
  }
  if (kind !== "photo") return undefined;
  const conversationId = String(row.conversation_id ?? "");
  const messageId = String(row.id ?? "");
  const objectKey = typeof row.attachment_object_key === "string" ? row.attachment_object_key : "";
  if (!isMessagePhotoServingKey(conversationId, messageId, objectKey)) return undefined;
  const width = Number(row.attachment_width);
  const height = Number(row.attachment_height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return {
    kind: "photo",
    url: messagePhotoServePath(conversationId, messageId),
    width,
    height,
  };
}

function admin() {
  return requireSupabaseAdmin();
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isMissingMessagesSchema(err: unknown): boolean {
  return /Could not find the table 'public\.(conversations|messages)'|relation "public\.(conversations|messages)" does not exist|schema cache/i.test(
    errorMessage(err),
  );
}

// A memory-minted conversation id is `c` followed by a decimal sequence number
// and nothing else (see memoryMessagesStore.openConversation). A durable id is a
// Postgres UUID, and `c` is a hex digit, so a bare `startsWith("c")` claimed one
// durable conversation in sixteen for the empty in-memory store. Match the whole
// shape instead: a UUID always carries hyphens, so it can never satisfy this.
const MEMORY_CONVERSATION_ID = /^c\d+$/;

export function isMemoryConversationId(conversationId: string): boolean {
  return MEMORY_CONVERSATION_ID.test(conversationId);
}

function warnMemoryFallback(context: string, err: unknown): void {
  if (memoryFallbackWarnings.has(context)) return;
  memoryFallbackWarnings.add(context);
  console.warn(
    `[messages] ${context} durable table missing — using process-memory fallback (apply migration 0019):`,
    errorMessage(err),
  );
}

// ── Supabase implementation ──────────────────────────────────────────────────
export const supabaseMessagesStore: MessagesStore = {
  async openConversation(a, b) {
    const pair = normalizePair(a, b);
    if (!pair) return null;
    try {
      // Upsert-then-select: insert the pair, ignore a unique-conflict, then read
      // the (existing or new) row's id. One extra round trip but keeps the id
      // stable across concurrent opens.
      const { error: upErr } = await admin()
        .from(CONVERSATIONS)
        .upsert(
          { handle_a: pair.handleA, handle_b: pair.handleB },
          { onConflict: "handle_a,handle_b", ignoreDuplicates: true },
        );
      if (upErr) throw new Error(upErr.message);
      const { data, error } = await admin()
        .from(CONVERSATIONS)
        .select("id")
        .eq("handle_a", pair.handleA)
        .eq("handle_b", pair.handleB)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? String((data as { id: unknown }).id) : null;
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("openConversation", err);
        return memoryMessagesStore.openConversation(a, b);
      }
      console.error(
        "[messages] openConversation failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  },

  async send(conversationId, sender, body, attachment) {
    const senderHandle = normalizeHandle(sender);
    const clean = attachment ? cleanAttachedBody(body) : cleanBody(body);
    if (!conversationId || !senderHandle || clean === null) return null;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.send(conversationId, senderHandle, clean, attachment);
    }
    try {
      const pair = await loadPair(conversationId);
      if (!pair || !isParticipant(pair, senderHandle)) return null;
      const { data, error } = await admin()
        .from(MESSAGES)
        .insert({
          conversation_id: conversationId,
          sender_handle: senderHandle,
          body: clean,
          ...attachmentColumns(attachment),
        })
        .select(MESSAGE_COLUMNS)
        .single();
      if (error) throw new Error(error.message);
      // Bump the denormalised inbox-sort timestamp. Best-effort — the message is
      // already stored; a failed bump only affects ordering.
      await admin()
        .from(CONVERSATIONS)
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
      return rowToMessageDTO(data as unknown as Record<string, unknown>);
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("send", err);
        return memoryMessagesStore.send(conversationId, senderHandle, clean, attachment);
      }
      console.error("[messages] send failed:", err instanceof Error ? err.message : err);
      return null;
    }
  },

  async listConversations(handle) {
    const me = normalizeHandle(handle);
    if (!me) return [];
    try {
      const { data, error } = await admin()
        .from(CONVERSATIONS)
        .select("id, handle_a, handle_b, last_message_at")
        .or(`handle_a.eq.${me},handle_b.eq.${me}`)
        .order("last_message_at", { ascending: false })
        .limit(MAX_CONVERSATIONS);
      if (error) throw new Error(error.message);
      const rows = (data ?? []) as Array<Record<string, unknown>>;
      // For each conversation resolve the last message + the viewer's unread
      // count. Done per-row; fine at the 100-conversation cap.
      const out: ConversationDTO[] = [];
      for (const row of rows) {
        const id = String(row.id);
        const other =
          normalizeHandle(String(row.handle_a)) === me
            ? String(row.handle_b)
            : String(row.handle_a);
        const { data: msgs } = await admin()
          .from(MESSAGES)
          .select("sender_handle, body, created_at, read_at, attachment_kind")
          .eq("conversation_id", id)
          .order("created_at", { ascending: false })
          .limit(MAX_MESSAGES);
        const list = (msgs ?? []) as Array<Record<string, unknown>>;
        const last = list[0];
        out.push({
          id,
          otherHandle: normalizeHandle(other),
          ...(last
            ? { lastBody: previewBody(String(last.body ?? ""), last.attachment_kind) }
            : {}),
          lastAt: String(row.last_message_at ?? new Date(0).toISOString()),
          lastFromMe: last ? normalizeHandle(String(last.sender_handle)) === me : false,
          unread: unreadForViewer(
            list.map((m) => ({
              senderHandle: String(m.sender_handle ?? ""),
              read: m.read_at != null,
            })),
            me,
          ),
        });
      }
      return out;
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("listConversations", err);
        return memoryMessagesStore.listConversations(me);
      }
      console.error(
        "[messages] listConversations failed — empty inbox:",
        err instanceof Error ? err.message : err,
      );
      return [];
    }
  },

  async listMessages(conversationId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !me) return null;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.listMessages(conversationId, me);
    }
    try {
      const pair = await loadPair(conversationId);
      // COURTESY CHECK: a non-participant (or unknown conversation) gets null →
      // the route turns that into a 404. Never return another pair's thread.
      if (!pair || !isParticipant(pair, me)) return null;
      const { data, error } = await admin()
        .from(MESSAGES)
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: false })
        .limit(MAX_MESSAGES);
      if (error) throw new Error(error.message);
      const rows = ((data ?? []) as unknown as Array<Record<string, unknown>>).reverse();
      // Mark the viewer's RECEIVED (not own) unread messages read. Best-effort.
      await admin()
        .from(MESSAGES)
        .update({ read_at: new Date().toISOString() })
        .eq("conversation_id", conversationId)
        .neq("sender_handle", me)
        .is("read_at", null);
      return rows.map((r) => rowToMessageDTO(r));
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("listMessages", err);
        return memoryMessagesStore.listMessages(conversationId, me);
      }
      console.error(
        "[messages] listMessages failed:",
        err instanceof Error ? err.message : err,
      );
      // A participant we already verified hitting a transient read error gets an
      // empty thread, not a leak and not a 500.
      return [];
    }
  },

  async report(conversationId, messageId, reporterHandle) {
    const reporter = normalizeHandle(reporterHandle);
    if (!conversationId || !messageId || !reporter) return false;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.report(conversationId, messageId, reporter);
    }
    try {
      const { data, error } = await admin()
        .from(MESSAGES)
        .update({ flagged_at: new Date().toISOString(), flagged_by: reporter })
        .eq("conversation_id", conversationId)
        .eq("id", messageId)
        .is("flagged_at", null)
        .select("id");
      if (error) throw new Error(error.message);
      return Array.isArray(data) && data.length > 0;
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("report", err);
        return memoryMessagesStore.report(conversationId, messageId, reporter);
      }
      console.error("[messages] report failed:", err instanceof Error ? err.message : err);
      return false;
    }
  },

  async photoObjectKey(conversationId, messageId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !messageId || !me) return null;
    if (isMemoryConversationId(conversationId)) {
      return memoryMessagesStore.photoObjectKey(conversationId, messageId, me);
    }
    try {
      const pair = await loadPair(conversationId);
      // COURTESY CHECK, the same one the thread read makes. A non-participant
      // never learns whether the id exists.
      if (!pair || !isParticipant(pair, me)) return null;
      const { data, error } = await admin()
        .from(MESSAGES)
        .select(MESSAGE_COLUMNS)
        .eq("conversation_id", conversationId)
        .eq("id", messageId)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return photoKeyFromRow(data as unknown as Record<string, unknown>);
    } catch (err) {
      if (isMissingMessagesSchema(err)) {
        warnMemoryFallback("photoObjectKey", err);
        return memoryMessagesStore.photoObjectKey(conversationId, messageId, me);
      }
      console.error(
        "[messages] photoObjectKey failed:",
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  },
};

// The serving key a row is allowed to hand out, through the SAME attachment
// projection the thread reads — so a reported photo, a text message and a
// mismatched key are one answer here exactly as they are there.
function photoKeyFromRow(row: Record<string, unknown>): string | null {
  const attachment = rowToAttachment(row);
  if (!attachment || attachment.kind !== "photo") return null;
  return messagePhotoServingKey(String(row.conversation_id ?? ""), String(row.id ?? ""));
}

// Resolve a conversation's handle pair (for the participant check). Returns null
// on any miss. Kept private to the Supabase path.
async function loadPair(conversationId: string): Promise<HandlePair | null> {
  const { data, error } = await admin()
    .from(CONVERSATIONS)
    .select("handle_a, handle_b")
    .eq("id", conversationId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as { handle_a: unknown; handle_b: unknown };
  return normalizePair(String(row.handle_a), String(row.handle_b));
}

function rowToMessageDTO(row: Record<string, unknown>): MessageDTO {
  const attachment = rowToAttachment(row);
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id ?? ""),
    senderHandle: normalizeHandle(String(row.sender_handle ?? "")),
    body: String(row.body ?? ""),
    createdAt: String(row.created_at ?? new Date(0).toISOString()),
    read: row.read_at != null,
    flagged: row.flagged_at != null,
    ...(attachment ? { attachment } : {}),
  };
}

// ── In-memory implementation ─────────────────────────────────────────────────
// Two flat maps keyed by conversation id, resets on restart — right for
// dev/demo/test. The pair-key index maps "a|b" → conversation id so open is O(1).
type MemoryConversation = {
  id: string;
  handleA: string;
  handleB: string;
  lastMessageAt: string;
};
type MemoryMessage = {
  id: string;
  conversationId: string;
  senderHandle: string;
  body: string;
  createdAt: string;
  readAt: string | null;
  flaggedAt: string | null;
  flaggedBy: string | null;
  attachmentKind: string | null;
  attachmentObjectKey: string | null;
  attachmentWidth: number | null;
  attachmentHeight: number | null;
  attachmentVenueId: string | null;
};

const memConversations = new Map<string, MemoryConversation>();
const memPairIndex = new Map<string, string>(); // "handleA|handleB" → conversation id
const memMessages = new Map<string, MemoryMessage[]>(); // conversation id → messages
let memConvSeq = 0;
let memMsgSeq = 0;

function pairKey(pair: HandlePair): string {
  return `${pair.handleA}|${pair.handleB}`;
}

function memConversationDTO(conv: MemoryConversation, me: string): ConversationDTO {
  const other = conv.handleA === me ? conv.handleB : conv.handleA;
  const list = (memMessages.get(conv.id) ?? [])
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)); // newest-first
  const last = list[0];
  return {
    id: conv.id,
    otherHandle: other,
    ...(last ? { lastBody: previewBody(last.body, last.attachmentKind) } : {}),
    lastAt: conv.lastMessageAt,
    lastFromMe: last ? last.senderHandle === me : false,
    unread: unreadForViewer(
      list.map((m) => ({ senderHandle: m.senderHandle, read: m.readAt != null })),
      me,
    ),
  };
}

// Through the SAME projection the durable rows take, so the two backends cannot
// answer differently about what a message is carrying.
function memMessageDTO(m: MemoryMessage): MessageDTO {
  return rowToMessageDTO({
    id: m.id,
    conversation_id: m.conversationId,
    sender_handle: m.senderHandle,
    body: m.body,
    created_at: m.createdAt,
    read_at: m.readAt,
    flagged_at: m.flaggedAt,
    attachment_kind: m.attachmentKind,
    attachment_object_key: m.attachmentObjectKey,
    attachment_width: m.attachmentWidth,
    attachment_height: m.attachmentHeight,
    attachment_venue_id: m.attachmentVenueId,
  });
}

export const memoryMessagesStore: MessagesStore = {
  async openConversation(a, b) {
    const pair = normalizePair(a, b);
    if (!pair) return null;
    const key = pairKey(pair);
    const existing = memPairIndex.get(key);
    if (existing) return existing;
    const id = `c${++memConvSeq}`;
    const now = new Date(Date.now() + memConvSeq).toISOString();
    memConversations.set(id, {
      id,
      handleA: pair.handleA,
      handleB: pair.handleB,
      lastMessageAt: now,
    });
    memPairIndex.set(key, id);
    memMessages.set(id, []);
    return id;
  },

  async send(conversationId, sender, body, attachment) {
    const senderHandle = normalizeHandle(sender);
    const clean = attachment ? cleanAttachedBody(body) : cleanBody(body);
    if (!conversationId || !senderHandle || clean === null) return null;
    const conv = memConversations.get(conversationId);
    if (!conv) return null;
    const pair: HandlePair = { handleA: conv.handleA, handleB: conv.handleB };
    if (!isParticipant(pair, senderHandle)) return null;
    // A photo's id was minted before its bytes were staged, so the row takes it
    // rather than the sequence: the storage key is built from it.
    const id = attachment?.kind === "photo" ? attachment.messageId : `m${++memMsgSeq}`;
    if (attachment?.kind === "photo") memMsgSeq += 1;
    // Distinct, monotonic timestamps so oldest-first ordering is stable even when
    // two messages land in the same millisecond.
    const createdAt = new Date(Date.now() + memMsgSeq).toISOString();
    const row: MemoryMessage = {
      id,
      conversationId,
      senderHandle,
      body: clean,
      createdAt,
      readAt: null,
      flaggedAt: null,
      flaggedBy: null,
      attachmentKind: attachment?.kind ?? null,
      attachmentObjectKey: attachment?.kind === "photo" ? attachment.objectKey : null,
      attachmentWidth: attachment?.kind === "photo" ? attachment.width : null,
      attachmentHeight: attachment?.kind === "photo" ? attachment.height : null,
      attachmentVenueId: attachment?.kind === "venue" ? attachment.venueId : null,
    };
    const list = memMessages.get(conversationId) ?? [];
    list.push(row);
    memMessages.set(conversationId, list);
    conv.lastMessageAt = createdAt;
    return memMessageDTO(row);
  },

  async listConversations(handle) {
    const me = normalizeHandle(handle);
    if (!me) return [];
    return [...memConversations.values()]
      .filter((c) => c.handleA === me || c.handleB === me)
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
      .slice(0, MAX_CONVERSATIONS)
      .map((c) => memConversationDTO(c, me));
  },

  async listMessages(conversationId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !me) return null;
    const conv = memConversations.get(conversationId);
    if (!conv) return null;
    const pair: HandlePair = { handleA: conv.handleA, handleB: conv.handleB };
    // COURTESY CHECK — non-participant gets null (route → 404).
    if (!isParticipant(pair, me)) return null;
    const list = (memMessages.get(conversationId) ?? [])
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)) // newest-first cap
      .slice(0, MAX_MESSAGES)
      .reverse(); // oldest-first display
    // Mark received (not own) messages read.
    const now = new Date().toISOString();
    for (const m of memMessages.get(conversationId) ?? []) {
      if (m.readAt == null && m.senderHandle !== me) m.readAt = now;
    }
    return list.map(memMessageDTO);
  },

  async report(conversationId, messageId, reporterHandle) {
    const reporter = normalizeHandle(reporterHandle);
    if (!conversationId || !messageId || !reporter) return false;
    const list = memMessages.get(conversationId);
    const hit = list?.find((m) => m.id === messageId);
    if (!hit) return false;
    if (hit.flaggedAt != null) return false; // already flagged
    hit.flaggedAt = new Date().toISOString();
    hit.flaggedBy = reporter;
    return true;
  },

  async photoObjectKey(conversationId, messageId, handle) {
    const me = normalizeHandle(handle);
    if (!conversationId || !messageId || !me) return null;
    const conv = memConversations.get(conversationId);
    if (!conv) return null;
    const pair: HandlePair = { handleA: conv.handleA, handleB: conv.handleB };
    if (!isParticipant(pair, me)) return null;
    const hit = (memMessages.get(conversationId) ?? []).find((m) => m.id === messageId);
    if (!hit) return null;
    return photoKeyFromRow({
      id: hit.id,
      conversation_id: hit.conversationId,
      flagged_at: hit.flaggedAt,
      attachment_kind: hit.attachmentKind,
      attachment_object_key: hit.attachmentObjectKey,
      attachment_width: hit.attachmentWidth,
      attachment_height: hit.attachmentHeight,
      attachment_venue_id: hit.attachmentVenueId,
    });
  },
};

/** The single backend selection point (mirrors the other stores). */
export function messagesStore(): MessagesStore {
  return selectStore(memoryMessagesStore, supabaseMessagesStore);
}

/** Test-only: clear the in-memory maps between cases. */
export function __resetMemoryMessages(): void {
  memConversations.clear();
  memPairIndex.clear();
  memMessages.clear();
  memConvSeq = 0;
  memMsgSeq = 0;
}
