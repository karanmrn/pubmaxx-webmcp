# Spec-Axis Review — PR corpus vs locked spec (2026-07-18)

Fixed point: `main@5e1252df`. Sources: `fable-implement-prd.md`, issues #252/#45/#168/#279/#281–#287, `docs/WAYFINDER_MASTER_V1.md`. Corpus: 40 open PRs (#276, #295–#336).

## (a) Missing / partial vs locked decisions

- **Identity "early email capture" — NOT built.** Cycle-2 lock: *"Identity: push harder — account prompt after first plan or first moment, **early email capture**."* Cycle-4 lane brief: *"email capture on account create surfaces."* #312 ships the two prompts but explicitly punts email: code comment reads *"Then hand off to the existing OAuth flow (email is captured there)."* No standalone/early capture surface exists (`grep emailCapture` → nothing in app/lib/components). The locked "early" intent — get the address *before* OAuth — is unmet.
- **USP bet 3 (live buzz) — not built.** Cycle-2: *"(3) live buzz layer (BLOCKED on EXA_API_KEY)."* Owner-gated, correctly deferred; still a hole in the "four USP bets — all four" claim.
- **USP bet 4 (group ledger polish) — redefined, not delivered as specced.** Cycle-2: *"(4) group ledger polish."* Cycle-6 log: *"PREMISE CORRECTION — bill-splitting never existed… Lane refused scope creep, polished the real Round loop."* #318 polished the Round loop; the bill-split feature the bet implied is an unresolved **OWNER DECISION**. So "all four USP bets built" is really two built (#302, #303), one blocked (buzz), one re-scoped (#318).
- **Funnel four metrics — all four computable. PASS.** #301: `plan_created`→`nights_planned_per_week`, `invite_created`/`invite_redeemed`, `DailyActivityPulse`/`shouldRecordDailyActivity` (daily return), `pwa_install_prompt_available`/`pwa_install_completed` (A2HS). Matches *"funnel of four… nights planned/week, invites per planner, return rate (measured daily), A2HS installs."*

## (b) Scope creep

- **#324 iPhone App PRD** runs against the standing Cycle-2 directive *"mobile WEB only. App/store/Apple work is owner-scheduled, later."* Later owner-sanctioned (Cycle-7 Xcode directive), so borderline rather than rogue — flagging the tension, not a violation.
- No PR introduces behavior with **no** PRD/issue/owner-directive trace. Zone lens (#329), production hardening (#330), study guide (#331), recap set (#333–#335) each map to an explicit owner directive or Cycle PRD. Clean on this axis.

## (c) Implemented-but-wrong

- **#313 A2HS gate — narrower than the lock.** Cycle-2 + Cycle-4: *"A2HS prompt after **second visit** or first completed night."* Code gates on `secondDayBucket` — a second *distinct calendar day*, not a second visit (`recordVisitDay` no-ops same-day reloads; test: *"same-day reloads are a no-op"*). Two visits the same evening never qualify. Cycle-4 quietly reconciled this to *"2nd day / day-bucket idiom"*, so it matches the refinement but not the literal locked word "visit". Owner should confirm day-bucket is intended.
- **#312 cooldown = 7 days** (`IDENTITY_NUDGE_COOLDOWN_DAYS = 7`), re-opens on next qualifying action. Consistent with *"push identity harder"* given it only fires post-dismissal and never gates browsing. OK.
- **Recap set matches Cycle-9 lock. PASS.** Lock: *"private approval-gated recap PAGE + generated OG image card… nothing shareable without the existing Story-approval consent flow."* #335 = private crew page + approval-gated public recap (single privacy choke point); #333 = OG card; #334 = arc seams + 24h grace. #336's R2 fix dropped public-recap photo TTL to 180s — consent-safe.

## (d) Issue hygiene

- **#45 (Last Pint) — CLOSE ON MERGE of #302.** Its one remaining item: *"Optional 'share moment' for a Last Pint decision, worded so it never encourages excess."* #302 ships `buildLastPintShareText` + send-to-crew + calm phrasing (`describeLeaveCountdown`, non-alarmist tests). Done.
- **#168 (store-factory dedupe)** — untouched by corpus; *"Precondition: F2 merged first"* + GPT-5.6 tier. Correctly still open.
- **#279 (dataset provenance meta.json)** — not built; borough/data PRs (#319/#320) didn't add the single-source `*.meta.json`. Remains open.
- **#252 THE LOCAL** — corpus builds loop pieces (instant answer #309, guardian #302, drops #303, recap #335) but **not the six-companion system** (Fox/Black Cat/Greyhound/Pigeon/Badger/Corgi). Substantially open.
- **Waves:** #286 (Wave 0) satisfied (#292/#294 + PNC). #283 (Wave 1) mostly met (#306 LCP, #297/#304/#305/#307/#311/#328) but the *"light/dark/**reduced-accessibility** matrix"* acceptance lacks proof. #285 (Wave 5) partial (#313 A2HS only). #287 (Wave 2 nine-city) and #282 (Wave 4 Pub Pal voice) correctly **deferred** per the London-only launch headline — do not close.
