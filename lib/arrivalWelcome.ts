// Arrival policy. What a person meets in the first second after a sign-in
// completes, and nothing else. Presentation-free so the copy, the timing and
// the one-shot marker are all testable without a browser.
//
// The law this file exists to keep: arrival is the moment of togetherness,
// never an admin form. A returning account that already owns a handle is owed
// one warm line and their destination. It is owed no dialog, no rename field
// and no second claim. The blocking "You are @handle / Rename handle" sheet
// that used to meet every handled account on every tab is gone; renaming lives
// in profile editing alone (components/profile/PubmaxxAccountHub.tsx).
//
// WHY A STORAGE MARKER RATHER THAN REACT STATE: a completed sign-in can end in
// a full navigation (AuthProvider assigns the claim destination after the token
// exchange), which discards any in-memory flag. sessionStorage survives that
// hop and dies with the tab, so the greeting lands exactly once on the page the
// person actually arrives at.

/** Which door the person came through. The two differ in copy and in landing. */
export type ArrivalIntent = "signin" | "signup";

export const ARRIVAL_INTENT_PARAM = "mode";
export const ARRIVAL_FROM_PARAM = "from";
/**
 * The third login-page parameter, beside the door and the page to return to. It
 * says the arriving person already has a session and wants a SECOND account on
 * this device, so /login must offer its form rather than the "you are signed in"
 * card. Without it, the switcher's Add account would land on a page that only
 * tells the reader they are already in.
 */
export const LOGIN_ADD_ACCOUNT_PARAM = "add";
const MARKER_KEY = "pubmax:arrival-welcome:v1";
const CHOSEN_INTENT_KEY = "pubmax:arrival-intent:v1";

/**
 * How long the door a person chose is remembered while they go to their inbox.
 * A magic link is usually opened on the same device, so the choice survives the
 * hop; a link opened in another browser simply falls back to the returning
 * greeting, which is never the wrong thing to say to someone signing in.
 */
export const ARRIVAL_INTENT_TTL_MS = 30 * 60_000;

/**
 * A marker older than this is not an arrival. Without the bound, a sign-in
 * abandoned mid-hop would greet the person on some unrelated page later in the
 * same tab, which reads as a glitch rather than a welcome.
 */
export const ARRIVAL_WELCOME_TTL_MS = 90_000;

/** How long the line stays before it retires itself. Long enough to read once. */
export const ARRIVAL_WELCOME_VISIBLE_MS = 4_200;

/**
 * How long the greeting waits for the handle lookup before giving up. A
 * returning account's handle resolves from the server, so the line cannot be
 * written until it lands. Silence beats greeting nobody.
 */
export const ARRIVAL_WELCOME_HANDLE_WAIT_MS = 6_000;

export type ArrivalStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type ArrivalMarker = { intent: ArrivalIntent; at: number };

function isIntent(raw: unknown): raw is ArrivalIntent {
  return raw === "signin" || raw === "signup";
}

/** Read `?mode=` into an intent. Anything else is an ordinary sign-in. */
export function parseArrivalIntent(raw: string | null | undefined): ArrivalIntent {
  return isIntent(raw) ? raw : "signin";
}

/** Read `?add=` as the add-an-account request. Only an explicit "1" counts. */
export function parseAddAccount(raw: string | null | undefined): boolean {
  return raw === "1";
}

/**
 * Record that a sign-in just completed. Called from the auth transition, never
 * from a render, so an ordinary page load with an existing session is silent.
 */
export function markArrival(
  storage: ArrivalStorage | null,
  intent: ArrivalIntent,
  now: number,
): void {
  if (!storage) return;
  try {
    storage.setItem(MARKER_KEY, JSON.stringify({ intent, at: now } satisfies ArrivalMarker));
  } catch {
    // Storage blocked: the greeting is a courtesy, never a step in the flow.
  }
}

/**
 * Peek at a live marker without consuming it. The greeting can only be written
 * once the handle resolves, so the caller clears it when it shows (or when the
 * wait runs out) rather than at read time.
 */
export function peekArrival(
  storage: ArrivalStorage | null,
  now: number,
): ArrivalIntent | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(MARKER_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let marker: unknown;
  try {
    marker = JSON.parse(raw);
  } catch {
    clearArrival(storage);
    return null;
  }
  const parsed = marker as Partial<ArrivalMarker> | null;
  const intent = parsed?.intent;
  const at = typeof parsed?.at === "number" ? parsed.at : null;
  if (!isIntent(intent) || at === null || now - at >= ARRIVAL_WELCOME_TTL_MS) {
    clearArrival(storage);
    return null;
  }
  return intent;
}

export function clearArrival(storage: ArrivalStorage | null): void {
  if (!storage) return;
  try {
    storage.removeItem(MARKER_KEY);
  } catch {
    // Nothing to undo; the TTL bounds an unreadable marker anyway.
  }
}

/**
 * Remember which door was chosen while the person goes to read their email.
 * Persistent storage rather than the tab's, because the link is opened from an
 * inbox, which is usually a different tab.
 */
export function rememberChosenIntent(
  storage: ArrivalStorage | null,
  intent: ArrivalIntent,
  now: number,
): void {
  if (!storage) return;
  try {
    storage.setItem(CHOSEN_INTENT_KEY, JSON.stringify({ intent, at: now }));
  } catch {
    // The fallback below is a correct greeting on its own.
  }
}

/** Consume the remembered door. A missing or stale one is an ordinary sign-in. */
export function takeChosenIntent(
  storage: ArrivalStorage | null,
  now: number,
): ArrivalIntent {
  if (!storage) return "signin";
  let raw: string | null;
  try {
    raw = storage.getItem(CHOSEN_INTENT_KEY);
    storage.removeItem(CHOSEN_INTENT_KEY);
  } catch {
    return "signin";
  }
  if (!raw) return "signin";
  try {
    const parsed = JSON.parse(raw) as Partial<ArrivalMarker> | null;
    const at = typeof parsed?.at === "number" ? parsed.at : null;
    if (!isIntent(parsed?.intent) || at === null || now - at >= ARRIVAL_INTENT_TTL_MS) {
      return "signin";
    }
    return parsed.intent;
  } catch {
    return "signin";
  }
}

/**
 * The one line. It names the person and gets out of the way. A returning
 * account is greeted by its handle because that is who the account IS here;
 * a brand-new one is greeted by the place it just joined.
 */
export function arrivalWelcomeLine(
  intent: ArrivalIntent,
  handle: string,
): string {
  const named = handle.replace(/^@/, "");
  if (!named) return "";
  return intent === "signup"
    ? `You are in, @${named}.`
    : `Welcome back, @${named}.`;
}

/**
 * Where a completed sign-in lands. A returning drinker goes back to what they
 * were doing; only a person with nowhere to return to is sent to their own
 * page. Sending everyone to the account surface was half of why signing in
 * felt like paperwork.
 */
export function arrivalDestination(
  intent: ArrivalIntent,
  from: string | null,
  accountPath: string,
): string {
  if (intent === "signup") return accountPath;
  const candidate = (from ?? "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return accountPath;
  }
  // A sign-in page is never a destination: landing back on it is the dead end
  // this whole change exists to remove.
  if (/^\/(login|signin)(\/|\?|$)/.test(candidate)) return accountPath;
  return candidate;
}
