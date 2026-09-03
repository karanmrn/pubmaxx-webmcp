// Clerk sign-in and sign-up, added BESIDE Supabase auth (never replacing it).
//
// WHAT A CLERK ACCOUNT IS NOT (yet):
// a Clerk account is not a PUBMAXX User ID and it carries no PUBMAXX Handle.
// Ownership, moderation, authorship and consent still attach to the Supabase
// account (CONTEXT.md, "PUBMAXX User ID"). Nine Supabase migrations key their
// row-level-security policies on `auth.uid()`, so a Clerk account cannot claim
// a contribution until that policy question is decided and migrated. Copy on
// any Clerk surface must therefore never promise a handle, a contribution, or
// carried-over history. See components/auth/ClerkAccountControls.tsx.
//
// WHY THE ORIGINS ARE DERIVED, NOT HARDCODED:
// a Clerk publishable key is `pk_<test|live>_<base64>` whose payload decodes to
// the instance Frontend API host followed by a `$` terminator. The browser
// loads clerk-js FROM that host and calls it for every session request, so the
// host is exactly what proxy.ts must admit in `script-src` and `connect-src`.
// Deriving it from the key means a development instance, a production instance
// and a future key rotation each get their own single exact origin, and no
// directive ever has to widen to a wildcard host.

/**
 * Cloudflare Turnstile, which Clerk uses for bot protection on sign-up.
 * Needed by `script-src` (the challenge widget) and `frame-src` (its iframe).
 */
export const CLERK_BOT_PROTECTION_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Clerk's abuse and fraud protection hosts. This is the ONE Clerk entry with a
 * wildcard, and the wildcard is a subdomain wildcard inside a Clerk-owned
 * registrable domain (never a wildcard directive, never a bare scheme): Clerk
 * shards these per deployment, so the exact subdomain is not knowable here.
 */
export const CLERK_ABUSE_PROTECTION_ORIGIN = "https://*.protect.clerk.com";

/** Clerk's own image CDN, which serves account avatars in <UserButton>. */
export const CLERK_IMAGE_ORIGIN = "https://img.clerk.com";

/**
 * Read the publishable key. Written as a literal `process.env.<NAME>` member
 * expression on purpose — that is the form Next.js statically replaces at build
 * time, so a computed lookup would silently read `undefined` in the browser.
 */
export function readClerkPublishableKey(): string | undefined {
  const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return key && key.trim() ? key.trim() : undefined;
}

/** True when the publishable key is a Clerk development instance (`pk_test_*`). */
export function isClerkDevelopmentPublishableKey(
  publishableKey: string | undefined = readClerkPublishableKey(),
): boolean {
  const key = publishableKey?.trim();
  return Boolean(key?.startsWith("pk_test_"));
}

/**
 * Production deploys must not load Clerk with a development publishable key.
 * Preview and local dev keep the current behaviour so Social beta can still
 * exercise Clerk before production keys land.
 */
export function clerkDevelopmentKeyBlockedInProduction(
  publishableKey: string | undefined = readClerkPublishableKey(),
): boolean {
  if (!isClerkDevelopmentPublishableKey(publishableKey)) return false;
  if (process.env.NODE_ENV !== "production") return false;
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv === "preview" || vercelEnv === "development") return false;
  return true;
}

/**
 * Whether the browser SDK and CSP origins may run. clerk-js needs only the
 * publishable key, but visible account controls also require an established
 * product Supabase session until the identity bridge exists end to end. With
 * no key, nothing Clerk-shaped renders and the Content-Security-Policy is
 * byte-for-byte its pre-Clerk self.
 *
 * A `pk_test_*` key on a production deploy is treated as unconfigured so dev
 * instances never ship to pubmaxxing.com (they hit strict rate limits and log
 * console noise). The captain must add production keys to enable Clerk live.
 */
export function isClerkConfigured(
  publishableKey: string | undefined = readClerkPublishableKey(),
): boolean {
  if (clerkDevelopmentKeyBlockedInProduction(publishableKey)) return false;
  return clerkFrontendApiOrigin(publishableKey) !== null;
}

/**
 * Whether clerkMiddleware() may run. SERVER-ONLY: it reads CLERK_SECRET_KEY, so
 * it must never be called from a client component.
 *
 * This is a SEPARATE and STRICTER gate than isClerkConfigured() on purpose, and
 * the difference is not cosmetic. clerkMiddleware() throws
 * "@clerk/nextjs: Missing secretKey" on EVERY request when the secret key is
 * absent, so a deployment carrying only the publishable key does not get a
 * degraded sign-in: it gets a site-wide 500 on every page, including pages that
 * have nothing to do with identity. Requiring both keys means a half-configured
 * deployment stays a fully working site with Clerk account controls hidden,
 * rather than a site-wide outage.
 */
export function isClerkMiddlewareConfigured(): boolean {
  const secretKey = process.env.CLERK_SECRET_KEY;
  return isClerkConfigured() && Boolean(secretKey && secretKey.trim());
}

/**
 * The instance Frontend API origin, decoded from the publishable key.
 *
 * Returns null for anything that is not a well-formed key, which is what makes
 * a malformed value fail CLOSED: no origin means Clerk stays off and the CSP
 * gains nothing, rather than an attacker-supplied host being admitted into
 * `script-src` by a key that merely looked close enough.
 */
export function clerkFrontendApiOrigin(
  publishableKey: string | undefined = readClerkPublishableKey(),
): string | null {
  const key = publishableKey?.trim();
  if (!key) return null;

  const payload =
    key.startsWith("pk_test_") ? key.slice("pk_test_".length)
    : key.startsWith("pk_live_") ? key.slice("pk_live_".length)
    : null;
  if (!payload) return null;

  // Decode on both runtimes. Node has Buffer; browsers have atob. Keeping this
  // public-key parser runtime-neutral lets security-policy callers validate a
  // key without depending on a Node-only global. The payload is ASCII (host +
  // `$`), so atob is exact.
  let decoded: string;
  try {
    decoded =
      typeof Buffer !== "undefined"
        ? Buffer.from(payload, "base64").toString("utf8")
        : atob(payload);
  } catch {
    return null;
  }

  // The payload is the host plus a single `$` terminator. A payload without it
  // was not a Clerk key, whatever it decoded to.
  if (!decoded.endsWith("$")) return null;
  const host = decoded.slice(0, -1).toLowerCase();

  // A host, and only a host: no scheme, no port, no path, no credentials, no
  // wildcard. This is the fence that stops a crafted key widening the policy.
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(host)) {
    return null;
  }

  return `https://${host}`;
}

/** The exact origins each CSP directive must gain for Clerk to work. */
export type ClerkCspSources = {
  script: readonly string[];
  connect: readonly string[];
  img: readonly string[];
  frame: readonly string[];
};

const NO_CLERK_SOURCES: ClerkCspSources = {
  script: [],
  connect: [],
  img: [],
  frame: [],
};

/**
 * Clerk's CSP additions, per Clerk's own CSP guidance
 * (https://clerk.com/docs/guides/secure/best-practices/csp-headers).
 *
 * Empty in every directive when Clerk is not configured, so the shipped policy
 * is byte-for-byte today's policy until the captain sets a key.
 *
 * Deliberately NOT included: `style-src 'unsafe-inline'` and `worker-src blob:`,
 * which Clerk also requires and which proxy.ts already carries for MapLibre.
 * They are listed here in a comment rather than the return value so nothing
 * re-adds them and so a future MapLibre change cannot quietly remove them
 * without a Clerk test noticing (__tests__/clerkProxyCsp.test.ts asserts both).
 */
export function clerkCspSources(
  publishableKey: string | undefined = readClerkPublishableKey(),
): ClerkCspSources {
  const frontendApi = clerkFrontendApiOrigin(publishableKey);
  if (!frontendApi) return NO_CLERK_SOURCES;

  return {
    // clerk-js itself is served from the instance Frontend API host.
    script: [frontendApi, CLERK_BOT_PROTECTION_ORIGIN, CLERK_ABUSE_PROTECTION_ORIGIN],
    // Session, sign-in and sign-up calls go to the same host.
    connect: [frontendApi, CLERK_ABUSE_PROTECTION_ORIGIN],
    // Account avatars only. Clerk uploads are NOT routed via /api/image-proxy
    // because they are first-party account images, not third-party venue photos.
    img: [CLERK_IMAGE_ORIGIN],
    // The Turnstile challenge and the abuse-protection frames.
    frame: [CLERK_BOT_PROTECTION_ORIGIN, CLERK_ABUSE_PROTECTION_ORIGIN],
  };
}
