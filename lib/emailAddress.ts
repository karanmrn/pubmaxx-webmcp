// Email-address validation and normalisation. Browser-safe: no Supabase and no
// node-only imports, so a "use client" component can share the exact check a
// route enforces and never claim a success the server would refuse.
//
// This was `lib/emailSubscribers.ts`. The identity-nudge email capture, its
// store and its routes were removed once the weekly digest turned out never to
// have been built (see specs/honest-identity-nudge-email-action.md); the
// address helpers stayed because `lib/areaDemand.ts` still validates an address
// with them.

/** RFC-pragmatic max length; addresses longer than this are rejected outright. */
export const MAX_EMAIL_LENGTH = 254;

/**
 * Deliberately strict, single-line address sanity check. Requires exactly one
 * non-space run, an `@`, another non-space run, a dot, and a TLD-ish run. This
 * is defence-in-depth, not a deliverability guarantee. Only a later delivery
 * attempt can prove the destination accepts mail.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lower-case + trim; the single normalisation applied before validation and
 *  before any durable write, so `Foo@Bar.com ` and `foo@bar.com` are one row. */
export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** True when `value` is a plausibly-valid email once normalised. */
export function isValidEmail(value: unknown): boolean {
  const email = normalizeEmail(value);
  return email.length > 0 && email.length <= MAX_EMAIL_LENGTH && EMAIL_RE.test(email);
}

/**
 * Normalise + validate in one step. Returns the normalised address when valid,
 * or null — callers never re-normalise, so client and server hold the identical
 * canonical form.
 */
export function parseEmail(value: unknown): string | null {
  const email = normalizeEmail(value);
  return isValidEmail(email) ? email : null;
}
