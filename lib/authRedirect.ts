import { canonicalAuthStartUrl, siteOrigin } from "@/lib/siteUrl";
import { accountClaimReturnToFromUrl } from "@/lib/accountClaimReturnTo";

/**
 * Keep post-auth navigation on the app origin. This is shared by every auth
 * entry point so adding a new provider cannot accidentally add an open redirect.
 */
export function safeAuthNext(raw: string | null | undefined, origin: string): string {
  if (!raw) return "/";
  const trimmed = raw.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//") || trimmed.includes("\\")) {
    return "/";
  }

  try {
    const allowedOrigin = new URL(origin).origin;
    const destination = new URL(trimmed, allowedOrigin);
    if (destination.origin !== allowedOrigin) return "/";
    return `${destination.pathname}${destination.search}${destination.hash}` || "/";
  } catch {
    return "/";
  }
}

const AUTH_ACTIVE_ATTEMPT_KEY = "pubmax_auth_active_attempt";
const AUTH_TAB_ATTEMPT_KEY = "pubmax_auth_tab_attempt";
const AUTH_RETURN_FRAGMENT_PREFIX = "pubmax_auth_return_fragment:";
const AUTH_ATTEMPT_LOCK_NAME = "pubmax-auth-attempt";
const AUTH_ATTEMPT_TTL_MS = 60 * 60 * 1000;
const AUTH_ATTEMPT_ID_PATTERN = /^[0-9a-f]{32}$/;

export const AUTH_CALLBACK_MARKER = "_authCallback";
export const AUTH_ATTEMPT_PARAM = "_authAttempt";
export const REFERRAL_SIGNUP_PROOF_PARAM = "_referralSignupProof";
export const AUTH_ATTEMPT_IN_PROGRESS_MESSAGE =
  "A sign-in is already in progress in this browser. Finish that attempt before starting another.";
export const AUTH_STORAGE_UNAVAILABLE_MESSAGE =
  "Sign-in needs browser storage. Enable site storage, then try again.";
export const AUTH_COORDINATION_UNAVAILABLE_MESSAGE =
  "This browser cannot safely coordinate sign-in tabs. Close other PUBMAXX tabs, update your browser, and try again.";
export const AUTH_RETURN_FRAGMENT_RESTORED_EVENT =
  "pubmax-auth-return-fragment-restored";

export type AuthFragmentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredAttemptRef = {
  id: string;
  expiresAt: number;
};

type StoredActiveAttempt = StoredAttemptRef & {
  callbackClaimed: boolean;
};

type StoredTabAttempt = StoredAttemptRef;

type StoredAuthFragment = StoredAttemptRef & {
  origin: string;
  path: string;
  hash: string;
};

type AuthCrypto = Pick<Crypto, "getRandomValues">;
type AuthLockManager = Pick<LockManager, "request">;

export type AuthAttemptOptions = {
  /** Browser-wide attempt claim. This must be localStorage in production. */
  persistentStorage?: AuthFragmentStorage | null;
  /** Initiating-tab ownership marker. This must be sessionStorage. */
  tabStorage?: AuthFragmentStorage | null;
  cryptoProvider?: AuthCrypto | null;
  lockManager?: AuthLockManager | null;
  now?: number;
};

export type AuthCallbackCaptureOptions = Pick<
  AuthAttemptOptions,
  "persistentStorage" | "tabStorage" | "lockManager" | "now"
> & {
  onFragmentRestored?: (cleanUrl: string) => void;
};

export type AuthAttemptStart =
  | { ok: true; id: string; callbackUrl: string }
  | { ok: false; message: string };

export type CanonicalAuthAttemptStart =
  | AuthAttemptStart
  | { ok: false; navigationStarted: true };

export type AuthCallbackTokens = {
  accessToken: string;
  refreshToken: string;
};

export type AuthCallbackAttempt = {
  attemptId: string | null;
  tokens: AuthCallbackTokens | null;
  providerError: boolean;
  signupProof?: string;
};

type AuthResponseFragment =
  | { kind: "tokens"; tokens: AuthCallbackTokens }
  | { kind: "error" };

/**
 * Parse a Supabase implicit-flow response fragment. The fragment never reaches
 * the server; browsers carry it across the callback route's redirect. Returns
 * null when the hash is an ordinary app fragment (an invite, a venue anchor).
 */
function parseAuthResponseFragment(hash: string): AuthResponseFragment | null {
  if (!hash.startsWith("#")) return null;
  try {
    const params = new URLSearchParams(hash.slice(1));
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    const isAuthResponse =
      params.has("access_token") ||
      params.has("refresh_token") ||
      params.has("error") ||
      params.has("error_code");
    if (!isAuthResponse) return null;
    if (accessToken && refreshToken) {
      return { kind: "tokens", tokens: { accessToken, refreshToken } };
    }
    return { kind: "error" };
  } catch {
    return null;
  }
}

export type CapturedAuthCallback = {
  attempt: AuthCallbackAttempt;
  cleanUrl: string;
  /**
   * True only when this browser owned and claimed the local attempt record.
   * False for attempt-less / cross-browser token landings (login-CSRF surface):
   * the UI then shows a visible "Signed in as …" confirmation.
   */
  localAttemptOwned: boolean;
  /** Release only after exchange and matching persistent cleanup complete. */
  releaseCoordination: () => void;
};

type AuthFragmentEventTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export function subscribeToAuthFragmentRestored(
  listener: EventListener,
  target?: AuthFragmentEventTarget,
): () => void {
  const eventTarget = target ?? window;
  eventTarget.addEventListener(AUTH_RETURN_FRAGMENT_RESTORED_EVENT, listener);
  return () => eventTarget.removeEventListener(AUTH_RETURN_FRAGMENT_RESTORED_EVENT, listener);
}

function authFragmentKey(attemptId: string): string {
  return `${AUTH_RETURN_FRAGMENT_PREFIX}${attemptId}`;
}

export function isAuthAttemptId(raw: unknown): raw is string {
  return typeof raw === "string" && AUTH_ATTEMPT_ID_PATTERN.test(raw);
}

function authDestination(currentUrl: string, requestedNext?: string): URL | null {
  try {
    const current = new URL(currentUrl);
    if (current.protocol !== "https:" && current.protocol !== "http:") return null;
    if (
      current.searchParams.get(AUTH_CALLBACK_MARKER) === "1" ||
      current.searchParams.get("authError") === "1"
    ) {
      current.searchParams.delete("code");
      current.searchParams.delete(AUTH_CALLBACK_MARKER);
      current.searchParams.delete(AUTH_ATTEMPT_PARAM);
      current.searchParams.delete(REFERRAL_SIGNUP_PROOF_PARAM);
      current.searchParams.delete("authError");
    }
    // A leftover token/error fragment is a one-time credential, never a
    // destination. Stripping it here keeps it out of the stored return
    // fragment and out of canonical-navigation URLs.
    if (parseAuthResponseFragment(current.hash)) current.hash = "";
    const currentPath = `${current.pathname}${current.search}${current.hash}`;
    return new URL(
      safeAuthNext(
        requestedNext ?? (current.pathname === "/auth/callback" ? "/" : currentPath),
        current.origin,
      ),
      current.origin,
    );
  } catch {
    return null;
  }
}

function randomAuthAttemptId(cryptoProvider?: AuthCrypto | null): string | null {
  if (!cryptoProvider) return null;
  try {
    const bytes = new Uint8Array(16);
    cryptoProvider.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

function readActiveAttempt(storage: AuthFragmentStorage): StoredActiveAttempt | null {
  const raw = storage.getItem(AUTH_ACTIVE_ATTEMPT_KEY);
  const attempt = parseStoredAttempt(raw);
  if (!attempt) return null;
  try {
    const record = JSON.parse(raw ?? "null") as Partial<StoredActiveAttempt> | null;
    return { ...attempt, callbackClaimed: record?.callbackClaimed === true };
  } catch {
    return null;
  }
}

function readTabAttempt(storage: AuthFragmentStorage): StoredTabAttempt | null {
  return parseStoredAttempt(storage.getItem(AUTH_TAB_ATTEMPT_KEY));
}

function parseStoredAttempt(raw: string | null): StoredAttemptRef | null {
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as Partial<StoredAttemptRef>;
    if (!isAuthAttemptId(record.id) || typeof record.expiresAt !== "number") return null;
    return { id: record.id, expiresAt: record.expiresAt };
  } catch {
    return null;
  }
}

type StorageMutation = {
  storage: AuthFragmentStorage;
  key: string;
  value: string | null;
};

/** Best-effort transaction across the two browser stores while the Web Lock is held. */
function applyStorageMutations(mutations: StorageMutation[]): boolean {
  const snapshots: Array<StorageMutation> = [];
  try {
    for (const mutation of mutations) {
      snapshots.push({
        storage: mutation.storage,
        key: mutation.key,
        value: mutation.storage.getItem(mutation.key),
      });
    }
    for (const mutation of mutations) {
      if (mutation.value === null) mutation.storage.removeItem(mutation.key);
      else mutation.storage.setItem(mutation.key, mutation.value);
    }
    return true;
  } catch {
    for (const snapshot of snapshots.reverse()) {
      try {
        if (snapshot.value === null) snapshot.storage.removeItem(snapshot.key);
        else snapshot.storage.setItem(snapshot.key, snapshot.value);
      } catch {
        // A blocked store may also reject rollback. Never proceed to the provider.
      }
    }
    return false;
  }
}

/** The only surface carrying the handle claim form (the /u/you sentinel). */
export const HANDLE_CLAIM_NEXT = "/u/you";

/**
 * Default destination for a signed-out email sign-in with no explicit next.
 * Email sign-in creates the account, and choosing a handle is the step after,
 * so the callback lands on the claim surface. A return target already on that
 * surface (an add link or Plan) outranks that default, so account setup can
 * return the user to the action that started it.
 */
export function defaultEmailAuthNext(currentUrl: string): string | undefined {
  try {
    const current = new URL(currentUrl);
    if (current.hash && !parseAuthResponseFragment(current.hash)) return undefined;
    const claimReturnTo = accountClaimReturnToFromUrl(currentUrl);
    if (current.pathname === HANDLE_CLAIM_NEXT && claimReturnTo) {
      return `${HANDLE_CLAIM_NEXT}?returnTo=${encodeURIComponent(claimReturnTo)}`;
    }
    return HANDLE_CLAIM_NEXT;
  } catch {
    return undefined;
  }
}

/** Build an allowlisted callback. The attempt id is generated by beginAuthAttempt. */
export function buildAuthCallbackUrl(
  currentUrl: string,
  requestedNext?: string,
  attemptId?: string,
): string | null {
  try {
    const current = new URL(currentUrl);
    if (current.protocol !== "https:" && current.protocol !== "http:") return null;
    const destination = authDestination(currentUrl, requestedNext);
    if (!destination) return null;
    // Never place a fragment in redirectTo. Fragments can contain one-use
    // capabilities and become server-visible when nested inside this query.
    const next = `${destination.pathname}${destination.search}` || "/";
    const callbackOrigin = siteOrigin(currentUrl);
    if (!callbackOrigin) return null;
    const callback = new URL("/auth/callback", callbackOrigin);
    if (next !== "/") callback.searchParams.set("next", next);
    if (attemptId) {
      if (!isAuthAttemptId(attemptId)) return null;
      callback.searchParams.set(AUTH_ATTEMPT_PARAM, attemptId);
    }
    return callback.toString();
  } catch {
    return null;
  }
}

/**
 * Start one browser-wide auth attempt. The attempt record owns the stored
 * return fragment (an invite must come back to the tab that held it) and keeps
 * two tabs from racing each other's sign-in state, so a second tab must not
 * overwrite it while the first link is live.
 */
export function beginAuthAttempt(
  currentUrl: string,
  requestedNext: string | undefined,
  options: Omit<AuthAttemptOptions, "lockManager">,
): AuthAttemptStart {
  const {
    persistentStorage,
    tabStorage,
    cryptoProvider,
    now = Date.now(),
  } = options;
  if (!persistentStorage || !tabStorage || persistentStorage === tabStorage) {
    return { ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE };
  }

  try {
    const active = readActiveAttempt(persistentStorage);
    const tabAttempt = readTabAttempt(tabStorage);
    if (active && active.expiresAt > now) {
      const sameInitiatingTab = Boolean(
        tabAttempt &&
          tabAttempt.id === active.id &&
          tabAttempt.expiresAt === active.expiresAt &&
          tabAttempt.expiresAt > now &&
          !active.callbackClaimed,
      );
      if (!sameInitiatingTab) {
        return { ok: false, message: AUTH_ATTEMPT_IN_PROGRESS_MESSAGE };
      }
    }

    const id = randomAuthAttemptId(cryptoProvider);
    const destination = authDestination(currentUrl, requestedNext);
    const callbackUrl = id
      ? buildAuthCallbackUrl(currentUrl, requestedNext, id)
      : null;
    if (!id || !destination || !callbackUrl) {
      return { ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE };
    }

    const expiresAt = now + AUTH_ATTEMPT_TTL_MS;
    const storedAttempt = JSON.stringify({
      id,
      expiresAt,
      callbackClaimed: false,
    } satisfies StoredActiveAttempt);
    const storedTabAttempt = JSON.stringify({ id, expiresAt } satisfies StoredTabAttempt);
    const mutations: StorageMutation[] = [
      {
        storage: persistentStorage,
        key: AUTH_ACTIVE_ATTEMPT_KEY,
        value: storedAttempt,
      },
      {
        storage: tabStorage,
        key: AUTH_TAB_ATTEMPT_KEY,
        value: storedTabAttempt,
      },
    ];
    if (destination.hash) {
      const fragment: StoredAuthFragment = {
        id,
        origin: destination.origin,
        path: `${destination.pathname}${destination.search}`,
        hash: destination.hash,
        expiresAt,
      };
      mutations.push({
        storage: persistentStorage,
        key: authFragmentKey(id),
        value: JSON.stringify(fragment),
      });
    }
    const staleAttemptIds = new Set(
      [active?.id, tabAttempt?.id].filter(
        (attemptId): attemptId is string => Boolean(attemptId && attemptId !== id),
      ),
    );
    for (const staleAttemptId of staleAttemptIds) {
      mutations.push({
        storage: persistentStorage,
        key: authFragmentKey(staleAttemptId),
        value: null,
      });
    }
    if (!applyStorageMutations(mutations)) {
      return { ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE };
    }
    return { ok: true, id, callbackUrl };
  } catch {
    return { ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE };
  }
}

/** Atomically claim the browser-wide attempt across tabs via the Web Locks API. */
export async function beginCoordinatedAuthAttempt(
  currentUrl: string,
  requestedNext: string | undefined,
  options: AuthAttemptOptions,
): Promise<AuthAttemptStart> {
  const { persistentStorage, tabStorage, lockManager } = options;
  if (!persistentStorage || !tabStorage || persistentStorage === tabStorage) {
    return { ok: false, message: AUTH_STORAGE_UNAVAILABLE_MESSAGE };
  }
  if (!lockManager) {
    return { ok: false, message: AUTH_COORDINATION_UNAVAILABLE_MESSAGE };
  }
  try {
    return await lockManager.request(AUTH_ATTEMPT_LOCK_NAME, async () =>
      beginAuthAttempt(currentUrl, requestedNext, options),
    );
  } catch {
    return { ok: false, message: AUTH_COORDINATION_UNAVAILABLE_MESSAGE };
  }
}

export async function beginCanonicalAuthAttempt(
  currentUrl: string,
  requestedNext: string | undefined,
  options: AuthAttemptOptions,
  navigate: (url: string) => void,
): Promise<CanonicalAuthAttemptStart> {
  const destination = authDestination(currentUrl, requestedNext);
  const canonicalStartUrl = destination
    ? canonicalAuthStartUrl(destination.toString())
    : null;
  if (canonicalStartUrl) {
    try {
      navigate(canonicalStartUrl);
      return { ok: false, navigationStarted: true };
    } catch {
      return {
        ok: false,
        message: "Sign-in must start on pubmaxxing.com. Open the site there, then try again.",
      };
    }
  }
  return beginCoordinatedAuthAttempt(currentUrl, requestedNext, options);
}

/** Release only the matching lock; another tab's attempt is never disturbed. */
export function releaseAuthAttempt(
  attemptId: string,
  persistentStorage?: AuthFragmentStorage | null,
  tabStorage?: AuthFragmentStorage | null,
): void {
  if (!isAuthAttemptId(attemptId)) return;
  try {
    if (persistentStorage) {
      const active = readActiveAttempt(persistentStorage);
      if (active?.id === attemptId) persistentStorage.removeItem(AUTH_ACTIVE_ATTEMPT_KEY);
      persistentStorage.removeItem(authFragmentKey(attemptId));
    }
  } catch {
    // Best-effort cleanup; TTL keeps an abandoned lock bounded.
  }
  try {
    if (tabStorage) {
      const tabAttempt = readTabAttempt(tabStorage);
      if (tabAttempt?.id === attemptId) tabStorage.removeItem(AUTH_TAB_ATTEMPT_KEY);
      // Clean up fragments from the short-lived sessionStorage implementation.
      tabStorage.removeItem(authFragmentKey(attemptId));
    }
  } catch {
    // Best-effort cleanup; a later same-tab restart or the TTL can recover.
  }
}

/** User-initiated cancel: clear the active browser claim so sign-in can restart before the TTL. */
export function cancelAuthAttempt(
  persistentStorage?: AuthFragmentStorage | null,
  tabStorage?: AuthFragmentStorage | null,
): boolean {
  let attemptId: string | null = null;
  try {
    attemptId = persistentStorage ? readActiveAttempt(persistentStorage)?.id ?? null : null;
  } catch {
    attemptId = null;
  }
  try {
    attemptId ??= tabStorage ? readTabAttempt(tabStorage)?.id ?? null : null;
  } catch {
    // No tab marker means there may still be a browser-wide active claim.
  }
  if (!attemptId) return false;
  releaseAuthAttempt(attemptId, persistentStorage, tabStorage);
  return true;
}

function cleanAuthCallbackUrl(currentUrl: string): string | null {
  try {
    const current = new URL(currentUrl);
    current.searchParams.delete("code");
    current.searchParams.delete(AUTH_CALLBACK_MARKER);
    current.searchParams.delete(AUTH_ATTEMPT_PARAM);
    current.searchParams.delete(REFERRAL_SIGNUP_PROOF_PARAM);
    current.searchParams.delete("authError");
    // The implicit-flow response fragment carries the session tokens (or an
    // error). It must leave the address bar with the marker parameters.
    if (parseAuthResponseFragment(current.hash)) current.hash = "";
    return `${current.pathname}${current.search}${current.hash}` || "/";
  } catch {
    return null;
  }
}

function rejectedAuthCallback(cleanUrl: string): CapturedAuthCallback {
  return {
    attempt: { attemptId: null, tokens: null, providerError: true },
    cleanUrl,
    localAttemptOwned: false,
    releaseCoordination: () => {},
  };
}

/**
 * Callback tokens are self-authenticating: Supabase already verified the email
 * link or provider redirect that minted them, and an emailed link legitimately
 * opens in a browser that never started the attempt (Gmail app opening Safari),
 * where no local attempt record exists. So a token-bearing callback survives a
 * missing, expired, or already-claimed local attempt — it only loses the stored
 * return-fragment restore. A token-less callback still fails closed; it exists
 * only to surface a failure banner.
 */
function fallbackAuthCallback(
  parsedAttempt: AuthCallbackAttempt,
  cleanUrl: string,
): CapturedAuthCallback {
  if (!parsedAttempt.tokens) return rejectedAuthCallback(cleanUrl);
  return {
    attempt: parsedAttempt,
    cleanUrl,
    // Tokens completed without a matching local claim (cross-browser link,
    // expired attempt, or clamped landing). Not this browser's started attempt.
    localAttemptOwned: false,
    releaseCoordination: () => {},
  };
}

function restoreAuthFragment(cleanUrl: string, fragment: string): string {
  // Return fragments are app state. Never restore a one-time auth response
  // after the callback URL has scrubbed it from browser history.
  if (!fragment.startsWith("#") || parseAuthResponseFragment(fragment)) return cleanUrl;
  try {
    const restored = new URL(cleanUrl, "https://pubmax.invalid");
    restored.hash = fragment;
    return `${restored.pathname}${restored.search}${restored.hash}` || "/";
  } catch {
    return cleanUrl;
  }
}

/** Validate and claim while the caller holds AUTH_ATTEMPT_LOCK_NAME. */
function claimAuthCallback(
  currentUrl: string,
  parsedAttempt: AuthCallbackAttempt,
  cleanUrl: string,
  persistentStorage: AuthFragmentStorage,
  now: number,
): CapturedAuthCallback {
  const attemptId = parsedAttempt.attemptId;
  // No attempt id at all: a clamped link delivered tokens to the landing page,
  // or a crafted URL delivered nothing. fallbackAuthCallback splits the two.
  if (!attemptId) return fallbackAuthCallback(parsedAttempt, cleanUrl);
  try {
    const active = readActiveAttempt(persistentStorage);
    if (active?.id !== attemptId) {
      // No matching local record: this browser did not start the attempt
      // (cross-browser email link) or the attempt was replaced. Tokens still
      // complete sign-in; see fallbackAuthCallback.
      return fallbackAuthCallback(parsedAttempt, cleanUrl);
    }
    const key = authFragmentKey(attemptId);
    if (active.expiresAt <= now) {
      applyStorageMutations([
        { storage: persistentStorage, key: AUTH_ACTIVE_ATTEMPT_KEY, value: null },
        { storage: persistentStorage, key, value: null },
      ]);
      return fallbackAuthCallback(parsedAttempt, cleanUrl);
    }
    if (active.callbackClaimed) return fallbackAuthCallback(parsedAttempt, cleanUrl);
    const raw = persistentStorage.getItem(key);
    let fragment = "";
    if (raw) {
      const record = JSON.parse(raw) as Partial<StoredAuthFragment>;
      const current = new URL(currentUrl);
      current.searchParams.delete("code");
      current.searchParams.delete(AUTH_CALLBACK_MARKER);
      current.searchParams.delete(AUTH_ATTEMPT_PARAM);
      current.searchParams.delete(REFERRAL_SIGNUP_PROOF_PARAM);
      current.searchParams.delete("authError");
      const path = `${current.pathname}${current.search}`;
      if (
        record.id === attemptId &&
        record.origin === current.origin &&
        record.path === path &&
        typeof record.hash === "string" &&
        record.hash.startsWith("#") &&
        typeof record.expiresAt === "number" &&
        record.expiresAt >= now
      ) {
        fragment = record.hash;
      }
    }
    const claimedAttempt = JSON.stringify({
      id: active.id,
      expiresAt: active.expiresAt,
      callbackClaimed: true,
    } satisfies StoredActiveAttempt);
    const ok = applyStorageMutations([
      { storage: persistentStorage, key: AUTH_ACTIVE_ATTEMPT_KEY, value: claimedAttempt },
      { storage: persistentStorage, key, value: null },
    ]);
    if (!ok) return fallbackAuthCallback(parsedAttempt, cleanUrl);
    return {
      attempt: parsedAttempt,
      cleanUrl: fragment ? restoreAuthFragment(cleanUrl, fragment) : cleanUrl,
      localAttemptOwned: true,
      releaseCoordination: () => {},
    };
  } catch {
    return fallbackAuthCallback(parsedAttempt, cleanUrl);
  }
}

export function isAuthPage(pathname: string): boolean {
  return pathname === "/login" || pathname === "/signin" || pathname === "/auth/callback";
}

/**
 * Read callback parameters minted by our server callback route, or a token
 * fragment delivered straight to any page. Supabase's redirect allowlist clamps
 * an unlisted redirect_to to the bare site URL, and a clamped link lands the
 * implicit-flow fragment on the landing page with no callback marker. Those
 * tokens must still complete sign-in; leaving them dangling in the URL signs
 * nobody in and shows no error.
 */
export function readAuthCallbackAttempt(currentUrl: string): AuthCallbackAttempt | null {
  try {
    const current = new URL(currentUrl);
    const fragment = parseAuthResponseFragment(current.hash);
    const authPage = isAuthPage(current.pathname);
    const marked = current.searchParams.get(AUTH_CALLBACK_MARKER) === "1";
    // A marked callback is tied to a live local attempt, not a crafted
    // fragment, so it keeps reporting a provider error on any page. An
    // unmarked bare signal only counts on an auth page (anti-spoof scoping).
    const providerError =
      (marked || authPage) &&
      (current.searchParams.get("authError") === "1" || fragment?.kind === "error");
    if (!marked && !providerError && fragment?.kind !== "tokens") return null;
    const rawAttemptId = current.searchParams.get(AUTH_ATTEMPT_PARAM);
    const attemptId = isAuthAttemptId(rawAttemptId) ? rawAttemptId : null;
    const tokens =
      !providerError && fragment?.kind === "tokens" ? fragment.tokens : null;
    const signupProof =
      attemptId && !providerError
        ? current.searchParams.get(REFERRAL_SIGNUP_PROOF_PARAM)
        : null;
    return {
      attemptId,
      tokens,
      // With neither a valid attempt id nor tokens there is nothing to
      // establish, so the callback reads as a failure and the banner shows.
      providerError: providerError || (!attemptId && !tokens),
      ...(signupProof ? { signupProof } : {}),
    };
  } catch {
    return null;
  }
}

async function capturePreparedAuthCallback(
  currentUrl: string,
  parsedAttempt: AuthCallbackAttempt,
  cleanUrl: string,
  options: AuthCallbackCaptureOptions,
): Promise<CapturedAuthCallback> {
  const { persistentStorage, lockManager } = options;
  if (!persistentStorage || !lockManager) {
    return fallbackAuthCallback(parsedAttempt, cleanUrl);
  }
  return new Promise<CapturedAuthCallback>((resolve) => {
    let resolved = false;
    const resolveOnce = (captured: CapturedAuthCallback) => {
      if (resolved) return;
      resolved = true;
      resolve(captured);
    };
    try {
      void Promise.resolve(
        lockManager.request(AUTH_ATTEMPT_LOCK_NAME, async () => {
          const captured = claimAuthCallback(
            currentUrl,
            parsedAttempt,
            cleanUrl,
            persistentStorage,
            options.now ?? Date.now(),
          );
          if (!captured.attempt.attemptId) {
            resolveOnce(captured);
            return;
          }

          let releaseLease = () => {};
          let released = false;
          const lease = new Promise<void>((release) => {
            releaseLease = () => {
              if (released) return;
              released = true;
              release();
            };
          });
          resolveOnce({ ...captured, releaseCoordination: releaseLease });
          // Fail closed while exchange is live. Navigation/crash releases Web
          // Locks with the document; a live caller releases explicitly in finally.
          await lease;
        }),
      ).catch(() => resolveOnce(fallbackAuthCallback(parsedAttempt, cleanUrl)));
    } catch {
      resolveOnce(fallbackAuthCallback(parsedAttempt, cleanUrl));
    }
  });
}

/** Claim callback state under the same cross-tab lock used to start attempts. */
export function captureAuthCallback(
  currentUrl: string,
  options: AuthCallbackCaptureOptions,
): Promise<CapturedAuthCallback | null> {
  const parsedAttempt = readAuthCallbackAttempt(currentUrl);
  const cleanUrl = cleanAuthCallbackUrl(currentUrl);
  if (!parsedAttempt || !cleanUrl) return Promise.resolve(null);
  return capturePreparedAuthCallback(currentUrl, parsedAttempt, cleanUrl, options);
}

/** Scrub credentials synchronously, then expose tokens only after the locked claim. */
export function scrubAuthCallback(
  currentUrl: string,
  replaceUrl: (cleanUrl: string) => void,
  options: AuthCallbackCaptureOptions,
): Promise<CapturedAuthCallback | null> {
  const parsedAttempt = readAuthCallbackAttempt(currentUrl);
  const cleanUrl = cleanAuthCallbackUrl(currentUrl);
  if (!parsedAttempt || !cleanUrl) return Promise.resolve(null);
  // This happens before Web Locks can queue or any promise is awaited. A
  // replaceState that THROWS (Safari rate-limits history calls while a page
  // loads) must not fail the sign-in closed: dropping the tokens would leave
  // the credentials in the address bar AND sign nobody in. The claim proceeds
  // and the scrub is retried once the claim settles.
  let scrubbed = false;
  try {
    replaceUrl(cleanUrl);
    scrubbed = true;
  } catch {
    // Retried below, then again by the caller's post-exchange sweep.
  }
  return capturePreparedAuthCallback(currentUrl, parsedAttempt, cleanUrl, options).then(
    (captured) => {
      if (!scrubbed || captured.cleanUrl !== cleanUrl) {
        try {
          replaceUrl(captured.cleanUrl);
          if (captured.cleanUrl !== cleanUrl) {
            options.onFragmentRestored?.(captured.cleanUrl);
          }
        } catch {
          // Continue so the caller releases the claimed attempt after
          // exchange; scrubLingeringAuthCallback gets one more attempt.
        }
      }
      return captured;
    },
  );
}

/**
 * Post-exchange sweep: remove callback credentials still in the address bar.
 * The synchronous scrub can be refused (Safari rate-limits history calls
 * during load) or reverted by a later router URL write, so the callback owner
 * runs this again after the exchange settles - on success AND on failure. A
 * clean URL, or one holding an ordinary app fragment (an invite), is left
 * alone. Returns true when a lingering callback had to be scrubbed.
 */
export function scrubLingeringAuthCallback(
  currentUrl: string,
  replaceUrl: (cleanUrl: string) => void,
): boolean {
  const parsedAttempt = readAuthCallbackAttempt(currentUrl);
  const cleanUrl = cleanAuthCallbackUrl(currentUrl);
  if (!parsedAttempt || !cleanUrl) return false;
  try {
    replaceUrl(cleanUrl);
    return true;
  } catch {
    return false;
  }
}
