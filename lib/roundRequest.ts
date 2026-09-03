import type { Session } from "@supabase/supabase-js";

import {
  accountBoundFetch,
  captureAccountAuth,
  type AccountAuthSnapshot,
  type AccountBoundRequest,
} from "@/lib/accountBoundFetch";
import { normalizeHandle } from "@/lib/profiles";

export type RoundRequestIdentity =
  | Readonly<{ kind: "anonymous" }>
  | Readonly<{ kind: "account"; auth: AccountAuthSnapshot }>;

export type RoundAppendSnapshot = Readonly<{
  identity: RoundRequestIdentity;
  handle: string;
  code: string;
}>;

const ROUND_ANONYMOUS_IDENTITY_KEY = "pubmax_round_anonymous_identity_v1";

export function readRoundAnonymousHandle(
  storage: Pick<Storage, "getItem"> | null,
): string {
  if (!storage) return "";
  try {
    const raw = JSON.parse(
      storage.getItem(ROUND_ANONYMOUS_IDENTITY_KEY) ?? "null",
    ) as { owner?: unknown; handle?: unknown } | null;
    return raw?.owner === "anonymous" && typeof raw.handle === "string"
      ? normalizeHandle(raw.handle)
      : "";
  } catch {
    return "";
  }
}

export function writeRoundAnonymousHandle(
  identity: RoundRequestIdentity,
  handle: string,
  storage: Pick<Storage, "setItem"> | null,
): string {
  if (identity.kind !== "anonymous" || !storage) return "";
  const clean = normalizeHandle(handle);
  if (!clean) return "";
  try {
    storage.setItem(
      ROUND_ANONYMOUS_IDENTITY_KEY,
      JSON.stringify({ owner: "anonymous", handle: clean }),
    );
    return clean;
  } catch {
    return "";
  }
}

export function clearClaimedRoundAnonymousHandle(
  handle: string,
  storage: Pick<Storage, "getItem" | "removeItem"> | null,
): boolean {
  if (!storage) return false;
  const claimed = normalizeHandle(handle);
  if (!claimed || readRoundAnonymousHandle(storage) !== claimed) return false;
  try {
    storage.removeItem(ROUND_ANONYMOUS_IDENTITY_KEY);
    return true;
  } catch {
    return false;
  }
}

export function roundHandleForIdentity(
  identity: RoundRequestIdentity | null,
  accountHandle: string | null,
  storage: Pick<Storage, "getItem"> | null,
): string {
  if (!identity) return "";
  return identity.kind === "account"
    ? normalizeHandle(accountHandle ?? "")
    : readRoundAnonymousHandle(storage);
}

export function captureRoundAppendSnapshot(
  identity: RoundRequestIdentity | null,
  accountHandle: string | null,
  code: string,
  storage: Pick<Storage, "getItem"> | null,
): RoundAppendSnapshot | null {
  const handle = roundHandleForIdentity(identity, accountHandle, storage);
  if (!identity || !handle || !code) return null;
  return { identity, handle, code };
}

export function roundRequestIdentityOwnerKey(
  identity: RoundRequestIdentity | null,
): string | null {
  if (!identity) return null;
  return identity.kind === "account"
    ? `account:${identity.auth.userId}`
    : "anonymous";
}

async function runRoundMutationWhileCurrent<T>(
  capturedOwner: string | null,
  currentOwner: () => string | null,
  operation: () => Promise<T>,
): Promise<{ current: false } | { current: true; value: T }> {
  if (capturedOwner !== currentOwner()) {
    return { current: false };
  }
  try {
    const value = await operation();
    return capturedOwner === currentOwner()
      ? { current: true, value }
      : { current: false };
  } catch (error) {
    if (capturedOwner !== currentOwner()) {
      return { current: false };
    }
    throw error;
  }
}

export function runRoundMutationForCurrentOwner<T>(
  captured: RoundRequestIdentity,
  current: () => RoundRequestIdentity | null,
  operation: () => Promise<T>,
): Promise<{ current: false } | { current: true; value: T }> {
  return runRoundMutationWhileCurrent(
    roundRequestIdentityOwnerKey(captured),
    () => roundRequestIdentityOwnerKey(current()),
    operation,
  );
}

export async function runRoundMutationForCurrentUser<T>(
  captured: RoundRequestIdentity,
  currentUserId: () => string | null,
  operation: () => Promise<T>,
): Promise<{ current: false } | { current: true; value: T }> {
  const capturedUserId =
    captured.kind === "account" ? captured.auth.userId : null;
  return runRoundMutationWhileCurrent(
    capturedUserId,
    currentUserId,
    operation,
  );
}

export function captureRoundRequestIdentity(
  expectedUserId: string | null,
  session: Pick<Session, "access_token" | "user"> | null,
): RoundRequestIdentity | null {
  if (!expectedUserId) {
    return session ? null : { kind: "anonymous" };
  }
  const auth = captureAccountAuth(expectedUserId, session);
  return auth ? { kind: "account", auth } : null;
}

export function roundRequest(
  input: RequestInfo | URL,
  identity: RoundRequestIdentity,
  init: RequestInit = {},
  request: AccountBoundRequest = fetch,
): Promise<Response> {
  return identity.kind === "account"
    ? accountBoundFetch(identity.auth, input, init, request)
    : request(input, init);
}

export function roundJsonRequest(
  input: RequestInfo | URL,
  identity: RoundRequestIdentity,
  body: unknown,
  request: AccountBoundRequest = fetch,
): Promise<Response> {
  return roundRequest(
    input,
    identity,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    request,
  );
}
