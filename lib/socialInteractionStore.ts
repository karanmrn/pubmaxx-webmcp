import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { followStore } from "@/lib/followStore";
import { profileStore } from "@/lib/profileStore";
import type {
  SocialPostActor,
  SocialPostRelationships,
  SocialPostStore,
} from "@/lib/socialPostStore";
import { socialPostServerProjectionFromRow, socialPostStore, SocialPostStoreError } from "@/lib/socialPostStore";
import { clearSocialMemoryBlocks, setSocialMemoryBlock, socialMemoryBlocked } from "@/lib/socialBlockMemory";
import type { SocialPostCommentPolicy, SocialPostDTO, SocialPostVisibility } from "@/lib/socialPosts";
import {
  cleanSocialText,
  emptyInteractionSummary,
  payloadDigest,
  validIdempotencyKey,
  type SocialCommentDTO,
  type SocialCommentInput,
  type SocialContentReportDTO,
  type SocialDerivativeDTO,
  type SocialDesiredInteraction,
  type SocialFeatureStatus,
  type SocialFeatureUpdateDTO,
  type SocialFeatureUpdateInput,
  type SocialInteractionActor,
  type SocialInteractionSummary,
  type SocialModerationState,
  type SocialNotificationDTO,
  type SocialQuoteInput,
  type SocialReportReason,
} from "@/lib/socialInteractions";
import { moderationJobShouldRetry, moderationRetryBackoffMs } from "@/lib/moderationRetry";
import { trustedSigningKey } from "@/lib/trustedSigningKey.server";
import { requireSupabaseAdmin, requiresSupabaseStore, hashActor } from "@/lib/supabase";
import { isMissingTableSchema, onMissingDurableWrite, selectStore } from "@/lib/storeBackend";

export type { SocialInteractionActor } from "@/lib/socialInteractions";

type PageInput = { cursor?: string | null; limit?: number };
type Page<T> = { items: T[]; nextCursor: string | null };
type ModerationAdapter = {
  moderate(input: { postId: string; text: string }): Promise<{ decision: "approved" | "needs_review" }>;
};
type ModerationResult = {
  processed: number;
  approved: number;
  needsReview: number;
  retried: number;
  terminalErrors: number;
};
type StaffIdentity = {
  id: string;
  profileId: string;
  displayName: string;
  active: boolean;
  role: "moderator" | "product_staff";
};

export class SocialInteractionStoreError extends Error {
  constructor(
    public readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "COMMENTS_NOT_ALLOWED"
      | "INVALID_INTERACTION"
      | "INVALID_CURSOR"
      | "IDEMPOTENCY_CONFLICT"
      | "EDIT_CONFLICT"
      | "STAFF_REQUIRED",
    message: string,
  ) {
    super(message);
  }
}

export type SocialInteractionStore = {
  setDesired(actor: SocialInteractionActor, postId: string, kind: SocialDesiredInteraction, active: boolean): Promise<void>;
  summary(viewer: SocialInteractionActor, postId: string): Promise<SocialInteractionSummary>;
  listCheers(viewer: SocialInteractionActor, postId: string, page: PageInput): Promise<Page<{ profileId: string; handle: string }>>;
  listSaved(viewer: SocialInteractionActor, page: PageInput): Promise<Page<{ savedAt: string; post: SocialPostDTO }>>;
  createComment(actor: SocialInteractionActor, postId: string, input: SocialCommentInput): Promise<SocialCommentDTO>;
  listComments(viewer: SocialInteractionActor, postId: string, page: PageInput): Promise<Page<SocialCommentDTO>>;
  setCommentPolicy(actor: SocialInteractionActor, postId: string, policy: SocialPostCommentPolicy): Promise<void>;
  createQuote(actor: SocialInteractionActor, postId: string, input: SocialQuoteInput): Promise<SocialDerivativeDTO>;
  listDerivatives(viewer: SocialInteractionActor, page: PageInput): Promise<Page<SocialDerivativeDTO>>;
  processModerationQueue(adapter: ModerationAdapter, limit?: number): Promise<ModerationResult>;
  setBlock(actor: SocialInteractionActor, targetProfileId: string, active: boolean): Promise<void>;
  notifications(viewer: SocialInteractionActor, page: PageInput): Promise<Page<SocialNotificationDTO>>;
  markNotificationRead(viewer: SocialInteractionActor, id: string, read: boolean): Promise<void>;
  updateFeatureRequest(actor: SocialInteractionActor, postId: string, input: SocialFeatureUpdateInput): Promise<SocialFeatureUpdateDTO>;
  featureHistory(viewer: SocialInteractionActor, postId: string, page: PageInput): Promise<Page<SocialFeatureUpdateDTO> & { currentStatus: SocialFeatureStatus }>;
  report(actor: SocialInteractionActor, input: { kind: "post" | "comment" | "quote"; id: string; reason: SocialReportReason }): Promise<{ id: string; createdAt: string }>;
  reportQueue(actor: SocialInteractionActor, page: PageInput): Promise<Page<SocialContentReportDTO>>;
  resolveReport(actor: SocialInteractionActor, id: string): Promise<void>;
  moderate(actor: SocialInteractionActor, input: { kind: "comment" | "quote"; id: string; action: "hide" | "restore" }): Promise<void>;
  featureQueue(actor: SocialInteractionActor, page: PageInput): Promise<Page<SocialPostDTO>>;
};

type DesiredRow = { postId: string; actor: SocialInteractionActor; kind: SocialDesiredInteraction; createdAt: string };
type CommentRow = SocialCommentDTO & { authorProfileId: string; status: "visible" | "hidden" | "removed" };
type QuoteRow = SocialDerivativeDTO & { authorProfileId: string; sourceAuthorProfileId: string; status: "visible" | "hidden" | "removed" };
type Job = {
  kind: "comment" | "quote";
  id: string;
  text: string;
  sourceAuthorProfileId: string;
  attempts: number;
  nextAttemptAt: number;
};
type NotificationRow = SocialNotificationDTO & { recipientProfileId: string; actorProfileId: string };
type FeatureRow = SocialFeatureUpdateDTO & { postId: string; staffId: string; staffDisplayName: string };
type ReportRow = Omit<SocialContentReportDTO, "state"> & {
  reporterProfileId: string;
  state: "queued" | "reviewing" | "resolved";
};
type IdempotencyRow = { digest: string; resultId: string };

type RelationshipResolver = (actor: SocialInteractionActor) => Promise<SocialPostRelationships>;
type StaffResolver = (actor: SocialInteractionActor) => Promise<StaffIdentity | null>;

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

function limit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIMIT) {
    throw new SocialInteractionStoreError("INVALID_CURSOR", "Page size must be between 1 and 50.");
  }
  return value;
}

function cursorSignature(encoded: string, viewerProfileId: string, scope: string): Buffer {
  return createHmac("sha256", trustedSigningKey())
    .update(`social-interaction-cursor:v1:${viewerProfileId}:${scope}:${encoded}`)
    .digest();
}

function encodeCursor(value: { createdAt: string; id: string }, viewerProfileId: string, scope: string): string {
  const encoded = Buffer.from(JSON.stringify({ v: 1, ...value }), "utf8").toString("base64url");
  return `${encoded}.${cursorSignature(encoded, viewerProfileId, scope).toString("base64url")}`;
}

function decodeCursor(raw: string | null | undefined, viewerProfileId: string, scope: string): { createdAt: string; id: string } | null {
  if (!raw) return null;
  try {
    if (raw.length > 1_000) throw new Error("invalid");
    const [encoded, signatureText, extra] = raw.split(".");
    if (!encoded || !signatureText || extra) throw new Error("invalid");
    const signature = Buffer.from(signatureText, "base64url");
    const expected = cursorSignature(encoded, viewerProfileId, scope);
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) throw new Error("invalid");
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<string, unknown>;
    if (value.v !== 1 || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) || typeof value.id !== "string") {
      throw new Error("invalid");
    }
    return { createdAt: value.createdAt, id: value.id };
  } catch {
    throw new SocialInteractionStoreError("INVALID_CURSOR", "That page is not valid.");
  }
}

function newest<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  return right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id);
}

function oldest<T extends { createdAt: string; id: string }>(left: T, right: T): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function afterCursor<T extends { createdAt: string; id: string }>(row: T, cursor: { createdAt: string; id: string } | null): boolean {
  return !cursor || row.createdAt < cursor.createdAt || (row.createdAt === cursor.createdAt && row.id < cursor.id);
}

function makePage<T extends { createdAt: string; id: string }>(
  rows: T[],
  viewer: SocialInteractionActor,
  scope: string,
  input: PageInput,
): Page<T> {
  const size = limit(input.limit);
  const cursor = decodeCursor(input.cursor, viewer.profileId, scope);
  const matches = rows.filter((row) => afterCursor(row, cursor)).sort(newest);
  const items = matches.slice(0, size);
  const last = items.at(-1);
  return {
    items,
    nextCursor: matches.length > size && last
      ? encodeCursor(last, viewer.profileId, scope)
      : null,
  };
}

async function defaultRelationships(actor: SocialInteractionActor): Promise<SocialPostRelationships> {
  const graph = followStore();
  const profiles = profileStore();
  const [followingHandles, mutualHandles] = await Promise.all([
    graph.listFollowing(actor.handle),
    graph.listMutuals(actor.handle),
  ]);
  const [following, mutual] = await Promise.all([
    Promise.all(followingHandles.map((handle) => profiles.getByHandle(handle))),
    Promise.all(mutualHandles.map((handle) => profiles.getByHandle(handle))),
  ]);
  return {
    followingProfileIds: new Set(following.flatMap((profile) => profile ? [profile.id] : [])),
    mutualProfileIds: new Set(mutual.flatMap((profile) => profile ? [profile.id] : [])),
  };
}

export function createMemorySocialInteractionStore(options: {
  posts?: SocialPostStore;
  now?: () => Date;
  relationships?: RelationshipResolver;
  staff?: StaffResolver;
} = {}): SocialInteractionStore {
  clearSocialMemoryBlocks();
  const posts = options.posts ?? socialPostStore();
  const now = options.now ?? (() => new Date());
  const relationships = options.relationships ?? defaultRelationships;
  const resolveStaff = options.staff ?? (async () => null);
  const desired = new Map<string, DesiredRow>();
  const comments = new Map<string, CommentRow>();
  const quotes = new Map<string, QuoteRow>();
  const jobs = new Map<string, Job>();
  const notificationRows = new Map<string, NotificationRow>();
  const featureRows = new Map<string, FeatureRow>();
  const reports = new Map<string, ReportRow>();
  const idempotency = new Map<string, IdempotencyRow>();

  const blocked = socialMemoryBlocked;

  async function visiblePost(postId: string, viewer: SocialInteractionActor): Promise<{ post: SocialPostDTO; authorProfileId: string } | null> {
    const projection = await posts.readServerProjection(postId, viewer as SocialPostActor);
    if (!projection || blocked(viewer.profileId, projection.authorProfileId)) return null;
    return projection;
  }

  function desiredKey(kind: SocialDesiredInteraction, postId: string, profileId: string): string {
    return `${kind}:${postId}:${profileId}`;
  }

  function idempotencyKey(actor: SocialInteractionActor, action: string, raw: string): string {
    return createHash("sha256").update(`${actor.profileId}:${action}:${raw}`).digest("hex");
  }

  function recordIdempotency(actor: SocialInteractionActor, action: string, raw: string, digest: string, resultId: string): string | null {
    if (!validIdempotencyKey(raw)) {
      throw new SocialInteractionStoreError("INVALID_INTERACTION", "Add a valid idempotency key.");
    }
    const key = idempotencyKey(actor, action, raw);
    const prior = idempotency.get(key);
    if (prior && prior.digest !== digest) {
      throw new SocialInteractionStoreError("IDEMPOTENCY_CONFLICT", "That request key was already used for different content.");
    }
    if (prior) return prior.resultId;
    idempotency.set(key, { digest, resultId });
    return null;
  }

  function addNotification(
    recipientProfileId: string,
    actorProfileId: string,
    kind: SocialNotificationDTO["kind"],
    sourcePostId: string,
  ) {
    if (recipientProfileId === actorProfileId) return;
    const identity = `${recipientProfileId}:${actorProfileId}:${kind}:${sourcePostId}`;
    if ([...notificationRows.values()].some((row) =>
      `${row.recipientProfileId}:${row.actorProfileId}:${row.kind}:${row.sourcePostId}` === identity
    )) return;
    const createdAt = now().toISOString();
    const id = randomUUID();
    notificationRows.set(id, { id, recipientProfileId, actorProfileId, kind, sourcePostId, readAt: null, createdAt });
  }

  async function commentAllowed(
    actor: SocialInteractionActor,
    source: { post: SocialPostDTO; authorProfileId: string },
  ): Promise<boolean> {
    if (source.authorProfileId === actor.profileId) return source.post.commentPolicy !== "locked";
    if (source.post.commentPolicy === "locked") return false;
    if (source.post.commentPolicy === "open") return true;
    return (await relationships(actor)).mutualProfileIds.has(source.authorProfileId);
  }

  async function derivativeVisible(row: QuoteRow, viewer: SocialInteractionActor): Promise<SocialDerivativeDTO | null> {
    if (row.status !== "visible" || row.moderationState !== "approved" || blocked(viewer.profileId, row.authorProfileId)) return null;
    const source = await visiblePost(row.sourcePost.id, viewer);
    if (!source) return null;
    if (row.authorProfileId !== viewer.profileId) {
      if (row.visibility === "private") return null;
      if (row.visibility === "friends" && !(await relationships(viewer)).mutualProfileIds.has(row.authorProfileId)) return null;
    }
    return {
      id: row.id,
      kind: row.kind,
      sourcePost: source.post,
      body: row.body,
      visibility: row.visibility,
      author: row.author,
      moderationState: row.moderationState,
      createdAt: row.createdAt,
    };
  }

  async function reportableContent(
    actor: SocialInteractionActor,
    kind: "post" | "comment" | "quote",
    contentId: string,
  ): Promise<boolean> {
    if (kind === "post") return Boolean(await visiblePost(contentId, actor));
    if (kind === "quote") {
      const target = quotes.get(contentId);
      return Boolean(target && await derivativeVisible(target, actor));
    }
    const target = comments.get(contentId);
    return Boolean(
      target
      && target.status === "visible"
      && target.moderationState === "approved"
      && !blocked(actor.profileId, target.authorProfileId)
      && await visiblePost(target.postId, actor),
    );
  }

  return {
    async setDesired(actor, postId, kind, active) {
      const source = await visiblePost(postId, actor);
      if (!source) throw new SocialInteractionStoreError("NOT_FOUND", "Post not found.");
      const key = desiredKey(kind, postId, actor.profileId);
      const existed = desired.has(key);
      if (active && !existed) {
        const createdAt = now().toISOString();
        desired.set(key, { postId, actor, kind, createdAt });
        if (kind === "cheer" || kind === "repost") {
          addNotification(source.authorProfileId, actor.profileId, kind, postId);
        }
      } else if (!active && existed) {
        desired.delete(key);
        if (kind !== "save") {
          for (const [id, notification] of notificationRows) {
            if (notification.recipientProfileId === source.authorProfileId && notification.actorProfileId === actor.profileId && notification.kind === kind && notification.sourcePostId === postId) {
              notificationRows.delete(id);
            }
          }
        }
      }
    },

    async summary(viewer, postId) {
      if (!await visiblePost(postId, viewer)) return emptyInteractionSummary();
      const rows = [...desired.values()].filter((row) => row.postId === postId && !blocked(row.actor.profileId, viewer.profileId));
      return {
        cheered: rows.some((row) => row.kind === "cheer" && row.actor.profileId === viewer.profileId),
        saved: rows.some((row) => row.kind === "save" && row.actor.profileId === viewer.profileId),
        reposted: rows.some((row) => row.kind === "repost" && row.actor.profileId === viewer.profileId),
        cheerCount: rows.filter((row) => row.kind === "cheer").length,
        repostCount: rows.filter((row) => row.kind === "repost").length,
      };
    },

    async listCheers(viewer, postId, input) {
      if (!await visiblePost(postId, viewer)) return { items: [], nextCursor: null };
      const rows = [...desired.values()]
        .filter((entry) => entry.kind === "cheer" && entry.postId === postId && !blocked(viewer.profileId, entry.actor.profileId))
        .map((entry) => ({
          id: entry.actor.profileId,
          createdAt: entry.createdAt,
          profileId: entry.actor.profileId,
          handle: entry.actor.handle,
        }));
      const page = makePage(rows, viewer, `cheers:${postId}`, input);
      return {
        items: page.items.map(({ profileId, handle }) => ({ profileId, handle })),
        nextCursor: page.nextCursor,
      };
    },

    async listSaved(viewer, input) {
      const rows: Array<{ id: string; createdAt: string; savedAt: string; post: SocialPostDTO }> = [];
      for (const row of desired.values()) {
        if (row.kind !== "save" || row.actor.profileId !== viewer.profileId) continue;
        const source = await visiblePost(row.postId, viewer);
        if (source) rows.push({ id: row.postId, createdAt: row.createdAt, savedAt: row.createdAt, post: source.post });
      }
      const page = makePage(rows, viewer, "saves", input);
      return { items: page.items.map(({ savedAt, post }) => ({ savedAt, post })), nextCursor: page.nextCursor };
    },

    async createComment(actor, postId, input) {
      const source = await visiblePost(postId, actor);
      if (!source) throw new SocialInteractionStoreError("NOT_FOUND", "Post not found.");
      if (!await commentAllowed(actor, source)) {
        throw new SocialInteractionStoreError("COMMENTS_NOT_ALLOWED", "Comments are closed for this post.");
      }
      const body = cleanSocialText(input.body, 1_000);
      if (!body) throw new SocialInteractionStoreError("INVALID_INTERACTION", "Add a comment.");
      const digest = payloadDigest({ postId, body });
      const id = randomUUID();
      const priorId = recordIdempotency(actor, "comment", input.idempotencyKey, digest, id);
      if (priorId) return comments.get(priorId)!;
      const row: CommentRow = {
        id,
        postId,
        body,
        author: { handle: actor.handle },
        authorProfileId: actor.profileId,
        moderationState: "pending",
        status: "visible",
        createdAt: now().toISOString(),
      };
      comments.set(id, row);
      jobs.set(`comment:${id}`, {
        kind: "comment",
        id,
        text: body,
        sourceAuthorProfileId: source.authorProfileId,
        attempts: 0,
        nextAttemptAt: now().getTime(),
      });
      return row;
    },

    async listComments(viewer, postId, input) {
      if (!await visiblePost(postId, viewer)) return { items: [], nextCursor: null };
      const rows = [...comments.values()]
        .filter((row) => row.postId === postId && row.status === "visible" && row.moderationState === "approved" && !blocked(viewer.profileId, row.authorProfileId))
        .map((row): SocialCommentDTO => ({
          id: row.id,
          postId: row.postId,
          body: row.body,
          author: row.author,
          moderationState: row.moderationState,
          createdAt: row.createdAt,
        }));
      return makePage(rows, viewer, `comments:${postId}`, input);
    },

    async setCommentPolicy(actor, postId, policy) {
      const source = await visiblePost(postId, actor);
      if (!source) throw new SocialInteractionStoreError("NOT_FOUND", "Post not found.");
      if (source.authorProfileId !== actor.profileId) throw new SocialInteractionStoreError("FORBIDDEN", "Only the author can change comments.");
      await posts.edit(postId, actor as SocialPostActor, source.post.mutationVersion, { commentPolicy: policy }, false);
    },

    async createQuote(actor, postId, input) {
      const source = await visiblePost(postId, actor);
      if (!source) throw new SocialInteractionStoreError("NOT_FOUND", "Post not found.");
      const body = cleanSocialText(input.body, 2_000);
      if (!body || !["public", "friends", "private"].includes(input.visibility)) {
        throw new SocialInteractionStoreError("INVALID_INTERACTION", "Quote details are not valid.");
      }
      const digest = payloadDigest({ postId, body, visibility: input.visibility });
      const id = randomUUID();
      const priorId = recordIdempotency(actor, "quote", input.idempotencyKey, digest, id);
      if (priorId) return quotes.get(priorId)!;
      const row: QuoteRow = {
        id,
        kind: "quote",
        sourcePost: source.post,
        sourceAuthorProfileId: source.authorProfileId,
        body,
        visibility: input.visibility,
        author: { handle: actor.handle },
        authorProfileId: actor.profileId,
        moderationState: "pending",
        status: "visible",
        createdAt: now().toISOString(),
      };
      quotes.set(id, row);
      jobs.set(`quote:${id}`, {
        kind: "quote",
        id,
        text: body,
        sourceAuthorProfileId: source.authorProfileId,
        attempts: 0,
        nextAttemptAt: now().getTime(),
      });
      return row;
    },

    async listDerivatives(viewer, input) {
      const rows: SocialDerivativeDTO[] = [];
      for (const row of quotes.values()) {
        const visible = await derivativeVisible(row, viewer);
        if (visible) rows.push(visible);
      }
      for (const row of desired.values()) {
        if (row.kind !== "repost" || blocked(viewer.profileId, row.actor.profileId)) continue;
        const source = await visiblePost(row.postId, viewer);
        if (!source) continue;
        rows.push({
          id: `repost:${row.postId}:${row.actor.profileId}`,
          kind: "repost",
          sourcePost: source.post,
          body: null,
          visibility: source.post.visibility,
          author: { handle: row.actor.handle },
          moderationState: "approved",
          createdAt: row.createdAt,
        });
      }
      return makePage(rows, viewer, "derivatives", input);
    },

    async processModerationQueue(adapter, requestedLimit = 20) {
      const result: ModerationResult = { processed: 0, approved: 0, needsReview: 0, retried: 0, terminalErrors: 0 };
      const eligible = [...jobs.values()]
        .filter((job) => job.nextAttemptAt <= now().getTime())
        .slice(0, Math.min(Math.max(requestedLimit, 1), 50));
      for (const job of eligible) {
        result.processed += 1;
        try {
          const moderation = await adapter.moderate({ postId: job.id, text: job.text });
          if (job.kind === "comment") {
            const row = comments.get(job.id);
            if (row) {
              row.moderationState = moderation.decision;
              if (moderation.decision === "approved") {
                addNotification(job.sourceAuthorProfileId, row.authorProfileId, "comment", row.postId);
              }
            }
          } else {
            const row = quotes.get(job.id);
            if (row) {
              row.moderationState = moderation.decision;
              if (moderation.decision === "approved") addNotification(row.sourceAuthorProfileId, row.authorProfileId, "quote", row.sourcePost.id);
            }
          }
          jobs.delete(`${job.kind}:${job.id}`);
          if (moderation.decision === "approved") result.approved += 1;
          else result.needsReview += 1;
        } catch (error) {
          job.attempts += 1;
          const retryable = moderationJobShouldRetry(error, job.attempts);
          if (retryable) {
            job.nextAttemptAt = now().getTime() + moderationRetryBackoffMs(job.attempts);
            result.retried += 1;
          } else {
            job.nextAttemptAt = Number.POSITIVE_INFINITY;
            result.terminalErrors += 1;
          }
        }
      }
      return result;
    },

    async setBlock(actor, targetProfileId, active) {
      if (!targetProfileId || targetProfileId === actor.profileId) {
        throw new SocialInteractionStoreError("INVALID_INTERACTION", "Choose another account to block.");
      }
      setSocialMemoryBlock(actor.profileId, targetProfileId, active);
    },

    async notifications(viewer, input) {
      const visible: SocialNotificationDTO[] = [];
      for (const row of notificationRows.values()) {
        if (row.recipientProfileId !== viewer.profileId || blocked(viewer.profileId, row.actorProfileId)) continue;
        if (!await visiblePost(row.sourcePostId, viewer)) continue;
        visible.push({
          id: row.id,
          kind: row.kind,
          sourcePostId: row.sourcePostId,
          readAt: row.readAt,
          createdAt: row.createdAt,
        });
      }
      return makePage(visible, viewer, "notifications", input);
    },

    async markNotificationRead(viewer, id, read) {
      const row = notificationRows.get(id);
      if (!row || row.recipientProfileId !== viewer.profileId) throw new SocialInteractionStoreError("NOT_FOUND", "Notification not found.");
      row.readAt = read ? now().toISOString() : null;
    },

    async updateFeatureRequest(actor, postId, input) {
      const source = await visiblePost(postId, actor);
      if (!source || source.post.kind !== "feature_request") throw new SocialInteractionStoreError("NOT_FOUND", "Feature request not found.");
      const staff = await resolveStaff(actor);
      if (!staff || !staff.active || staff.profileId !== actor.profileId) {
        throw new SocialInteractionStoreError("STAFF_REQUIRED", "Named staff access is required.");
      }
      const response = cleanSocialText(input.response, 2_000);
      if (!response || !["planned", "shipped", "declined"].includes(input.status)) {
        throw new SocialInteractionStoreError("INVALID_INTERACTION", "Feature update is not valid.");
      }
      const digest = payloadDigest({ postId, status: input.status, response });
      const id = randomUUID();
      const priorId = recordIdempotency(actor, "feature-update", input.idempotencyKey, digest, id);
      if (priorId) return featureRows.get(priorId)!;
      const row: FeatureRow = {
        id,
        postId,
        status: input.status,
        response,
        staff: "PUBMAXX team",
        staffId: staff.id,
        staffDisplayName: staff.displayName,
        createdAt: now().toISOString(),
      };
      await posts.applyFeatureRequestUpdate(postId, input.status, response);
      featureRows.set(id, row);
      addNotification(source.authorProfileId, actor.profileId, "feature_update", postId);
      return row;
    },

    async featureHistory(viewer, postId, input) {
      const source = await visiblePost(postId, viewer);
      if (!source || source.post.kind !== "feature_request") throw new SocialInteractionStoreError("NOT_FOUND", "Feature request not found.");
      const all = [...featureRows.values()].filter((row) => row.postId === postId).sort(oldest);
      const currentStatus = all.at(-1)?.status ?? "submitted";
      const page = makePage(all, viewer, `feature:${postId}`, input);
      return {
        currentStatus,
        items: page.items.sort(oldest).map((row): SocialFeatureUpdateDTO => ({
          id: row.id,
          status: row.status,
          response: row.response,
          staff: row.staff,
          createdAt: row.createdAt,
        })),
        nextCursor: page.nextCursor,
      };
    },

    async report(actor, input) {
      if (!["post", "comment", "quote"].includes(input.kind) || !["harassment", "hate", "threat", "doxxing", "spam", "other"].includes(input.reason)) {
        throw new SocialInteractionStoreError("INVALID_INTERACTION", "Report details are not valid.");
      }
      if (!await reportableContent(actor, input.kind, input.id)) {
        throw new SocialInteractionStoreError("NOT_FOUND", "Content not found.");
      }
      const key = createHash("sha256").update(`${actor.profileId}:${input.kind}:${input.id}:${input.reason}`).digest("hex");
      const prior = reports.get(key);
      if (prior) return { id: prior.id, createdAt: prior.createdAt };
      const row: ReportRow = {
        id: randomUUID(),
        reporterProfileId: actor.profileId,
        kind: input.kind,
        contentId: input.id,
        reason: input.reason,
        state: "queued",
        createdAt: now().toISOString(),
      };
      reports.set(key, row);
      return { id: row.id, createdAt: row.createdAt };
    },

    async reportQueue(actor, input) {
      const staff = await resolveStaff(actor);
      if (!staff || !staff.active || staff.profileId !== actor.profileId || staff.role !== "moderator") {
        throw new SocialInteractionStoreError("STAFF_REQUIRED", "Named moderator access is required.");
      }
      return makePage(
        [...reports.values()]
          .filter((report) => report.state !== "resolved")
          .map((report): SocialContentReportDTO => ({
            id: report.id,
            kind: report.kind,
            contentId: report.contentId,
            reason: report.reason,
            state: report.state as "queued" | "reviewing",
            createdAt: report.createdAt,
          })),
        actor,
        "report-queue",
        input,
      );
    },

    async resolveReport(actor, id) {
      const staff = await resolveStaff(actor);
      if (!staff || !staff.active || staff.profileId !== actor.profileId || staff.role !== "moderator") {
        throw new SocialInteractionStoreError("STAFF_REQUIRED", "Named moderator access is required.");
      }
      const report = [...reports.values()].find((entry) => entry.id === id);
      if (!report || report.state === "resolved") {
        throw new SocialInteractionStoreError("NOT_FOUND", "Report not found.");
      }
      report.state = "resolved";
    },

    async moderate(actor, input) {
      const staff = await resolveStaff(actor);
      if (!staff || !staff.active || staff.profileId !== actor.profileId) {
        throw new SocialInteractionStoreError("STAFF_REQUIRED", "Named staff access is required.");
      }
      const target = input.kind === "comment" ? comments.get(input.id) : quotes.get(input.id);
      if (!target) throw new SocialInteractionStoreError("NOT_FOUND", "Content not found.");
      if (![...reports.values()].some((report) => report.kind === input.kind && report.contentId === input.id)) {
        throw new SocialInteractionStoreError("FORBIDDEN", "A queued report is required for moderation.");
      }
      target.status = input.action === "hide" ? "hidden" : "visible";
    },

    async featureQueue(actor, input) {
      const staff = await resolveStaff(actor);
      if (!staff || !staff.active || staff.profileId !== actor.profileId) {
        throw new SocialInteractionStoreError("STAFF_REQUIRED", "Named staff access is required.");
      }
      const feed = await posts.feed(actor, {
        lane: "discover",
        cursor: input.cursor,
        limit: limit(input.limit),
      });
      return {
        items: feed.posts.filter((post) => post.kind === "feature_request"),
        nextCursor: feed.nextCursor,
      };
    },
  };
}

export const memorySocialInteractionStore = createMemorySocialInteractionStore();

function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid Social interaction row.");
  }
  return value as Record<string, unknown>;
}

function commentFromRow(value: unknown): SocialCommentDTO {
  const valueRow = row(value);
  return {
    id: String(valueRow.id),
    postId: String(valueRow.post_id),
    body: String(valueRow.body),
    author: { handle: String(valueRow.author_handle) },
    moderationState: valueRow.moderation_state === "approved" || valueRow.moderation_state === "needs_review"
      ? valueRow.moderation_state
      : "pending",
    createdAt: String(valueRow.created_at),
  };
}

function notificationFromRow(value: unknown): SocialNotificationDTO {
  const valueRow = row(value);
  const kind = String(valueRow.kind);
  if (!["cheer", "comment", "repost", "quote", "feature_update", "tag_proposal"].includes(kind)) {
    throw new SocialInteractionStoreError("INVALID_INTERACTION", "Social notification data is unavailable.");
  }
  return {
    id: String(valueRow.id),
    kind: kind as SocialNotificationDTO["kind"],
    sourcePostId: String(valueRow.source_post_id),
    readAt: typeof valueRow.read_at === "string" ? valueRow.read_at : null,
    createdAt: String(valueRow.created_at),
  };
}

function reportFromRow(value: unknown): SocialContentReportDTO {
  const valueRow = row(value);
  return {
    id: String(valueRow.id),
    kind: valueRow.content_kind as SocialContentReportDTO["kind"],
    contentId: String(valueRow.content_id),
    reason: valueRow.reason as SocialReportReason,
    state: valueRow.state === "reviewing" ? "reviewing" : "queued",
    createdAt: String(valueRow.created_at),
  };
}

function durableStoreError(error: unknown): unknown {
  const message = error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "";
  if (/staff required/i.test(message)) {
    return new SocialInteractionStoreError("STAFF_REQUIRED", "Named staff access is required.");
  }
  if (/idempotency conflict/i.test(message)) {
    return new SocialInteractionStoreError("IDEMPOTENCY_CONFLICT", "That request key was already used for different content.");
  }
  if (/comments not allowed/i.test(message)) {
    return new SocialInteractionStoreError("COMMENTS_NOT_ALLOWED", "Comments are closed for this post.");
  }
  if (/queued report required/i.test(message)) {
    return new SocialInteractionStoreError("FORBIDDEN", "A queued report is required for moderation.");
  }
  if (/not found|not visible/i.test(message)) {
    return new SocialInteractionStoreError("NOT_FOUND", "Content not found.");
  }
  return error;
}

function durableCursor(
  raw: string | null | undefined,
  viewer: SocialInteractionActor,
  scope: string,
): { createdAt: string; id: string } | null {
  return decodeCursor(raw, viewer.profileId, scope);
}

function durablePage<T extends { id: string; createdAt: string }>(
  rows: T[],
  viewer: SocialInteractionActor,
  scope: string,
  size: number,
): Page<T> {
  const items = rows.slice(0, size);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > size && last ? encodeCursor(last, viewer.profileId, scope) : null,
  };
}

async function durableOrMemory<T>(
  operation: () => Promise<T>,
  fallback: () => Promise<T>,
  write: boolean,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (!isMissingTableSchema(error, [
      "social_blocks",
      "social_cheers",
      "social_saves",
      "social_reposts",
      "social_comments",
      "social_quotes",
      "social_notifications",
      "social_feature_request_updates",
    ])) throw durableStoreError(error);
    if (requiresSupabaseStore()) throw error;
    if (!write) return fallback();
    return onMissingDurableWrite({
      storeTag: "social-interactions",
      migrationHint: "apply migration 0073",
      fallback,
    });
  }
}

function keyHash(actor: SocialInteractionActor, action: string, key: string): string {
  return hashActor(`social-idempotency:${actor.profileId}:${action}:${key}`);
}

export const supabaseSocialInteractionStore: SocialInteractionStore = {
  async setDesired(actor, postId, kind, active) {
    return durableOrMemory(async () => {
      const { error } = await requireSupabaseAdmin().rpc("set_social_desired_interaction", {
        p_actor: actor.profileId,
        p_post_id: postId,
        p_kind: kind,
        p_active: active,
        p_actor_handle: actor.handle,
      });
      if (error) throw error;
    }, () => memorySocialInteractionStore.setDesired(actor, postId, kind, active), true);
  },

  async summary(viewer, postId) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_interaction_summary", {
        p_viewer: viewer.profileId,
        p_post_id: postId,
      });
      if (error) throw error;
      const value = row((data ?? [])[0]);
      return {
        cheered: value.cheered === true,
        saved: value.saved === true,
        reposted: value.reposted === true,
        cheerCount: Number(value.cheer_count ?? 0),
        repostCount: Number(value.repost_count ?? 0),
      };
    }, () => memorySocialInteractionStore.summary(viewer, postId), false);
  },

  async listCheers(viewer, postId, input) {
    const size = limit(input.limit);
    const scope = `cheers:${postId}`;
    const cursor = durableCursor(input.cursor, viewer, scope);
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_cheers", {
        p_viewer: viewer.profileId,
        p_post_id: postId,
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_profile_id: cursor?.id ?? null,
        p_limit: size + 1,
      });
      if (error) throw error;
      const rows = (data ?? []).map((value: unknown) => {
        const valueRow = row(value);
        return {
          id: String(valueRow.profile_id),
          createdAt: String(valueRow.created_at),
          profileId: String(valueRow.profile_id),
          handle: String(valueRow.handle),
        };
      });
      const page = durablePage<{ id: string; createdAt: string; profileId: string; handle: string }>(rows, viewer, scope, size);
      return {
        items: page.items.map(({ profileId, handle }) => ({ profileId, handle })),
        nextCursor: page.nextCursor,
      };
    }, () => memorySocialInteractionStore.listCheers(viewer, postId, input), false);
  },

  async listSaved(viewer, input) {
    const size = limit(input.limit);
    const cursor = durableCursor(input.cursor, viewer, "saves");
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_saves", {
        p_viewer: viewer.profileId,
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_post_id: cursor?.id ?? null,
        p_limit: size + 1,
      });
      if (error) throw error;
      const items: Array<{ id: string; createdAt: string; savedAt: string; post: SocialPostDTO }> = (data ?? []).map((value: unknown) => {
        const valueRow = row(value);
        const post = socialPostServerProjectionFromRow(valueRow.source_post).post;
        return { id: post.id, createdAt: String(valueRow.saved_at), savedAt: String(valueRow.saved_at), post };
      });
      const pageResult = durablePage(items, viewer, "saves", size);
      return {
        items: pageResult.items.map(({ savedAt, post }) => ({ savedAt, post })),
        nextCursor: pageResult.nextCursor,
      };
    }, () => memorySocialInteractionStore.listSaved(viewer, input), false);
  },

  async createComment(actor, postId, input) {
    const body = cleanSocialText(input.body, 1_000);
    if (!body || !validIdempotencyKey(input.idempotencyKey)) throw new SocialInteractionStoreError("INVALID_INTERACTION", "Comment request is not valid.");
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("create_social_comment", {
        p_actor: actor.profileId,
        p_post_id: postId,
        p_author_handle: actor.handle,
        p_body: body,
        p_idempotency_key_hash: keyHash(actor, "comment", input.idempotencyKey),
        p_payload_digest: payloadDigest({ postId, body }),
      });
      if (error) {
        if (/idempotency conflict/i.test(error.message ?? "")) throw new SocialInteractionStoreError("IDEMPOTENCY_CONFLICT", "That request key was already used for different content.");
        if (/comments not allowed/i.test(error.message ?? "")) throw new SocialInteractionStoreError("COMMENTS_NOT_ALLOWED", "Comments are closed for this post.");
        throw error;
      }
      return commentFromRow((data ?? [])[0]);
    }, () => memorySocialInteractionStore.createComment(actor, postId, input), true);
  },

  async listComments(viewer, postId, input) {
    const size = limit(input.limit);
    const scope = `comments:${postId}`;
    const cursor = durableCursor(input.cursor, viewer, scope);
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_comments", {
        p_viewer: viewer.profileId,
        p_post_id: postId,
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_id: cursor?.id ?? null,
        p_limit: size + 1,
      });
      if (error) throw error;
      return durablePage((data ?? []).map(commentFromRow), viewer, scope, size);
    }, () => memorySocialInteractionStore.listComments(viewer, postId, input), false);
  },

  async setCommentPolicy(actor, postId, policy) {
    const posts = socialPostStore();
    const current = await posts.read(postId, actor as SocialPostActor);
    if (!current) {
      throw new SocialInteractionStoreError("NOT_FOUND", "Post not found.");
    }
    try {
      await posts.edit(postId, actor as SocialPostActor, current.mutationVersion, { commentPolicy: policy }, false);
    } catch (error) {
      if (error instanceof SocialPostStoreError) {
        if (error.code === "EDIT_CONFLICT") throw new SocialInteractionStoreError("EDIT_CONFLICT", "Post changed before comment policy was saved.");
        if (error.code === "FORBIDDEN") throw new SocialInteractionStoreError("FORBIDDEN", "Only the post author can change comments.");
        if (error.code === "NOT_FOUND") throw new SocialInteractionStoreError("NOT_FOUND", "Post not found.");
      }
      throw error;
    }
  },

  async createQuote(actor, postId, input) {
    const body = cleanSocialText(input.body, 2_000);
    if (!body || !validIdempotencyKey(input.idempotencyKey) || !["public", "friends", "private"].includes(input.visibility)) {
      throw new SocialInteractionStoreError("INVALID_INTERACTION", "Quote request is not valid.");
    }
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("create_social_quote", {
        p_actor: actor.profileId,
        p_post_id: postId,
        p_author_handle: actor.handle,
        p_body: body,
        p_visibility: input.visibility,
        p_idempotency_key_hash: keyHash(actor, "quote", input.idempotencyKey),
        p_payload_digest: payloadDigest({ postId, body, visibility: input.visibility }),
      });
      if (error) {
        if (/idempotency conflict/i.test(error.message ?? "")) throw new SocialInteractionStoreError("IDEMPOTENCY_CONFLICT", "That request key was already used for different content.");
        throw error;
      }
      const value = row((data ?? [])[0]);
      const sourcePost = await socialPostStore().read(String(value.source_post_id), actor);
      if (!sourcePost) throw new SocialInteractionStoreError("NOT_FOUND", "Post not found.");
      return {
        id: String(value.id),
        kind: "quote" as const,
        sourcePost,
        body: String(value.body),
        visibility: value.visibility as SocialPostVisibility,
        author: { handle: String(value.author_handle) },
        moderationState: (value.moderation_state ?? "pending") as SocialModerationState,
        createdAt: String(value.created_at),
      };
    }, () => memorySocialInteractionStore.createQuote(actor, postId, input), true);
  },

  async listDerivatives(viewer, input) {
    const size = limit(input.limit);
    const cursor = durableCursor(input.cursor, viewer, "derivatives");
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_derivatives", {
        p_viewer: viewer.profileId,
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_id: cursor?.id ?? null,
        p_limit: size + 1,
      });
      if (error) throw error;
      const items = (data ?? []).map((value: unknown): SocialDerivativeDTO => {
        const valueRow = row(value);
        return {
          id: String(valueRow.id),
          kind: valueRow.kind === "quote" ? "quote" : "repost",
          sourcePost: socialPostServerProjectionFromRow(valueRow.source_post).post,
          body: typeof valueRow.body === "string" ? valueRow.body : null,
          visibility: valueRow.visibility as SocialPostVisibility,
          author: { handle: String(valueRow.author_handle) },
          moderationState: "approved",
          createdAt: String(valueRow.created_at),
        };
      });
      return durablePage(items, viewer, "derivatives", size);
    }, () => memorySocialInteractionStore.listDerivatives(viewer, input), false);
  },

  async processModerationQueue(adapter, requestedLimit = 20) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("claim_social_interaction_moderation_jobs", {
        p_limit: Math.min(Math.max(requestedLimit, 1), 50),
      });
      if (error) throw error;
      const result: ModerationResult = { processed: 0, approved: 0, needsReview: 0, retried: 0, terminalErrors: 0 };
      const settlements = await Promise.allSettled((data ?? []).map(async (value: unknown) => {
        const valueRow = row(value);
        const kind = String(valueRow.content_kind);
        const contentId = String(valueRow.content_id);
        result.processed += 1;
        try {
          const moderation = await adapter.moderate({ postId: contentId, text: String(valueRow.moderation_claim) });
          const completion = await requireSupabaseAdmin().rpc("complete_social_interaction_moderation_job", {
            p_kind: kind,
            p_content_id: contentId,
            p_decision: moderation.decision,
            p_error_code: null,
            p_retry_at: null,
          });
          if (completion.error) throw completion.error;
          if (completion.data !== true) return;
          if (moderation.decision === "approved") result.approved += 1;
          else result.needsReview += 1;
        } catch (moderationError) {
          const attempts = Number(valueRow.attempts ?? 1);
          const retryable = moderationJobShouldRetry(moderationError, attempts);
          const retryAt = retryable
            ? new Date(Date.now() + moderationRetryBackoffMs(attempts)).toISOString()
            : null;
          const completion = await requireSupabaseAdmin().rpc("complete_social_interaction_moderation_job", {
            p_kind: kind,
            p_content_id: contentId,
            p_decision: null,
            p_error_code: moderationError instanceof Error ? moderationError.name.slice(0, 120) : "provider_error",
            p_retry_at: retryAt,
          });
          if (completion.error) throw completion.error;
          if (completion.data !== true) return;
          if (retryable) result.retried += 1;
          else result.terminalErrors += 1;
        }
      }));
      if (settlements.some((settlement) => settlement.status === "rejected")) {
        throw new Error("Social interaction moderation completion failed.");
      }
      return result;
    }, () => memorySocialInteractionStore.processModerationQueue(adapter, requestedLimit), true);
  },

  async setBlock(actor, targetProfileId, active) {
    return durableOrMemory(async () => {
      const { error } = await requireSupabaseAdmin().rpc("set_social_block", {
        p_actor: actor.profileId,
        p_target: targetProfileId,
        p_active: active,
      });
      if (error) throw error;
    }, () => memorySocialInteractionStore.setBlock(actor, targetProfileId, active), true);
  },

  async notifications(viewer, input) {
    const size = limit(input.limit);
    const cursor = durableCursor(input.cursor, viewer, "notifications");
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_notifications", {
        p_viewer: viewer.profileId,
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_id: cursor?.id ?? null,
        p_limit: size + 1,
      });
      if (error) throw error;
      return durablePage((data ?? []).map(notificationFromRow), viewer, "notifications", size);
    }, () => memorySocialInteractionStore.notifications(viewer, input), false);
  },

  async markNotificationRead(viewer, id, read) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("mark_social_notification_read", {
        p_viewer: viewer.profileId,
        p_id: id,
        p_read: read,
      });
      if (error) throw error;
      if (data !== true) throw new SocialInteractionStoreError("NOT_FOUND", "Notification not found.");
    }, () => memorySocialInteractionStore.markNotificationRead(viewer, id, read), true);
  },

  async updateFeatureRequest(actor, postId, input) {
    const response = cleanSocialText(input.response, 2_000);
    if (!response || !validIdempotencyKey(input.idempotencyKey) || !["planned", "shipped", "declined"].includes(input.status)) {
      throw new SocialInteractionStoreError("INVALID_INTERACTION", "Feature update is not valid.");
    }
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("append_social_feature_update", {
        p_actor: actor.profileId,
        p_post_id: postId,
        p_status: input.status,
        p_response: response,
        p_idempotency_key_hash: keyHash(actor, "feature-update", input.idempotencyKey),
        p_payload_digest: payloadDigest({ postId, status: input.status, response }),
      });
      if (error) {
        if (/staff required/i.test(error.message ?? "")) throw new SocialInteractionStoreError("STAFF_REQUIRED", "Named staff access is required.");
        if (/idempotency conflict/i.test(error.message ?? "")) throw new SocialInteractionStoreError("IDEMPOTENCY_CONFLICT", "That request key was already used for different content.");
        throw error;
      }
      const value = row((data ?? [])[0]);
      return {
        id: String(value.id),
        status: value.status as SocialFeatureStatus,
        response: String(value.response),
        staff: "PUBMAXX team" as const,
        createdAt: String(value.created_at),
      };
    }, () => memorySocialInteractionStore.updateFeatureRequest(actor, postId, input), true);
  },

  async featureHistory(viewer, postId, input) {
    const size = limit(input.limit);
    const scope = `feature:${postId}`;
    const cursor = durableCursor(input.cursor, viewer, scope);
    return durableOrMemory(async () => {
      const admin = requireSupabaseAdmin();
      const [{ data, error }, statusResult] = await Promise.all([
        admin.rpc("read_social_feature_history", {
          p_viewer: viewer.profileId,
          p_post_id: postId,
          p_before_created_at: cursor?.createdAt ?? null,
          p_before_id: cursor?.id ?? null,
          p_limit: size + 1,
        }),
        admin.rpc("read_social_feature_status", { p_viewer: viewer.profileId, p_post_id: postId }),
      ]);
      if (error) throw error;
      if (statusResult.error) throw statusResult.error;
      const items = (data ?? []).map((value: unknown): SocialFeatureUpdateDTO => {
        const valueRow = row(value);
        return {
          id: String(valueRow.id),
          status: valueRow.status as SocialFeatureStatus,
          response: String(valueRow.response),
          staff: "PUBMAXX team",
          createdAt: String(valueRow.created_at),
        };
      });
      const pageResult = durablePage<SocialFeatureUpdateDTO>(items, viewer, scope, size);
      const statusValue = (statusResult.data ?? [])[0];
      if (!statusValue) throw new SocialInteractionStoreError("NOT_FOUND", "Feature request not found.");
      const statusRow = row(statusValue);
      return {
        ...pageResult,
        items: pageResult.items.sort(oldest),
        currentStatus: String(statusRow.current_status) as SocialFeatureStatus,
      };
    }, () => memorySocialInteractionStore.featureHistory(viewer, postId, input), false);
  },

  async report(actor, input) {
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("report_social_content", {
        p_actor: actor.profileId,
        p_kind: input.kind,
        p_content_id: input.id,
        p_reason: input.reason,
      });
      if (error) throw error;
      const value = row((data ?? [])[0]);
      return { id: String(value.id), createdAt: String(value.created_at) };
    }, () => memorySocialInteractionStore.report(actor, input), true);
  },

  async reportQueue(actor, input) {
    const size = limit(input.limit);
    const scope = "report-queue";
    const cursor = durableCursor(input.cursor, actor, scope);
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_report_queue", {
        p_actor: actor.profileId,
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_id: cursor?.id ?? null,
        p_limit: size + 1,
      });
      if (error) throw error;
      return durablePage((data ?? []).map(reportFromRow), actor, scope, size);
    }, () => memorySocialInteractionStore.reportQueue(actor, input), false);
  },

  async resolveReport(actor, id) {
    return durableOrMemory(async () => {
      const { error } = await requireSupabaseAdmin().rpc("resolve_social_report", {
        p_actor: actor.profileId,
        p_report_id: id,
      });
      if (error) throw error;
    }, () => memorySocialInteractionStore.resolveReport(actor, id), true);
  },

  async moderate(actor, input) {
    return durableOrMemory(async () => {
      const { error } = await requireSupabaseAdmin().rpc("moderate_social_interaction", {
        p_actor: actor.profileId,
        p_kind: input.kind,
        p_content_id: input.id,
        p_action: input.action,
      });
      if (error) {
        if (/staff required/i.test(error.message ?? "")) throw new SocialInteractionStoreError("STAFF_REQUIRED", "Named staff access is required.");
        if (/queued report required/i.test(error.message ?? "")) throw new SocialInteractionStoreError("FORBIDDEN", "A queued report is required for moderation.");
        throw error;
      }
    }, () => memorySocialInteractionStore.moderate(actor, input), true);
  },

  async featureQueue(actor, input) {
    const size = limit(input.limit);
    const scope = "feature-queue";
    const cursor = durableCursor(input.cursor, actor, scope);
    return durableOrMemory(async () => {
      const { data, error } = await requireSupabaseAdmin().rpc("read_social_feature_queue", {
        p_actor: actor.profileId,
        p_before_created_at: cursor?.createdAt ?? null,
        p_before_id: cursor?.id ?? null,
        p_limit: size + 1,
      });
      if (error) {
        if (/staff required/i.test(error.message ?? "")) throw new SocialInteractionStoreError("STAFF_REQUIRED", "Named staff access is required.");
        throw error;
      }
      const items = (data ?? []).map((value: unknown) => socialPostServerProjectionFromRow(value).post);
      return durablePage(items, actor, scope, size);
    }, () => memorySocialInteractionStore.featureQueue(actor, input), false);
  },
};

export function socialInteractionStore(): SocialInteractionStore {
  if (requiresSupabaseStore()) return supabaseSocialInteractionStore;
  return selectStore(memorySocialInteractionStore, supabaseSocialInteractionStore);
}
