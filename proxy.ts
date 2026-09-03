import { clerkMiddleware } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import type { NextFetchEvent, NextRequest, ProxyConfig } from "next/server";

import { clerkCspSources, isClerkMiddlewareConfigured } from "@/lib/clerkIdentity";
import { assertE2ELoginSafe } from "@/lib/e2eReviewAuth";
import { isPosterLandingSrc, posterNearHref } from "@/lib/posterLanding";
import {
  MAP_DOCUMENT_PATH,
  MAP_DOCUMENT_TWIN_PATH,
  mapRequestNeedsDocumentTwin,
} from "@/lib/mapDocumentTwin";

assertE2ELoginSafe();

const CANONICAL_HOST = "pubmaxxing.com";
const LEGACY_UK_BASE_GENERATION = "e229e760f3e7a2fd";

// THE ONE CSP EXCEPTION, AND ITS WHOLE LIST.
//
// Captain decision, 2026-08-09, answering the open question PR #974 left: the
// per-request nonce rules out static generation, ISR and PPR, so every page
// view was a function invocation with no CDN copy to serve instead. These two
// documents - and ONLY these two - drop the nonce and take
// `script-src 'unsafe-inline'` in exchange for being prerendered and served
// from the Vercel CDN. Both are public, both are anonymous: neither document
// carries a name, a handle, a session or any other personal figure, and the
// client fetches every personalised thing after load (a cached document that
// carried one would be handed to the next stranger).
//
// Every other route - identity, social, profile, admin and every API - keeps
// the strict per-request nonce exactly as before.
//
// This list is a tracked constant so that adding a route to it is a deliberate
// diff a reviewer sees, never a side effect of a refactor.
// `__tests__/clerkProxyCsp.test.ts` pins both halves: these two paths carry
// 'unsafe-inline' and no nonce, and the identity/social/admin routes carry a
// fresh nonce and no 'unsafe-inline'.
const CDN_CACHED_DOCUMENT_PATHS: ReadonlySet<string> = new Set(["/", "/map"]);

function servesCdnCachedDocument(pathname: string): boolean {
  return CDN_CACHED_DOCUMENT_PATHS.has(pathname);
}

// Preview and development deploys must never be indexed. VERCEL_ENV is the
// authority (preview hostnames change every deployment). Production keeps no
// extra robots header so the crawl invitation in app/robots.ts stands alone.
function applyNonProductionRobotsTag(response: NextResponse): NextResponse {
  if (process.env.VERCEL_ENV !== "production") {
    response.headers.set("X-Robots-Tag", "noindex, nofollow");
  }
  return response;
}

function normalizeHostname(host: string | null | undefined): string | null {
  const normalizedHost = host?.trim().toLowerCase();
  if (!normalizedHost) return null;
  if (normalizedHost.startsWith("[")) {
    const closingBracket = normalizedHost.indexOf("]");
    return closingBracket === -1
      ? normalizedHost
      : normalizedHost.slice(1, closingBracket);
  }
  return normalizedHost.replace(/:\d+$/, "").replace(/\.$/, "");
}

function requestHostname(request: NextRequest): string {
  return (
    normalizeHostname(request.headers.get("host")) ??
    request.nextUrl.hostname.toLowerCase()
  );
}

function isArtifactPreviewHost(request: NextRequest): boolean {
  const hostname = requestHostname(request);
  return [
    request.headers.get("x-vercel-deployment-url"),
    process.env.VERCEL_BRANCH_URL,
  ].some((artifactHost) => normalizeHostname(artifactHost) === hostname);
}

function servesApiCaller(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

function legacyUkBaseRewrite(request: NextRequest): URL | null {
  const prefix = `/data/uk_base/packs/${LEGACY_UK_BASE_GENERATION}/`;
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith(prefix)) return null;

  const activeGeneration = process.env.NEXT_PUBLIC_UK_BASE_GENERATION?.trim();
  if (!activeGeneration || !/^[a-f0-9]{16}$/.test(activeGeneration)) return null;

  const suffix = pathname.slice(prefix.length);
  if (
    !suffix ||
    suffix.includes("/") ||
    suffix.includes("..") ||
    !suffix.endsWith(".json")
  ) {
    return null;
  }

  const target = new URL(request.url);
  target.pathname = `/data/uk_base/packs/${activeGeneration}/${suffix}`;
  return target;
}

// AN API REQUEST IS A CALLER, NOT A READER, SO IT IS NEVER SENT ELSEWHERE.
//
// A 308 tells the client to ask again at another address, and a client that is
// not a browser may simply not do that. Vercel's cron dispatcher is one of
// those: it issues its scheduled GET against the deployment's own *.vercel.app
// host, so the host canonicalisation below answered every job on pubmaxxing.com
// with a 308 and NO handler ran - the social moderation pair every ten minutes
// and freshness-audit, which is the watchdog that would
// otherwise have said so. Nothing alerted because the alarm was among the dead.
//
// Serving those routes on the generated host is safe because their gate is the
// CALLER'S CREDENTIAL rather than the hostname: every app/api/cron/* handler
// calls assertCronRequest (lib/cronAuth.ts), which requires
// `Authorization: Bearer ${CRON_SECRET}` and denies in production when the
// secret is unset. The whole /api tree is exempt rather than /api/cron alone,
// because the same silence would swallow any webhook or callback aimed at a
// deployment URL, and because what the canonicalisation protects is the SEO
// split-brain that a crawlable DOCUMENT mirror creates. A JSON answer is not
// that mirror; page documents still canonicalise exactly as before.
//
// The trailing-slash rule further down is deliberately NOT exempted: with
// `skipTrailingSlashRedirect` in next.config.mjs, `/api/thing/` matches no
// route, so that 308 is what makes the address work rather than what breaks it,
// and it keeps the caller on the host it addressed.
function shouldRedirectVercelHost(request: NextRequest): boolean {
  if (!requestHostname(request).endsWith(".vercel.app")) return false;
  if (servesApiCaller(request.nextUrl.pathname)) return false;
  return !(
    process.env.VERCEL_ENV === "preview" &&
    isArtifactPreviewHost(request)
  );
}

function shouldSkipContentSecurityPolicy(request: NextRequest): boolean {
  const { pathname } = request.nextUrl;
  const excludedPath =
    servesApiCaller(pathname) ||
    pathname === "/_next/static" ||
    pathname.startsWith("/_next/static/") ||
    pathname === "/_next/image" ||
    pathname.startsWith("/_next/image/") ||
    pathname === "/favicon.ico";
  const prefetch =
    request.headers.has("next-router-prefetch") ||
    request.headers.get("purpose") === "prefetch";
  return excludedPath || prefetch;
}

// Per-request Content-Security-Policy with a fresh nonce.
//
// WHY THIS EXISTS (see the matching block that USED to live in next.config.mjs):
// the CSP was previously served as a static header, which forced
// `script-src 'unsafe-inline'` because Next.js 16's App-Router RSC streaming
// scripts (the per-page `self.__next_f.push(...)` bootstrap + hydration payload)
// are inline, and their content — hence any sha256 hash — differs per page and
// per build, so they can't be statically hashed. The ONLY way to drop
// 'unsafe-inline' from script-src without breaking hydration is a per-request
// nonce applied via this proxy: Next.js reads the nonce from the
// `Content-Security-Policy` REQUEST header (the 'nonce-<value>' pattern) and
// stamps it onto every inline script it emits. Our own inline scripts
// (speculation rules in app/layout.tsx, the copy-link handlers in
// app/p/[id] and app/crawls/[slug]) read the nonce from the `x-nonce` request
// header and carry it explicitly. External scripts (public/theme-init.js and
// the /_next/static/chunks/* bundles) stay covered by `script-src 'self'`.
//
// TRADE-OFF (acknowledged): a per-request nonce forces DYNAMIC rendering —
// static generation / ISR / PPR are incompatible with nonce CSP because a
// prebuilt shell can't know the request's nonce. That cost was paid on every
// route until 2026-08-09; it is now paid on every route EXCEPT the two named in
// CDN_CACHED_DOCUMENT_PATHS above, which is where the reasoning for the
// exception lives.
//
// This file is `proxy.ts` (not `middleware.ts`): Next.js 16 renamed the
// middleware convention to `proxy` (runs on the Node runtime). Every OTHER
// security header (HSTS, nosniff, XFO, Permissions-Policy, COOP, Referrer)
// still ships from next.config.mjs on `/:path*`; only the CSP moved here so it
// can be built per-request with the live nonce.
//
// This function is NOT the export Next.js runs - `proxy` at the bottom of this
// file is. It sends Social APIs here directly and wraps other matched requests
// with clerkMiddleware(). Keeping the security logic as its own named function
// lets redirect and CSP tests drive it with no Clerk key or NextFetchEvent.
export function securityProxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (shouldRedirectVercelHost(request)) {
    const canonicalUrl = new URL(request.url);
    canonicalUrl.protocol = "https:";
    canonicalUrl.host = CANONICAL_HOST;
    canonicalUrl.port = "";
    // Permanent host redirects still get the tag when not production so a
    // preview artifact never answers without noindex, even mid-redirect.
    return applyNonProductionRobotsTag(
      NextResponse.redirect(canonicalUrl, 308),
    );
  }
  if (pathname === "/ingest" || pathname.startsWith("/ingest/")) {
    return applyNonProductionRobotsTag(NextResponse.next());
  }
  if (pathname.length > 1 && pathname.endsWith("/")) {
    const canonicalUrl = new URL(request.url);
    canonicalUrl.pathname = pathname.slice(0, -1);
    return applyNonProductionRobotsTag(
      NextResponse.redirect(canonicalUrl, 308),
    );
  }
  // Hyphenated alias of /login. /signin stays the existing page redirect.
  if (pathname === "/sign-in") {
    const target = new URL(request.url);
    target.pathname = "/login";
    return applyNonProductionRobotsTag(NextResponse.redirect(target, 308));
  }
  const legacyUkBaseTarget = legacyUkBaseRewrite(request);
  if (legacyUkBaseTarget) {
    return applyNonProductionRobotsTag(NextResponse.rewrite(legacyUkBaseTarget));
  }
  // Physical QR path (PLG Wave 2): printed codes use /?src=poster (+ optional
  // utm_*), and the scan opens nearby prices rather than the marketing landing.
  // It is decided here rather than in app/page.tsx because reading the query
  // string in that server component is exactly the per-request work that stops
  // the homepage being prerendered. 307, matching the redirect() it replaces:
  // a poster campaign is not a permanent address change.
  if (pathname === "/" && isPosterLandingSrc(request.nextUrl.searchParams.get("src"))) {
    return applyNonProductionRobotsTag(
      NextResponse.redirect(
        new URL(posterNearHref(request.nextUrl.searchParams), request.url),
        307,
      ),
    );
  }
  // A /map request whose DOCUMENT differs from the prerendered shell (a town
  // arrival, national browse, a curated share card) is rewritten to the twin
  // that renders it per request. The address bar keeps /map, and the twin is
  // the same page: only which requests pay for a render changes.
  const documentTwinUrl =
    pathname === MAP_DOCUMENT_PATH &&
    mapRequestNeedsDocumentTwin(request.nextUrl.searchParams)
      ? (() => {
          const target = new URL(request.url);
          target.pathname = MAP_DOCUMENT_TWIN_PATH;
          return target;
        })()
      : null;
  if (shouldSkipContentSecurityPolicy(request)) {
    return applyNonProductionRobotsTag(
      documentTwinUrl ? NextResponse.rewrite(documentTwinUrl) : NextResponse.next(),
    );
  }

  // The nonce exception, and the ONLY place it is decided. A prerendered
  // document cannot carry a per-request nonce - every visitor would be handed
  // the same one, which is the one thing a nonce may not be - so the two
  // allow-listed paths take `script-src 'unsafe-inline'` instead. A /map
  // request rewritten to the twin above gets no CDN copy, so it has nothing to
  // buy with the nonce and keeps it.
  const cdnCachedDocument = servesCdnCachedDocument(pathname) && !documentTwinUrl;

  // Crypto-random, base64-encoded nonce (a fresh UUID per request).
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  // script-src: NO 'unsafe-inline' (its removal is the entire point of this
  //   file — and browsers ignore 'unsafe-inline' whenever a nonce is present
  //   anyway). 'self' covers the external theme-init + the async /_next/static
  //   chunk bundles; 'nonce-<value>' covers Next's inline RSC bootstrap +
  //   hydration payload and our own nonce-stamped inline scripts. Local
  //   `next dev` additionally gets 'unsafe-eval' because React's development
  //   tooling uses eval for call-stack reconstruction; production never does.
  //   NB: no 'strict-dynamic' — it would make the browser ignore the 'self'
  //   source expression, blocking the parser-inserted external theme-init.js;
  //   Next's chunk loading is happy under plain 'self' + a nonce'd bootstrap.
  //   The external host is va.vercel-scripts.com for Vercel Analytics.
  //   Vercel injects its tag itself, so it carries no nonce of ours; the script
  //   is still consent-gated in the app (`beforeSend` cancels pre-consent
  //   pageviews — docs/OBSERVABILITY_CERTIFICATION.md), so allowing that origin
  //   does not widen what may be collected, only what may load.
  //   Clerk adds its instance Frontend API host (which serves clerk-js), the
  //   Cloudflare Turnstile challenge host and Clerk's abuse-protection hosts.
  //   Every one of them is an exact origin derived from the publishable key or
  //   named in lib/clerkIdentity.ts; NONE of them is 'unsafe-inline', and
  //   nothing here relaxes the nonce contract above. With no Clerk key set,
  //   `clerk.script` is empty.
  // Local development may point NEXT_PUBLIC_SUPABASE_URL at an auth stack on
  // this machine (`supabase start`, or a stub GoTrue for keyless auth testing);
  // the `*.supabase.co` allowance never covers that origin, so browser sign-in
  // silently dies under the CSP. The extra origin joins connect-src only under
  // `next dev` — production builds never widen.
  const devSupabaseConnect = (() => {
    if (!isDev) return "";
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!url) return "";
    try {
      const origin = new URL(url).origin;
      return origin.endsWith(".supabase.co") ? "" : ` ${origin}`;
    } catch {
      return "";
    }
  })();

  const clerk = clerkCspSources();
  const clerkScript = clerk.script.map((origin) => ` ${origin}`).join("");
  // On a prerendered document the nonce slot becomes 'unsafe-inline'. What that
  // costs is exactly this: Next's own inline RSC bootstrap and our two inline
  // blocks in app/layout.tsx (speculation rules, site JSON-LD) are admitted by
  // being inline rather than by carrying a secret. Other source expressions
  // remain unchanged. Both surfaces render no personal data and take no user
  // input into markup.
  const inlineScriptSource = cdnCachedDocument
    ? "'unsafe-inline'"
    : `'nonce-${nonce}'`;
  const scriptSrc = `script-src 'self' ${inlineScriptSource} https://va.vercel-scripts.com${clerkScript}${isDev ? " 'unsafe-eval'" : ""}`;

  // frame-src did not exist before Clerk: framing fell through to `child-src
  // blob:`, so blob: frames were the only ones allowed. Turnstile and Clerk's
  // abuse protection both render in iframes, so the directive becomes explicit
  // — and it KEEPS blob: so the fallback's existing permission is preserved
  // rather than quietly revoked. It stays absent entirely when Clerk is off.
  const clerkFrameSrc =
    clerk.frame.length > 0 ? [`frame-src blob: ${clerk.frame.join(" ")}`] : [];

  // The baseline non-script directives below follow the previous static CSP in
  // next.config.mjs. See that file's history for the per-directive rationale.
  const contentSecurityPolicy = [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // img-src is deliberately MINIMAL — a "proxy-or-nothing" guard (image
    // rights audit U9, docs/IMAGE_RIGHTS_AUDIT_2026-07-21.md). Only origins the
    // BROWSER loads directly are listed: Wikimedia (landmark cards in
    // PubMapCanvas + /landmark/[id], via Special:FilePath which 302s to
    // upload.wikimedia.org), the Greene King Sitecore DAM (the 4 food-menu tiles
    // MenuCategoryGrid renders raw), *.supabase.co (community Pint Drop photos +
    // user avatars, our own bucket) and *.googleusercontent.com (Google IdP
    // sign-in/profile avatars). Every OTHER venue photo — the ~439 open-ended
    // pub-website hosts plus the brand/platform CDNs — is fetched server-side by
    // /api/image-proxy and re-served same-origin, so it loads under 'self' and
    // needs no entry here. The brand/platform origins that USED to be listed
    // (jdwetherspoon, greeneking, staticflickr, tripadvisor, squarespace-cdn,
    // inapub, wixstatic, whatpub S3, gstatic) were dead — never loaded directly —
    // and were removed so a future direct hotlink of unlicensed imagery fails
    // visibly instead of silently shipping. Do NOT re-add a third-party image
    // host here: route it through /api/image-proxy (and license it) instead.
    // Clerk adds https://img.clerk.com here, its own account-avatar CDN. It is
    // a first-party ACCOUNT image, not a third-party venue photo, so the
    // "proxy-or-nothing" rule above is untouched: no venue imagery may join it.
    `img-src 'self' data: blob: https://commons.wikimedia.org https://upload.wikimedia.org https://*.supabase.co https://*.googleusercontent.com https://gkbr-p-001.sitecorecontenthub.cloud${clerk.img.map((origin) => ` ${origin}`).join("")}`,
    "font-src 'self' data: https://tiles.openfreemap.org",
    // Clerk adds its Frontend API host (session, sign-in and sign-up calls) and
    // its abuse-protection hosts. Supabase's entries stay: both auth systems
    // run side by side, and removing either would break the other's sign-in.
    `connect-src 'self' https://tiles.openfreemap.org https://basemaps.cartocdn.com https://tiles.basemaps.cartocdn.com https://*.supabase.co wss://*.supabase.co${devSupabaseConnect}${clerk.connect.map((origin) => ` ${origin}`).join("")}`,
    // Clerk also requires worker-src 'self' blob: — already true for MapLibre's
    // tile workers and the offline service worker, so it needs no change here.
    "worker-src 'self' blob:",
    "child-src blob:",
    ...clerkFrameSrc,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");

  // Forward the nonce to the render: `x-nonce` for our own components
  // (app/layout.tsx et al. read it via next/headers), and the CSP itself on the
  // REQUEST header so Next.js can extract the nonce and stamp its inline scripts.
  //
  // A prerendered document is handed NEITHER header. There is no nonce to
  // forward, and a request header rewritten here would make the request
  // request-specific, which is the thing a CDN copy must not be.
  const forwardedRequest = cdnCachedDocument
    ? undefined
    : (() => {
        const requestHeaders = new Headers(request.headers);
        requestHeaders.set("x-nonce", nonce);
        requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
        return { request: { headers: requestHeaders } };
      })();

  const response = documentTwinUrl
    ? NextResponse.rewrite(documentTwinUrl, forwardedRequest)
    : NextResponse.next(forwardedRequest);
  // And on the RESPONSE header so the browser actually enforces it.
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return applyNonProductionRobotsTag(response);
}

// THE SHIPPED ENTRY POINT. Clerk's quickstart says to create proxy.ts with
// `export default clerkMiddleware()`; this file already existed, so Clerk is
// COMPOSED with it via clerkMiddleware's handler form for matched non-Social
// requests. Clerk establishes auth context, then calls securityProxy. Social
// APIs use Supabase authority and go directly to securityProxy. Neither the
// canonical-host redirect nor the CSP nonce is lost.
//
// WHY A NAMED `proxy` EXPORT AND NOT `export default`:
// Next.js resolves the userland handler as `mod.proxy || mod.default`
// (packages/next/src/build/templates/middleware.ts), so the NAMED export wins.
// Leaving the old `export function proxy` in place beside a default Clerk
// export would have made Next keep running the un-composed function and Clerk
// would never have executed, with no error anywhere.
//
// WHY THE TERNARY, AND WHY IT NEEDS BOTH KEYS: clerkMiddleware() throws
// "@clerk/nextjs: Missing secretKey" on EVERY request when CLERK_SECRET_KEY is
// absent, so gating on the publishable key alone would turn a half-configured
// deployment into a site-wide 500 on pages that have nothing to do with
// identity. Verified by running this app with only the publishable key set.
// Requiring both keys means the worst half-configured case is browser-side
// Clerk with no server session, and the site itself stays up.
const clerkSecurityProxy = isClerkMiddlewareConfigured()
  ? clerkMiddleware(async (_auth, request) => securityProxy(request))
  : null;

export const proxy = clerkSecurityProxy
  ? (request: NextRequest, event: NextFetchEvent) =>
      request.nextUrl.pathname === "/api/social" ||
      request.nextUrl.pathname.startsWith("/api/social/")
        ? securityProxy(request)
        : clerkSecurityProxy(request, event)
  : securityProxy;

export const config = {
  matcher: [
    {
      source: "/:path*",
      has: [{ type: "host", value: ".+\\.vercel\\.app" }],
    },
    { source: "/:path+/" },
    // Clerk's own frontend API routes. Clerk requires the matcher to cover this
    // prefix so its handshake and session requests reach the middleware; it is
    // listed ahead of the general rule below because that rule's `missing`
    // prefetch clause must never be able to exclude a Clerk request.
    { source: "/__clerk/:path*" },
    {
      source: "/((?!api|ingest|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
} satisfies ProxyConfig;
