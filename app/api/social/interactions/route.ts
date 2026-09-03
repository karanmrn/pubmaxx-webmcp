import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { socialFreezeResponse } from "@/lib/opsFreeze";
import { requireVerifiedSocialActor } from "@/lib/socialAccessServer";
import {
  SocialInteractionStoreError,
  socialInteractionStore,
} from "@/lib/socialInteractionStore";
import { validIdempotencyKey } from "@/lib/socialInteractions";
import { hashActor } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WRITE_LIMIT = 30;
const WRITE_WINDOW_MS = 60_000;

type Actor = Extract<Awaited<ReturnType<typeof requireVerifiedSocialActor>>, { ok: true }>["actor"];

function privateJson(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "private, no-store");
  return Response.json(body, { ...init, headers });
}

function accessError(access: Exclude<Awaited<ReturnType<typeof requireVerifiedSocialActor>>, { ok: true }>): Response {
  return publicApiError(access.error, access.code, access.status, { retryable: access.retryable === true, headers: { "Cache-Control": "private, no-store" } });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function id(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

function page(url: URL): { cursor: string | null; limit: number } | null {
  const cursor = url.searchParams.get("cursor");
  const raw = url.searchParams.get("limit");
  const limit = raw === null ? 20 : Number(raw);
  return Number.isInteger(limit) && limit >= 1 && limit <= 50
    ? { cursor, limit }
    : null;
}

async function verified(request: Request): Promise<{ actor: Actor } | { response: Response }> {
  const access = await requireVerifiedSocialActor(request);
  return access.ok ? { actor: access.actor } : { response: accessError(access) };
}

async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return record(await request.json());
  } catch {
    return null;
  }
}

function isUrgentReport(input: Record<string, unknown>): boolean {
  return input.action === "report" && (input.reason === "threat" || input.reason === "doxxing");
}

function bypassesSocialFreeze(action: unknown): boolean {
  return action === "report" || action === "moderate" || action === "report_resolution";
}

async function writeActor(
  request: Request,
  options: {
  bypassFreeze?: boolean;
  bypassRateLimit?: boolean;
} = {}): Promise<{ actor: Actor } | { response: Response }> {
  if (!options.bypassFreeze) {
    const frozen = socialFreezeResponse();
    if (frozen) return { response: frozen };
  }
  const access = await verified(request);
  if ("response" in access) return access;
  const key = `social-interaction:${hashActor(access.actor.profileId)}`;
  if (!options.bypassRateLimit && await isLimited(key, key, WRITE_LIMIT, WRITE_WINDOW_MS)) {
    return {
      response: publicApiError("Too many Social changes. Slow down.", "RATE_LIMITED", 429, { retryable: true, headers: { "Cache-Control": "private, no-store" } }),
    };
  }
  return access;
}

function storeError(error: unknown): Response {
  if (error instanceof SocialInteractionStoreError) {
    const status = error.code === "INVALID_INTERACTION" || error.code === "INVALID_CURSOR"
      ? 400
      : error.code === "IDEMPOTENCY_CONFLICT" || error.code === "EDIT_CONFLICT"
        ? 409
        : error.code === "COMMENTS_NOT_ALLOWED" || error.code === "FORBIDDEN" || error.code === "STAFF_REQUIRED"
          ? 403
          : 404;
    return publicApiError(error.message, error.code, status, { headers: { "Cache-Control": "private, no-store" } });
  }
  return publicApiError("Social interactions are unavailable right now.", "SOCIAL_INTERACTION_UNAVAILABLE", 503, { retryable: true, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: Request): Promise<Response> {
  const access = await verified(request);
  if ("response" in access) return access.response;
  const url = new URL(request.url);
  const paging = page(url);
  if (!paging) return publicApiError("That page is not valid.", "INVALID_PAGE", 400, { headers: { "Cache-Control": "private, no-store" } });
  const view = url.searchParams.get("view");
  const postId = id(url.searchParams.get("postId"));
  try {
    switch (view) {
      case "summary":
        return postId
          ? privateJson({ summary: await socialInteractionStore().summary(access.actor, postId) })
          : publicApiError("Choose a post.", "INVALID_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
      case "comments":
        return postId
          ? privateJson(await socialInteractionStore().listComments(access.actor, postId, paging))
          : publicApiError("Choose a post.", "INVALID_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
      case "cheers":
        return postId
          ? privateJson(await socialInteractionStore().listCheers(access.actor, postId, paging))
          : publicApiError("Choose a post.", "INVALID_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
      case "saves":
        return privateJson(await socialInteractionStore().listSaved(access.actor, paging));
      case "derivatives":
        return privateJson(await socialInteractionStore().listDerivatives(access.actor, paging));
      case "notifications":
        return privateJson(await socialInteractionStore().notifications(access.actor, paging));
      case "feature_history":
        return postId
          ? privateJson(await socialInteractionStore().featureHistory(access.actor, postId, paging))
          : publicApiError("Choose a feature request.", "INVALID_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
      case "feature_queue":
        return privateJson(await socialInteractionStore().featureQueue(access.actor, paging));
      case "report_queue":
        return privateJson(await socialInteractionStore().reportQueue(access.actor, paging));
      default:
        return publicApiError("Choose an interaction view.", "INVALID_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
    }
  } catch (error) {
    return storeError(error);
  }
}

export async function PUT(request: Request): Promise<Response> {
  const access = await writeActor(request);
  if ("response" in access) return access.response;
  const input = await body(request);
  if (!input || typeof input.action !== "string") {
    return publicApiError("Request body is not valid.", "MALFORMED_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
  }
  try {
    if (input.action === "desired" && exactKeys(input, ["action", "postId", "kind"])) {
      const postId = id(input.postId);
      if (!postId || !["cheer", "save", "repost"].includes(String(input.kind))) throw new SocialInteractionStoreError("INVALID_INTERACTION", "Interaction details are not valid.");
      await socialInteractionStore().setDesired(access.actor, postId, input.kind as "cheer" | "save" | "repost", true);
      return privateJson({ ok: true });
    }
    if (input.action === "comment_policy" && exactKeys(input, ["action", "postId", "policy"])) {
      const postId = id(input.postId);
      if (!postId || !["open", "friends", "locked"].includes(String(input.policy))) throw new SocialInteractionStoreError("INVALID_INTERACTION", "Comment policy is not valid.");
      await socialInteractionStore().setCommentPolicy(access.actor, postId, input.policy as "open" | "friends" | "locked");
      return privateJson({ ok: true });
    }
    if (input.action === "block" && exactKeys(input, ["action", "targetProfileId"])) {
      const target = id(input.targetProfileId);
      if (!target) throw new SocialInteractionStoreError("INVALID_INTERACTION", "Block details are not valid.");
      await socialInteractionStore().setBlock(access.actor, target, true);
      return privateJson({ ok: true });
    }
    return publicApiError("Interaction details are not valid.", "INVALID_INTERACTION", 400, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return storeError(error);
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const access = await writeActor(request);
  if ("response" in access) return access.response;
  const input = await body(request);
  if (!input || typeof input.action !== "string") return publicApiError("Request body is not valid.", "MALFORMED_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
  try {
    if (input.action === "desired" && exactKeys(input, ["action", "postId", "kind"])) {
      const postId = id(input.postId);
      if (!postId || !["cheer", "save", "repost"].includes(String(input.kind))) throw new SocialInteractionStoreError("INVALID_INTERACTION", "Interaction details are not valid.");
      await socialInteractionStore().setDesired(access.actor, postId, input.kind as "cheer" | "save" | "repost", false);
      return privateJson({ ok: true });
    }
    if (input.action === "block" && exactKeys(input, ["action", "targetProfileId"])) {
      const target = id(input.targetProfileId);
      if (!target) throw new SocialInteractionStoreError("INVALID_INTERACTION", "Block details are not valid.");
      await socialInteractionStore().setBlock(access.actor, target, false);
      return privateJson({ ok: true });
    }
    return publicApiError("Interaction details are not valid.", "INVALID_INTERACTION", 400, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return storeError(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  const input = await body(request);
  if (!input || typeof input.action !== "string") return publicApiError("Request body is not valid.", "MALFORMED_REQUEST", 400, { headers: { "Cache-Control": "private, no-store" } });
  const access = await writeActor(request, {
    bypassFreeze: bypassesSocialFreeze(input.action),
    bypassRateLimit: isUrgentReport(input),
  });
  if ("response" in access) return access.response;
  const idempotencyKey = request.headers.get("idempotency-key");
  try {
    if (input.action === "comment" && exactKeys(input, ["action", "postId", "body"])) {
      const postId = id(input.postId);
      if (!postId || !validIdempotencyKey(idempotencyKey)) throw new SocialInteractionStoreError("INVALID_INTERACTION", "Comment request is not valid.");
      const comment = await socialInteractionStore().createComment(access.actor, postId, { body: input.body as string, idempotencyKey });
      return privateJson({ comment }, { status: 202 });
    }
    if (input.action === "quote" && exactKeys(input, ["action", "postId", "body", "visibility"])) {
      const postId = id(input.postId);
      if (!postId || !validIdempotencyKey(idempotencyKey)) throw new SocialInteractionStoreError("INVALID_INTERACTION", "Quote request is not valid.");
      const quote = await socialInteractionStore().createQuote(access.actor, postId, {
        body: input.body as string,
        visibility: input.visibility as "public" | "friends" | "private",
        idempotencyKey,
      });
      return privateJson({ quote }, { status: 202 });
    }
    if (input.action === "feature_update" && exactKeys(input, ["action", "postId", "status", "response"])) {
      const postId = id(input.postId);
      if (!postId || !validIdempotencyKey(idempotencyKey)) throw new SocialInteractionStoreError("INVALID_INTERACTION", "Feature update request is not valid.");
      const update = await socialInteractionStore().updateFeatureRequest(access.actor, postId, {
        status: input.status as "planned" | "shipped" | "declined",
        response: input.response as string,
        idempotencyKey,
      });
      return privateJson({ update }, { status: 201 });
    }
    if (input.action === "report" && exactKeys(input, ["action", "kind", "id", "reason"])) {
      const targetId = id(input.id);
      if (!targetId || !["post", "comment", "quote"].includes(String(input.kind)) || !["harassment", "hate", "threat", "doxxing", "spam", "other"].includes(String(input.reason))) {
        throw new SocialInteractionStoreError("INVALID_INTERACTION", "Report details are not valid.");
      }
      const report = await socialInteractionStore().report(access.actor, {
        kind: input.kind as "post" | "comment" | "quote",
        id: targetId,
        reason: input.reason as "harassment" | "hate" | "threat" | "doxxing" | "spam" | "other",
      });
      return privateJson({ report }, { status: 202 });
    }
    if (input.action === "notification_read" && exactKeys(input, ["action", "id", "read"])) {
      const notificationId = id(input.id);
      if (!notificationId || typeof input.read !== "boolean") throw new SocialInteractionStoreError("INVALID_INTERACTION", "Notification change is not valid.");
      await socialInteractionStore().markNotificationRead(access.actor, notificationId, input.read);
      return privateJson({ ok: true });
    }
    if (input.action === "report_resolution" && exactKeys(input, ["action", "id"])) {
      const reportId = id(input.id);
      if (!reportId) throw new SocialInteractionStoreError("INVALID_INTERACTION", "Report resolution is not valid.");
      await socialInteractionStore().resolveReport(access.actor, reportId);
      return privateJson({ ok: true });
    }
    if (input.action === "moderate" && exactKeys(input, ["action", "kind", "id", "decision"])) {
      const targetId = id(input.id);
      if (!targetId || !["comment", "quote"].includes(String(input.kind)) || !["hide", "restore"].includes(String(input.decision))) {
        throw new SocialInteractionStoreError("INVALID_INTERACTION", "Moderation details are not valid.");
      }
      await socialInteractionStore().moderate(access.actor, {
        kind: input.kind as "comment" | "quote",
        id: targetId,
        action: input.decision as "hide" | "restore",
      });
      return privateJson({ ok: true });
    }
    return publicApiError("Interaction details are not valid.", "INVALID_INTERACTION", 400, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return storeError(error);
  }
}
