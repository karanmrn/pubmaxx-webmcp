# SEO canonical host consolidation runbook (2026-07-21)

## Symptom

Google indexes the site as `http://www.pubmaxxing.com` with a stale 6 Jul 2026
snapshot (old title "Every pint has a story", old mug favicon) instead of the
current `https://pubmaxxing.com` content. Search results show a split-brain: two
hosts treated as two sites, and the www one is pinned to an old crawl.

## Diagnosis (real curl evidence, captured 2026-07-21)

Host variant behaviour:

```
$ curl -sI http://www.pubmaxxing.com | head -5
HTTP/1.0 308 Permanent Redirect
Location: https://www.pubmaxxing.com/      <-- upgrades protocol, KEEPS www host
Refresh: 0;url=https://www.pubmaxxing.com/
server: Vercel

$ curl -sI https://www.pubmaxxing.com | head -3
HTTP/2 200                                  <-- ROOT CAUSE: www serves a full 200
age: 0                                          mirror of the app, never redirects
content-type: text/html; charset=utf-8          to the apex

$ curl -sI http://pubmaxxing.com | head -3
HTTP/1.0 308 Permanent Redirect
Location: https://pubmaxxing.com/           <-- apex http->https is correct

$ curl -sI https://pubmaxxing.com | head -3
HTTP/2 200                                  <-- apex serves content (correct)
```

Redirect chain for the www host (two hops, second hop is missing):

```
$ curl -sIL http://www.pubmaxxing.com
HTTP/1.0 308  Location: https://www.pubmaxxing.com/
HTTP/2   200  (stops here — should be a 3rd hop: 308 to https://pubmaxxing.com/)
```

Both hosts serve the SAME current deployment (`dpl_Gz56EYhEPKq64RUyvvcqVo6sQmvs`),
so the "old content" on www is purely Google's cached old crawl of a URL that
still answers 200, not a stale deployment.

Canonical signals were already correct on BOTH hosts:

```
$ curl -s https://pubmaxxing.com     | grep canonical
<link rel="canonical" href="https://pubmaxxing.com"/>
$ curl -s https://www.pubmaxxing.com | grep canonical
<link rel="canonical" href="https://pubmaxxing.com"/>   <-- www already points at apex
og:url on both: https://pubmaxxing.com
title on both:  PUBMAXX: real pint prices on a live map (current)
```

Sitemap and robots were already apex-correct:

```
$ curl -s https://pubmaxxing.com/sitemap.xml | head
<loc>https://pubmaxxing.com/</loc>            (homepage present, priority 1.0)
<lastmod>2026-07-21T...</lastmod>             (real per-file mtimes, fresh)
$ curl -s https://www.pubmaxxing.com/sitemap.xml   -> also emits apex-absolute URLs
$ curl -s https://pubmaxxing.com/robots.txt | grep -i host
Host: https://pubmaxxing.com
Sitemap: https://pubmaxxing.com/sitemap.xml
```

## Root cause

`www.pubmaxxing.com` is assigned to the Vercel `chengdu` project as a normal
serving domain, NOT as a redirect. Vercel performs only the automatic http->https
upgrade (the first 308) and then serves the app on the www host with a 200. Since
the URL answers 200 and never redirects to the apex, Google keeps it indexed as a
separate, valid page and holds its last crawl of it (the 6 Jul snapshot).

The `rel=canonical` tags, og:url, sitemap, and robots Host directive were all
already pointing at the apex and are correct. A canonical link is only a HINT;
when a duplicate URL answers 200 with no redirect, Google routinely keeps
indexing it anyway. The missing piece is a DIRECTIVE: a permanent redirect from
www to the apex. There was none.

The metadata canonical infrastructure needed no change: every route already sets
`alternates: { canonical: "/..." }` resolved against
`metadataBase = https://pubmaxxing.com` (app/layout.tsx), so per-path canonicals
already resolve to the apex on every page (verified in the served HTML above).
Adding a global `alternates.canonical` would have been redundant and, if set to a
single value, actively wrong (it would canonicalize every page to the homepage).

## What changed in this repo

1. `next.config.mjs` — added a defensive, in-repo host redirect at the top of
   `redirects()` so www collapses into the apex regardless of the Vercel
   dashboard domain config:

   ```js
   {
     source: "/:path*",
     has: [{ type: "host", value: "www.pubmaxxing.com" }],
     destination: "https://pubmaxxing.com/:path*",
     permanent: true, // 308 (Google treats 301 and 308 identically for canonicalisation)
   }
   ```

   `has` host-matching fires only when the request host is `www.pubmaxxing.com`,
   so the apex is never self-redirected. `:path*` preserves the full path and
   carries "/" through to the apex root. This makes the www host answer with a
   permanent redirect to the apex even if the Vercel dashboard step below is
   never applied.

2. `__tests__/wwwHostRedirect.test.ts` — new test pinning the redirect rule
   (host condition, apex HTTPS destination, `permanent: true`, and that only the
   www host is matched so the apex is not self-redirected).

No change was needed to canonicals, sitemap, or robots: they were already
apex-correct (see diagnosis).

### Redirect hop note

With the repo redirect in place, `http://www.pubmaxxing.com` resolves in two
hops: Vercel upgrades `http://www` -> `https://www` (platform 308), then this
rule sends `https://www` -> `https://pubmaxxing.com` (app 308). Two hops is fine
for SEO (Google follows up to 5). The Vercel dashboard redirect below collapses
it to a single hop including the protocol upgrade, which is preferred; keep both
layers.

## Owner checklist (must be done by a human with Vercel + Search Console access)

### 1. Vercel dashboard — set www to redirect (single-hop, platform level)

- Open the `chengdu` project -> Settings -> Domains.
- Confirm `pubmaxxing.com` is the Primary domain.
- For `www.pubmaxxing.com`, set it to "Redirect to pubmaxxing.com" with a
  permanent (308/301) redirect (Vercel's domain redirect toggle), rather than
  leaving it as a serving domain.
- After saving, re-verify:

  ```
  curl -sI https://www.pubmaxxing.com   # expect: 308, Location: https://pubmaxxing.com/
  ```

  It must return a 3xx with `Location: https://pubmaxxing.com/`, NOT a 200.

  Note: the in-repo redirect (shipped in this PR) already makes www return a 308
  once this PR deploys, so this step is about getting the cleaner single-hop
  platform redirect. Do both.

### 2. Google Search Console — reconcile the two properties

- Add/confirm BOTH properties so the old indexed host can be inspected and its
  reindex requested:
  - `https://pubmaxxing.com` (the apex — the keeper)
  - `http://www.pubmaxxing.com` (the stale host Google currently shows)
  - Ideally also a Domain property for `pubmaxxing.com`, which covers every
    host/protocol variant at once.
- On the apex property: URL Inspection on `https://pubmaxxing.com/` ->
  "Request indexing" to push the fresh homepage (correct title/favicon).
- On the `http://www.pubmaxxing.com` property: URL Inspection on the www
  homepage. Once the redirect above is live, inspection reports it as a redirect;
  request validation so Google recrawls, sees the 308, and drops the www URL in
  favour of the apex.
- Submit the sitemap on the apex property: `https://pubmaxxing.com/sitemap.xml`.
- `/sitemap.xml` is PRERENDERED at build. `app/sitemap.ts` declares no `dynamic`
  and no `revalidate` and reads no request, so `next build` marks the route
  Static, bakes one file out of the repository's own `public/data`, and the CDN
  serves it until the next deploy. There is no per-request generation, so no
  runtime read can fail and no data pack is pinned into a function for it (Next
  skips `outputFileTracingIncludes` for a statically prerendered route).
- A bad data pack therefore FAILS THE BUILD rather than serving a 500. Two
  refusals, both in `app/sitemap.ts`: the grouped price dataset
  (`loadPintPriceLandingVenuesOrThrow`) empty, unreadable or unparseable, and an
  empty historic pack. Read the build log, fix the pack, redeploy. The last
  deployed sitemap stays up meanwhile, which is the point.
- Pack staleness is a separate alarm and does not run here: the freshness audit
  ages `historic_pubs` off `data/freshness_registry.json` and reports through
  `[freshness-audit]`. A pack that is present but old keeps building a full
  sitemap; that alert is what says it needs rebuilding.
- Favicon refresh: the classic `/favicon.ico` fallback now exists (app/layout.tsx
  icons), so once Google recrawls the apex the old mug favicon is replaced. No
  extra action beyond requesting indexing.

### 3. Verify after the platform redirect is live

```
curl -sI http://www.pubmaxxing.com    # 308 -> https (Location may be apex or www)
curl -sI https://www.pubmaxxing.com   # 308 -> https://pubmaxxing.com/   (NOT 200)
curl -sI http://pubmaxxing.com        # 308 -> https://pubmaxxing.com/
curl -sI https://pubmaxxing.com       # 200
```

Expected end state: every non-apex-https variant returns a permanent redirect
ending at `https://pubmaxxing.com`, and only `https://pubmaxxing.com` answers 200.

## Timeline expectation

Redirect + reindex request typically consolidates within days to a couple of
weeks. The www URL will drop out of the index once Google recrawls it and sees
the permanent redirect; the apex then carries all ranking signal with the current
title and favicon.
