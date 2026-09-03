// The accounts signed in ON THIS DEVICE, and nothing about which one is active.
//
// WHY THIS EXISTS: a drinker who runs two accounts had to sign out of one and
// wait for an email link to reach the other, every single time. The browser
// Supabase client holds exactly ONE session (`sb-<ref>-auth-token`), so a second
// sign-in overwrites the first and its refresh token is gone for good.
//
// THE SHAPE: this lane remembers the refresh token of every account that has
// signed in here, keyed by account id. Activating a row mints a fresh session
// from its refresh token and installs it through `supabase.auth.setSession`, so
// the ordinary auth event fires and `AuthProvider.updateSession` performs the
// one atomic device-identity swap it already performs on every sign-in. This
// module therefore changes WHICH session is active and never how identity binds.
//
// WHERE THE TOKENS LIVE: the same evictable `localStorage` the live session
// already lives in, holding the same one credential the durable HttpOnly resume
// cookie already mirrors for the active account (lib/authSessionResume.ts). No
// new storage class, and no access token is ever written here - an access token
// is minutes long and a refresh token is the only thing a switch needs.
//
// WHY THIS IS NOT IN `DEVICE_IDENTITY_LOCAL_KEYS`: that set is every artifact
// that claims to BE the signed-in account, and it is dropped whole the moment a
// different account owns the device. This lane claims nothing of the sort. Every
// row names its own account id, no row is ever read as "you", and a row is only
// ever activated by minting that row's own session. Adding it to that set would
// delete the other accounts on every switch, which is the feature.
//
// A ROW IS TRI-STATE, for the reason the resume cookie is: absent, holding a
// token, or holding no token but still naming the account. A refresh token that
// GoTrue refuses is deleted on the spot and the row stays, so the switcher can
// offer a sign-in rather than pretend an account was never here.

/** One key, one lane. Versioned so a shape change is a new lane, not a repair. */
export const DEVICE_ACCOUNT_SESSIONS_KEY = "pubmax_device_sessions_v1";

/** Same-tab notice that the remembered account list changed under a reader. */
export const DEVICE_ACCOUNT_SESSIONS_CHANGED_EVENT =
  "pubmax:device-account-sessions-changed";

/**
 * How many accounts one device remembers. A cap because every row is a
 * long-lived credential and a list nobody can read is not a switcher; the
 * least recently active row falls off, which signs that account out of this
 * device rather than leaving a token nothing can reach.
 */
export const MAX_DEVICE_ACCOUNTS = 5;

/** An account this device remembers. `refreshToken` null means it needs signing in. */
export type DeviceAccountRecord = {
  /** Supabase account id. The key, and the only thing a row is trusted for. */
  userId: string;
  /** The one stored credential, or null once GoTrue refused it. */
  refreshToken: string | null;
  /** Account email, for a row with no claimed handle yet. */
  email: string | null;
  /** Public handle, so a row reads as a person rather than an address. */
  handle: string | null;
  /** Last time this account owned the device. Newest first is the list order. */
  lastActiveAt: number;
};

export type DeviceAccountUpsert = {
  userId: string;
  refreshToken?: string | null;
  email?: string | null;
  handle?: string | null;
};

type WritableStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

const MAX_TOKEN_LENGTH = 2048;
const MAX_TEXT_LENGTH = 320;

/**
 * The same plausibility bar the resume cookie applies (`isPlausibleRefreshToken`
 * in lib/authSessionResume.ts). Restated rather than imported because that
 * module encodes its cookie with `Buffer`, which the browser bundle has no
 * business carrying; the rule is one line and both copies are pinned.
 */
function plausibleRefreshToken(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 8 &&
    value.length <= MAX_TOKEN_LENGTH &&
    /^[\x21-\x7e]+$/.test(value)
  );
}

function text(value: unknown): string | null {
  return typeof value === "string" && value && value.length <= MAX_TEXT_LENGTH
    ? value
    : null;
}

/** A stored row, or null. A half-parsed credential is not a credential. */
function parseRow(raw: unknown): DeviceAccountRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const userId = text(row.userId);
  if (!userId) return null;
  return {
    userId,
    refreshToken: plausibleRefreshToken(row.refreshToken) ? row.refreshToken : null,
    email: text(row.email),
    handle: text(row.handle),
    lastActiveAt:
      typeof row.lastActiveAt === "number" && Number.isFinite(row.lastActiveAt)
        ? row.lastActiveAt
        : 0,
  };
}

function byNewestFirst(
  left: DeviceAccountRecord,
  right: DeviceAccountRecord,
): number {
  return right.lastActiveAt - left.lastActiveAt;
}

/**
 * The stored lane exactly as it sits, for a reader that needs a value it can
 * compare. `useSyncExternalStore` demands a cached snapshot, and a fresh array
 * every call is not one, so the string is the snapshot and the parse is derived.
 */
export function deviceAccountsSnapshot(storage: WritableStorage | null): string {
  if (!storage) return "";
  try {
    return storage.getItem(DEVICE_ACCOUNT_SESSIONS_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Every account a stored lane names, most recently active first. A blocked or
 * malformed lane reads as no accounts, which costs a person one sign-in and
 * never names the wrong one.
 */
export function parseDeviceAccounts(raw: string | null): DeviceAccountRecord[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const rows = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown> | null)?.accounts)
      ? ((parsed as Record<string, unknown>).accounts as unknown[])
      : [];
  const seen = new Set<string>();
  const accounts: DeviceAccountRecord[] = [];
  for (const row of rows) {
    const account = parseRow(row);
    if (!account || seen.has(account.userId)) continue;
    seen.add(account.userId);
    accounts.push(account);
  }
  return accounts.sort(byNewestFirst).slice(0, MAX_DEVICE_ACCOUNTS);
}

/** Every account this device remembers, most recently active first. */
export function readDeviceAccounts(
  storage: WritableStorage | null,
): DeviceAccountRecord[] {
  return parseDeviceAccounts(deviceAccountsSnapshot(storage) || null);
}

function write(
  storage: WritableStorage | null,
  accounts: DeviceAccountRecord[],
): DeviceAccountRecord[] {
  const kept = accounts.sort(byNewestFirst).slice(0, MAX_DEVICE_ACCOUNTS);
  if (!storage) return kept;
  try {
    if (kept.length === 0) storage.removeItem(DEVICE_ACCOUNT_SESSIONS_KEY);
    else storage.setItem(DEVICE_ACCOUNT_SESSIONS_KEY, JSON.stringify(kept));
  } catch {
    // Blocked storage means one account per device, never a wrong one.
  }
  return kept;
}

/**
 * Record (or update) the account that owns the device right now. Called on every
 * auth event beside the durable resume cookie, so a background token rotation
 * keeps this lane's copy fresh: a spent refresh token is refused by GoTrue, and
 * a switcher offering one would be offering a dead door.
 *
 * A field left undefined is left alone. That is what lets the session write the
 * token and the canonical identity read fill the handle in afterwards, without
 * either erasing the other.
 */
export function rememberDeviceAccount(
  storage: WritableStorage | null,
  entry: DeviceAccountUpsert,
  now: number,
): DeviceAccountRecord[] {
  if (!entry.userId) return readDeviceAccounts(storage);
  const existing = readDeviceAccounts(storage);
  const previous = existing.find((row) => row.userId === entry.userId) ?? null;
  const next: DeviceAccountRecord = {
    userId: entry.userId,
    refreshToken:
      entry.refreshToken === undefined
        ? (previous?.refreshToken ?? null)
        : plausibleRefreshToken(entry.refreshToken)
          ? entry.refreshToken
          : null,
    email: entry.email === undefined ? (previous?.email ?? null) : text(entry.email),
    handle:
      entry.handle === undefined ? (previous?.handle ?? null) : text(entry.handle),
    lastActiveAt: now,
  };
  return write(
    storage,
    existing.filter((row) => row.userId !== entry.userId).concat(next),
  );
}

/**
 * GoTrue refused this row's refresh token. The token goes and the row stays:
 * "we cannot sign you in silently" is a different answer from "you were never
 * here", and only the second one may hide an account from its owner.
 */
export function markDeviceAccountNeedsSignIn(
  storage: WritableStorage | null,
  userId: string,
): DeviceAccountRecord[] {
  const existing = readDeviceAccounts(storage);
  if (!existing.some((row) => row.userId === userId)) return existing;
  return write(
    storage,
    existing.map((row) =>
      row.userId === userId ? { ...row, refreshToken: null } : row,
    ),
  );
}

/** One account leaves this device: its row and its token go together. */
export function forgetDeviceAccount(
  storage: WritableStorage | null,
  userId: string,
): DeviceAccountRecord[] {
  return write(
    storage,
    readDeviceAccounts(storage).filter((row) => row.userId !== userId),
  );
}

/** Sign out of every account on this device. */
export function forgetAllDeviceAccounts(storage: WritableStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(DEVICE_ACCOUNT_SESSIONS_KEY);
  } catch {
    // Nothing to keep.
  }
}

/**
 * The rows the switcher offers. Never the active account: its card is already at
 * the top of the menu, and tapping yourself is a swap to where you stand.
 */
export function deviceAccountSwitchTargets(
  accounts: readonly DeviceAccountRecord[],
  activeUserId: string | null,
): DeviceAccountRecord[] {
  return accounts.filter((row) => row.userId !== activeUserId);
}

/**
 * Who takes the device when the active account signs out of itself. The person
 * asked to leave ONE account on a device that still holds another signed-in
 * account, so the device is not empty and must not be left as though it were.
 */
export function nextSignedInDeviceAccount(
  accounts: readonly DeviceAccountRecord[],
  excludeUserId: string | null,
): DeviceAccountRecord | null {
  return (
    [...accounts]
      .sort(byNewestFirst)
      .find((row) => row.userId !== excludeUserId && row.refreshToken !== null) ??
    null
  );
}

/**
 * Whether the menu offers a SCOPE on the way out. One account on a device makes
 * "this account" and "all accounts" the same act, and printing both would be a
 * choice about nothing.
 */
export function deviceSignOutScopeOffered(
  accounts: readonly DeviceAccountRecord[],
  activeUserId: string | null,
): boolean {
  return deviceAccountSwitchTargets(accounts, activeUserId).length > 0;
}

/**
 * How a row is named before its public profile answers. A handle is what this
 * app calls a person, and the email is the last resort for an account that has
 * claimed nothing yet. No copy of a provider display name is stored: the
 * switcher reads the same public profile the account card reads, so a row is
 * named by the profile its owner authored rather than by a stale field.
 */
export function deviceAccountLabel(account: DeviceAccountRecord): string {
  return account.handle || account.email || "Your account";
}

/** Announce a lane change to same-tab readers, which `storage` never does. */
export function emitDeviceAccountSessionsChanged(): void {
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(DEVICE_ACCOUNT_SESSIONS_CHANGED_EVENT));
  } catch {
    // Older engines without an Event constructor still keep the storage write.
  }
}

/** Subscribe to same-tab writes plus the cross-tab `storage` event. */
export function subscribeDeviceAccountSessions(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = () => onChange();
  window.addEventListener(DEVICE_ACCOUNT_SESSIONS_CHANGED_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(DEVICE_ACCOUNT_SESSIONS_CHANGED_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
