# Pre-deploy adversarial audit — 2026-07-07 (HEAD e21a318)

Read-only audit of committed code. Fix priority before final Vercel deploy.

**Status updated:** 2026-07-09 (security hardening plan Phases 0–6).

## CRITICAL (real user-facing bugs — fix now)

- **C1** last-train drops the real last train 00:00–04:00: `dayTypeForDate` reads the London weekday off `now`, so post-midnight it picks the wrong service day and rejects the still-running previous-day trains. No service-day rollback. `app/api/last-train/route.ts` + `lib/tfl.ts`. Fix: before ~04:00 use the previous service day's schedule.
  - **Status:** OPEN (product/TfL correctness — outside security hardening plan scope)
- **C2** post-midnight minutes math says "safe" after the train left: `route.ts:527` adds +1440 based on the entry's static `pastMidnight` flag, not current time. A 00:30 train at 00:45 reports ~24h left. Base the +1440 on actual now. (Also `live:true` hardcoded at ~540 even for timetable data.)
  - **Status:** OPEN (product/TfL correctness — outside security hardening plan scope)

## HIGH

- **H1** report-hide threshold (2) trippable by one actor: per-actor report budget is 8/60s with no (drop_id, actor_hash) dedup. Cap per-actor report budget at 1, or dedup at the DB. `lib/pintDrops.ts:325`, `app/api/pint-drops/route.ts:222`, `lib/pintDropsStore.ts:474`.
  - **Status:** FIXED — `REPORT_PER_ACTOR_LIMIT = 1` + migration `0017_report_pint_drop_v2.sql` unique `(pint_drop_id, actor_hash)`
- **H2** crawl edit/delete authorship forgeable (destructive authz bypass): `isAuthor` trusts body.handle, no JWT. `app/api/crawls/[slug]/route.ts:55,90`. TRUE fix needs auth (Google OAuth off) — document + tighten what's possible.
  - **Status:** FIXED — `gateHandleAction` on crawl routes + `isAuthor(slug, handle, callerUserId)` requires linked-owner JWT match
- **H3** reaction toggle non-atomic (SELECT→DELETE/INSERT): concurrent toggles → uncaught 23505 → spurious 503, or lost DELETE → wrong final state. `lib/reactionsStore.ts:79`. Catch 23505 + recompute, or upsert RPC.
  - **Status:** FIXED — Postgres `23505` caught and recomputed in `lib/reactionsStore.ts`
- **H4** SW serves price_updates/latest.json cache-first → stale sourced price, no freshness signal. `public/sw.js` + `components/PubMap.tsx:422`. (Mitigated: fresher community drop still wins.)
  - **Status:** PARTIAL — SW network-first for price update paths on bulletproof hardening; verify on merge
- **H5** "Live from TfL" label shown for timetable/unavailable data. `components/map/LastTrainCard.tsx:204`. Gate on anyLiveDepartures.
  - **Status:** OPEN (product correctness — outside security hardening plan scope)

## MEDIUM (mostly known-pre-auth / self-asserted trust)

- legacy ("Family Table") drops render full handle+price+note on the fully-public `/ledger/[venueId]` with no viewer gating — "ledger-only privacy" is not private. `app/ledger/[id]/page.tsx:134`.
  - **Status:** FIXED — `resolveFamilyTableDisplay` redacts for non-authors; ledger viewer is JWT-first (`resolveViewerContextFromRequest`); production ignores spoofed `?viewer=`
- friends drops readable by passing any known-follower `?viewer=` handle.
  - **Status:** FIXED — `lib/pintDropViewer.ts` JWT-first; `?viewer=` only in development/test
- comment/reaction GET reads not gated by parent-drop visibility; notifications inbox readable/mutable by handle alone.
  - **Status:** FIXED — `filterPubliclyReadableDropIds` on comments/reactions GET; notification payloads cascade parent-drop visibility; private routes use `gateHandleAction` / linked-actor gates
- report fallback (pre-0004) lost-update race; profile unlinked-handle land-grab; rounds non-transactional TOCTOU; venue index silent-catch disguises outage as 404.
  - **Status:** PARTIAL — report v2 RPC + concurrent `linkUser` returns 409 via `gateHandleAction`; rounds TOCTOU deferred (out of plan scope)

## LOW

- client relativeTime has no future guard (4 components) → future ts prints "just now".
  - **Status:** OPEN (UX polish)
- rate limiter fails open across serverless instances (documented).
  - **Status:** ACCEPTED — documented; durable Supabase limiter when configured
- presenceStore.clean() control-char regex corrupted to `[ -]`.
  - **Status:** FIXED — `[\x00-\x1F\x7F]` in `lib/presenceStore.ts`
- OG footer domain typo `pubmaxing.app` → should be `pubmaxxing.com` (`opengraph-image.tsx:312`).
  - **Status:** FIXED — `pubmaxxing.com` on OG surfaces

## Verified SOUND (non-findings)

Realtime signal-only contract airtight; image upload (magic-byte + strip + sharp) strong; admin gate constant-time header-only (plus httpOnly session cookie); profile writes JWT-verified; DTO choke point withholds anonymous handles; heritage LLM fallback honest; `pint-drops` Storage bucket private + signed URLs; production refuse-to-start without Supabase / `ADMIN_TOKEN` / non-default `RATE_LIMIT_SALT`.

## Security hardening plan coverage (2026-07-09)

| Phase | Status |
| --- | --- |
| 0 Merge harden branch | Done (merged via #52 / #67) |
| 1 Ops hardening | Done |
| 2 Auth writes + JWT viewer | Done |
| 3 Visibility cascade + ledger | Done |
| 4 Private storage + signed URLs | Done (bucket `public: false` live) |
| 5 Admin session + headers | Done |
| 6 E2E / Dependabot / PR checklist | Done in this wave |
