// Browser fetch helper that attaches the Supabase access token when signed in.
// Wave I2: ownership-sensitive social reads/writes (messages, notifications)
// must send `Authorization: Bearer` so gateHandleAction / resolveMessageHandle
// can verify the caller. Anonymous requests remain valid for unlinked demo
// handles — matching ProfileEditor's pattern.

import { getAccessToken } from "@/lib/authClient";
import {
  readProviderIdentityRevision,
  readProviderIdentitySignal,
} from "@/lib/authProviderRevision";

export const AUTH_ACTION_SESSION_ERROR_MESSAGE = "Still waking your session - try again.";

export type AuthActionState = Readonly<{
  status: "unknown" | "signed-out" | "signed-in";
  /** The existing AuthProvider identityResolved signal. */
  identityResolved: boolean;
}>;

const AUTH_ACTION_TOKEN_TIMEOUT_MS = 2_000;
const AUTH_ACTION_TOKEN_RETRY_DELAYS_MS = [0, 50, 150, 350, 650, 800] as const;

let authActionState: AuthActionState = {
  status: "unknown",
  identityResolved: false,
};
const authActionStateListeners = new Set<() => void>();

function currentAuthActionStatus(): AuthActionState["status"] {
  return authActionState.status;
}

/** Publishes the existing AuthProvider state to non-React request callers. */
export function publishAuthActionState(next: AuthActionState): void {
  authActionState = next;
  for (const listener of authActionStateListeners) listener();
}

export class AuthActionSessionError extends Error {
  readonly code = "AUTH_SESSION_WAKING" as const;

  constructor() {
    super(AUTH_ACTION_SESSION_ERROR_MESSAGE);
    this.name = "AuthActionSessionError";
  }
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason === undefined ? abortError() : signal.reason;
}

type AccountBoundAction = Readonly<{
  signal: AbortSignal;
  accountRevision: number;
}>;

function callerActionSignals(
  input: RequestInfo | URL,
  initSignal?: AbortSignal,
): AbortSignal[] {
  const requestSignal = typeof Request !== "undefined" && input instanceof Request
    ? input.signal
    : undefined;
  const callerSignal = initSignal ?? requestSignal;
  return callerSignal ? [callerSignal] : [];
}

const fallbackAbortControllers = new WeakMap<AbortSignal, AbortController>();
const fallbackAbortFollowers = new WeakMap<
  AbortSignal,
  Set<WeakRef<AbortSignal>>
>();
// A live native Response reaches its action signal. The weak key never keeps
// a finished Response or its signal alive by itself.
const retainedActionSignals = new WeakMap<Response, AbortSignal>();

/** Test-only observer for the response-keyed signal lifetime contract. */
export function readRetainedActionSignalForTest(
  response: Response,
): AbortSignal | undefined {
  return retainedActionSignals.get(response);
}

/** Test-only observer for deterministic fallback cleanup checks. */
export function readFallbackFollowerCountForTest(source: AbortSignal): number {
  return fallbackAbortFollowers.get(source)?.size ?? 0;
}

function sourceAbortFollowers(source: AbortSignal): Set<WeakRef<AbortSignal>> {
  const existing = fallbackAbortFollowers.get(source);
  if (existing) return existing;

  const followers = new Set<WeakRef<AbortSignal>>();
  source.addEventListener("abort", () => {
    for (const reference of followers) {
      const signal = reference.deref();
      const controller = signal
        ? fallbackAbortControllers.get(signal)
        : undefined;
      if (controller && !signal?.aborted) {
        controller.abort(abortReason(source));
      }
    }
    followers.clear();
  }, { once: true });
  fallbackAbortFollowers.set(source, followers);
  return followers;
}

function fallbackCompositeActionSignal(
  signals: readonly AbortSignal[],
): AbortSignal {
  const controller = new AbortController();
  const signal = controller.signal;
  fallbackAbortControllers.set(signal, controller);

  const alreadyAborted = signals.find((source) => source.aborted);
  if (alreadyAborted) {
    controller.abort(abortReason(alreadyAborted));
    return signal;
  }

  // One listener per source holds only weak dependent signals. The returned
  // Response keeps its signal live; first abort removes the same weak reference
  // from every source without wrapping the Response.
  const reference = new WeakRef(signal);
  const followerSets: Set<WeakRef<AbortSignal>>[] = [];
  signal.addEventListener("abort", () => {
    for (const followers of followerSets) followers.delete(reference);
  }, { once: true });
  for (const source of signals) {
    const followers = sourceAbortFollowers(source);
    for (const reference of followers) {
      const follower = reference.deref();
      if (!follower || follower.aborted) followers.delete(reference);
    }
    followers.add(reference);
    followerSets.push(followers);
  }
  return signal;
}

function compositeActionSignal(signals: readonly AbortSignal[]): AbortSignal {
  const distinctSignals = [...new Set(signals)];
  if (distinctSignals.length === 1) return distinctSignals[0] as AbortSignal;
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(distinctSignals);
  }
  return fallbackCompositeActionSignal(distinctSignals);
}

function bindAccountAction(callerSignals: readonly AbortSignal[]): AccountBoundAction {
  const accountRevision = readProviderIdentityRevision();
  const providerSignal = readProviderIdentitySignal();
  return {
    accountRevision,
    signal: compositeActionSignal([providerSignal, ...callerSignals]),
  };
}

function waitForAuthActionReadiness(deadline: number, signal?: AbortSignal): Promise<void> {
  if (
    authActionState.status === "signed-out" ||
    (authActionState.status === "signed-in" && authActionState.identityResolved)
  ) {
    return Promise.resolve();
  }
  if (signal?.aborted) return Promise.reject(abortReason(signal));

  return new Promise((resolve, reject) => {
    const finish = (error?: unknown): void => {
      clearTimeout(timer);
      authActionStateListeners.delete(check);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const check = (): void => {
      if (
        authActionState.status === "signed-out" ||
        (authActionState.status === "signed-in" && authActionState.identityResolved)
      ) {
        finish();
      }
    };
    const onAbort = (): void => finish(abortReason(signal as AbortSignal));
    authActionStateListeners.add(check);
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(finish, Math.max(0, deadline - Date.now()));
    check();
  });
}

function waitForTokenRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function readTokenBefore(deadline: number, signal?: AbortSignal): Promise<string | null> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.resolve(null);
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (token: string | null, error?: unknown): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(token);
    };
    const onAbort = (): void => finish(null, abortReason(signal as AbortSignal));
    const timeout = setTimeout(() => finish(null), remaining);
    signal?.addEventListener("abort", onAbort, { once: true });
    void getAccessToken()
      .then((token) => finish(token))
      .catch(() => finish(null));
  });
}

/**
 * Like `fetch`, but merges `Authorization: Bearer <jwt>` when a session exists.
 * Public reads may use this graceful transport when anonymous fallback is valid.
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  try {
    const token = await getAccessToken();
    if (token) headers.set("authorization", `Bearer ${token}`);
  } catch {
    // Signed-out / storage blocked — proceed anonymously.
  }
  return fetch(input, { ...init, headers });
}

type ActiveAuthActionResponse = Readonly<{
  signal: AbortSignal;
  accountRevision: number;
  response: Response;
}>;

async function activeAuthActionFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<ActiveAuthActionResponse> {
  const callerSignals = callerActionSignals(input, init.signal ?? undefined);
  const deadline = Date.now() + AUTH_ACTION_TOKEN_TIMEOUT_MS;
  let action = authActionState.status === "unknown"
    ? null
    : bindAccountAction(callerSignals);
  await waitForAuthActionReadiness(
    deadline,
    action?.signal ?? compositeActionSignal(callerSignals),
  );
  action ??= bindAccountAction(callerSignals);

  let token: string | null = null;
  for (const delayMs of AUTH_ACTION_TOKEN_RETRY_DELAYS_MS) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    if (delayMs > 0) {
      await waitForTokenRetry(Math.min(delayMs, remaining), action.signal);
    }
    if (Date.now() >= deadline) break;
    token = await readTokenBefore(deadline, action.signal);
    if (token || Date.now() >= deadline) break;
  }

  const headers = new Headers(init.headers);
  if (token) {
    headers.set("authorization", `Bearer ${token}`);
    const response = await fetch(input, { ...init, headers, signal: action.signal });
    retainedActionSignals.set(response, action.signal);
    return { ...action, response };
  }

  if (currentAuthActionStatus() !== "signed-out") {
    throw new AuthActionSessionError();
  }
  const response = await fetch(input, { ...init, headers, signal: action.signal });
  retainedActionSignals.set(response, action.signal);
  return { ...action, response };
}

/**
 * Fetch for a request whose server action requires the signed-in account.
 * While auth is unresolved, this waits for the existing identity signal and
 * retries the browser session read within one bounded two-second window.
 * Once auth is usable, token lookup and the active fetch bind to that provider
 * identity revision. An explicit init signal overrides the Request signal,
 * matching the native fetch contract.
 * The returned native Response retains the signal through its body lifecycle.
 */
export async function authedActionFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  return (await activeAuthActionFetch(input, init)).response;
}

/**
 * Send an account action only when the resolved browser session is signed in.
 *
 * A signed-out caller gets null and spends no server request budget, which is
 * the whole point: the Plan claim and capability-recovery lanes ask on every
 * arrival, and a stranger's browser must not fire one write per page load to
 * learn what the session already knows. It waits on the SAME readiness gate
 * every other action here waits on, because "not asked yet" is not "signed
 * out", and answering null while the session is still resolving would drop a
 * claim the account is entitled to.
 */
export async function signedInActionFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response | null> {
  const deadline = Date.now() + AUTH_ACTION_TOKEN_TIMEOUT_MS;
  await waitForAuthActionReadiness(deadline, init.signal ?? undefined);
  if (authActionState.status !== "signed-in" || !authActionState.identityResolved) return null;
  return authedActionFetch(input, init);
}

export type AuthedActionJson<T> = Readonly<{
  response: Response;
  body: T;
}>;

/** Fetch and parse account-scoped JSON under one provider identity revision. */
export async function authedActionJson<T = unknown>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<AuthedActionJson<T>> {
  const { signal, accountRevision, response } = await activeAuthActionFetch(input, init);
  const body = (await response.json()) as T;
  if (signal.aborted) throw abortReason(signal);
  if (readProviderIdentityRevision() !== accountRevision) throw abortError();
  return { response, body };
}
