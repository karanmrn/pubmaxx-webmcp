// Firebase Cloud Messaging HTTP v1 delivery for Android registrations.
// Credentials stay server-only. Fixed Google endpoints prevent credential
// forwarding to an operator-controlled host.

import "server-only";

import { createPrivateKey, sign as cryptoSign } from "node:crypto";

import type { PerTokenResult, PushPayload, PushProvider } from "@/lib/pushProvider";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const FCM_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SEND_ORIGIN = "https://fcm.googleapis.com";
const FCM_REQUEST_TIMEOUT_MS = 10_000;
const FCM_TOKEN_REUSE_MARGIN_MS = 60_000;

export type FcmConfig = {
  projectId: string;
  clientEmail: string;
  privateKeyId: string;
  privateKey: string;
};

export type FcmFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type FcmAccessTokenCacheEntry = {
  token: string;
  expiresAtMs: number;
};

export type FcmProviderDeps = {
  config?: () => FcmConfig;
  fetch?: FcmFetch;
  now?: () => number;
  accessTokenCache?: Map<string, FcmAccessTokenCacheEntry>;
  refreshes?: Map<string, Promise<string>>;
};

const moduleAccessTokenCache = new Map<string, FcmAccessTokenCacheEntry>();
const moduleRefreshes = new Map<string, Promise<string>>();

function base64url(input: string | Buffer): string {
  return (typeof input === "string" ? Buffer.from(input, "utf8") : input).toString("base64url");
}

/** All credentials must exist before Android delivery can become active. */
export function isFcmConfigured(): boolean {
  return Boolean(
    process.env.FCM_PROJECT_ID
      && process.env.FCM_CLIENT_EMAIL
      && process.env.FCM_PRIVATE_KEY_ID
      && process.env.FCM_PRIVATE_KEY,
  );
}

/** Distinguish an empty local setup from a broken partial production setup. */
export function isFcmConfigurationPresent(): boolean {
  return Boolean(
    process.env.FCM_PROJECT_ID
      || process.env.FCM_CLIENT_EMAIL
      || process.env.FCM_PRIVATE_KEY_ID
      || process.env.FCM_PRIVATE_KEY,
  );
}

function resolveFcmConfig(): FcmConfig {
  const projectId = process.env.FCM_PROJECT_ID?.trim();
  const clientEmail = process.env.FCM_CLIENT_EMAIL?.trim();
  const privateKeyId = process.env.FCM_PRIVATE_KEY_ID?.trim();
  const privateKey = process.env.FCM_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!projectId || !clientEmail || !privateKeyId || !privateKey) {
    throw new Error(
      "fcmPushProvider: FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY_ID and FCM_PRIVATE_KEY must all be set.",
    );
  }
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new Error("fcmPushProvider: FCM_PROJECT_ID is not a valid Google Cloud project ID.");
  }
  if (!/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(clientEmail)) {
    throw new Error("fcmPushProvider: FCM_CLIENT_EMAIL is not a service-account email.");
  }
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(privateKeyId)) {
    throw new Error("fcmPushProvider: FCM_PRIVATE_KEY_ID is not valid.");
  }
  createPrivateKey(privateKey);
  return { projectId, clientEmail, privateKeyId, privateKey };
}

/** Build the RS256 assertion used by Google's service-account OAuth flow. */
export function buildFcmServiceAccountJwt(params: FcmConfig & { iat: number }): string {
  const header = base64url(JSON.stringify({
    alg: "RS256",
    typ: "JWT",
    kid: params.privateKeyId,
  }));
  const claims = base64url(JSON.stringify({
    iss: params.clientEmail,
    scope: FCM_SCOPE,
    aud: FCM_TOKEN_URL,
    iat: params.iat,
    exp: params.iat + 3_600,
  }));
  const signingInput = `${header}.${claims}`;
  const signature = cryptoSign(
    "RSA-SHA256",
    Buffer.from(signingInput, "utf8"),
    createPrivateKey(params.privateKey),
  );
  return `${signingInput}.${base64url(signature)}`;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function refreshFcmAccessToken(params: {
  config: FcmConfig;
  fetch: FcmFetch;
  nowMs: number;
  cache: Map<string, FcmAccessTokenCacheEntry>;
}): Promise<string> {
  const assertion = buildFcmServiceAccountJwt({
    ...params.config,
    iat: Math.floor(params.nowMs / 1_000),
  });
  const response = await params.fetch(FCM_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
    signal: AbortSignal.timeout(FCM_REQUEST_TIMEOUT_MS),
  });
  const raw = await readJson(response);
  const body = raw && typeof raw === "object"
    ? raw as { access_token?: unknown; expires_in?: unknown }
    : {};
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 0;
  if (!response.ok || typeof body.access_token !== "string" || expiresIn <= 0) {
    throw new Error(`fcmPushProvider: OAuth token exchange failed (${response.status}).`);
  }
  params.cache.set(`${params.config.projectId}:${params.config.clientEmail}`, {
    token: body.access_token,
    expiresAtMs: params.nowMs + expiresIn * 1_000,
  });
  return body.access_token;
}

async function getFcmAccessToken(params: {
  config: FcmConfig;
  fetch: FcmFetch;
  nowMs: number;
  cache: Map<string, FcmAccessTokenCacheEntry>;
  refreshes: Map<string, Promise<string>>;
}): Promise<string> {
  const cacheKey = `${params.config.projectId}:${params.config.clientEmail}`;
  const cached = params.cache.get(cacheKey);
  if (cached && cached.expiresAtMs - params.nowMs > FCM_TOKEN_REUSE_MARGIN_MS) {
    return cached.token;
  }
  const activeRefresh = params.refreshes.get(cacheKey);
  if (activeRefresh) return activeRefresh;

  const refresh = refreshFcmAccessToken(params).finally(() => {
    params.refreshes.delete(cacheKey);
  });
  params.refreshes.set(cacheKey, refresh);
  return refresh;
}

type FcmErrorBody = {
  error?: {
    status?: unknown;
    details?: unknown;
  };
};

function fcmResponseCode(raw: unknown): string {
  const body = raw && typeof raw === "object" ? raw as FcmErrorBody : {};
  const status = typeof body.error?.status === "string" ? body.error.status : "UNKNOWN";
  const details = Array.isArray(body.error?.details) ? body.error.details : [];
  const fcmDetail = details.find((detail) => {
    if (!detail || typeof detail !== "object") return false;
    return (detail as { "@type"?: unknown })["@type"] ===
      "type.googleapis.com/google.firebase.fcm.v1.FcmError";
  }) as { errorCode?: unknown } | undefined;
  return typeof fcmDetail?.errorCode === "string" ? fcmDetail.errorCode : status;
}

function fcmMessageBody(token: string, payload: PushPayload): string {
  return JSON.stringify({
    message: {
      token,
      notification: { title: payload.title, body: payload.body },
      data: payload.data ?? {},
      android: {
        priority: "HIGH",
        ttl: "21600s",
        notification: {
          sound: "default",
          ...(payload.threadId ? { tag: payload.threadId } : {}),
        },
      },
    },
  });
}

async function sendOneFcm(params: {
  token: string;
  payload: PushPayload;
  projectId: string;
  accessToken: string;
  fetch: FcmFetch;
}): Promise<PerTokenResult> {
  let response: Response;
  try {
    response = await params.fetch(
      `${FCM_SEND_ORIGIN}/v1/projects/${encodeURIComponent(params.projectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${params.accessToken}`,
          "content-type": "application/json",
        },
        body: fcmMessageBody(params.token, params.payload),
        signal: AbortSignal.timeout(FCM_REQUEST_TIMEOUT_MS),
      },
    );
  } catch (err) {
    console.error(
      "[pushProvider:fcm] request failed:",
      err instanceof Error ? err.message : String(err),
    );
    return { token: params.token, status: "error", reason: "fcm_request_failed" };
  }
  if (response.ok) return { token: params.token, status: "sent" };

  const code = fcmResponseCode(await readJson(response));
  const reason = `fcm_${code.toLowerCase()}`;
  if (response.status === 404 && code === "UNREGISTERED") {
    return { token: params.token, status: "invalid", reason };
  }
  return { token: params.token, status: "error", reason };
}

/** FCM HTTP v1 provider. OAuth/config failures throw at provider level. Each
 * message response stays per-token so only unregistered devices are pruned. */
export function createFcmPushProvider(deps: FcmProviderDeps = {}): PushProvider {
  const resolveConfig = deps.config ?? resolveFcmConfig;
  const fetchRequest = deps.fetch ?? globalThis.fetch.bind(globalThis);
  const now = deps.now ?? Date.now;
  const accessTokenCache = deps.accessTokenCache ?? moduleAccessTokenCache;
  const refreshes = deps.refreshes ?? moduleRefreshes;
  return {
    async send(tokens, payload) {
      if (tokens.length === 0) return [];
      const config = resolveConfig();
      const accessToken = await getFcmAccessToken({
        config,
        fetch: fetchRequest,
        nowMs: now(),
        cache: accessTokenCache,
        refreshes,
      });
      return Promise.all(tokens.map((token) => sendOneFcm({
        token,
        payload,
        projectId: config.projectId,
        accessToken,
        fetch: fetchRequest,
      })));
    },
  };
}

export const fcmPushProvider: PushProvider = createFcmPushProvider();

/** Missing Firebase credentials must never fall back to APNs. */
export const noopFcmPushProvider: PushProvider = {
  async send(tokens, payload) {
    if (tokens.length > 0) {
      console.info(
        `[pushProvider:fcm:noop] would deliver "${payload.title}" to ${tokens.length} Android token(s) - FCM not configured; skipping.`,
      );
    }
    return tokens.map((token) => ({ token, status: "skipped", reason: "fcm_not_configured" }));
  },
};
