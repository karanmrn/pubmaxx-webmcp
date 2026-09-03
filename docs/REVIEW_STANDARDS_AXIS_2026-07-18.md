# Standards-Axis Review — PR Corpus (2026-07-18)

Fixed point: `main@5e1252df` (last Sol merge). Reviewed `git diff 5e1252df...<branch>`
for the 12 highest-volume lanes. Axis: coding **standards** only (Spec is a separate axis).

## Documented standards in force
- **CONTEXT.md** — ubiquitous-language glossary with explicit `_Avoid_` terms. This is a
  hard naming standard (Mysterious Name / Primitive Obsession).
- **eslint.config.mjs** — `complexity: ["warn", 35]`; Next core-web-vitals + TS. Tooling-enforced → excluded below.
- **AGENTS.md / package.json** — `npm run verify` (validate-data · lint · typecheck · coverage) is the pre-push gate.
- **In-code seam conventions (load-bearing, self-documenting):**
  - *localStorage gate idiom* — `lib/firstRunTour.ts` header: "Mirrors the storage idiom in
    `lib/cityPreference.ts` (hasStorage guard, try/catch, same-tab CHANGE_EVENT for useSyncExternalStore)."
  - *Provider seam* — `lib/pushProvider.ts` & `lib/emailProvider.ts` both: "Selection mirrors the
    env-based store seam (`lib/storeBackend.ts` selectStore)": ONE interface, TWO impls (noop + real), `selectX()` env-gated.
  - *Cache-header convention* — `lib/apiResponses.ts` `jsonCached` defaults "match the codebase convention (pint-index CSV, last-train)."

## (a) Documented-standard violations (hard)
**None found.** The corpus is unusually disciplined against its own standards:
- CONTEXT.md naming: grep for banned spellings (`PubMax`, `Pub Max`, `Pubmaxing`) across new
  `lib`/`components`/`app` source in all lanes — **zero hits**. Domain types use the glossary
  correctly (`RecapPint`, `NightMoment`, `CrawlEnding`, Storage-key-only photos, `Provenance`).
- No new `@ts-ignore`/`@ts-nocheck`/`as any` in new lib code. The two `eslint-disable` lines in
  `NearMeNow.tsx` are the documented Geolocation "external-system sync" exception — justified, not a violation.

## (b) Baseline smells (Fowler ch.3 — judgement calls, not violations)

**Per-branch** — clean. No hard smells in `feat/instant-answer` (`nearMeAnswer.ts` is pure,
tie-break-documented), `feat/zone-price-lens` (`zones.ts` honesty-gated), `feat/recap-page`
(`recapView.ts` consent-gated), `feat/price-drops-v2`, `infra/production-readiness`
(`apiResponses.ts` small + documented). `design/token-system-v2` is CSS + PRD only — no TS surface.

**Cross-cutting** (the ~14-lane question):

1. **Duplicated Code / Data Clumps — delivery result types** (`feat/push-senders`,
   `feat/apns-transport`, `feat/email-digest`). The union
   `"sent" | "skipped" | "invalid" | "error"` is verbatim as both `PushDeliveryStatus`
   (`pushProvider.ts:34`) and `EmailDeliveryStatus` (`emailProvider.ts`), and `PerTokenResult`
   `{token,status,reason}` mirrors `PerMessageResult` `{to,status,reason,id}`. Two lanes built
   independently converged on the same shape. **Judgement:** extract the shared 4-member
   `DeliveryStatus` union; keep the result *records* per-provider (the `token`/`to` key and `id`
   genuinely differ, and the documented seam convention wants provider-agnostic-per-domain). Low urgency.

2. **Primitive Obsession / Magic Number — day bucket** (`feat/email-digest`, `feat/price-drops-v2`).
   `86_400_000` (ms/day) recurs 3× in `weeklyDigest.ts` (161,180,364) and in
   `pintContributions.ts:42`; `3_600_000` likewise. Each is locally commented. **Judgement:** a
   shared `DAY_MS`/`HOUR_MS` const would remove the repeated literal — minor. (`lateFood.ts`
   `dayIndex` is a *pre-existing* shared module, identical across all lanes — not new-code smell.)

3. **NOT a smell — the gate/provider repetition is the documented seam, not accidental dup.**
   The firstRun/nudge/a2hs/nativePush gate modules each re-implement the localStorage idiom **by
   design** (firstRunTour.ts says so); `pushProvider`/`emailProvider`/`storeBackend` mirror one
   seam **by design**. A premature shared abstraction here would fight the stated convention —
   leave as-is.

4. **NOT independent duplication — stacked lanes.** `feat/capacitor-ios-wrap ⊂ feat/push-senders ⊂
   feat/apns-transport` are supersets (`pushProvider.ts` 92→362, `pushTokenStore.ts` 106→136 lines),
   correct layering, not copy-paste. Separately, `lib/slimShards.ts` (264L),
   `scripts/lib/venueCanonicalization.mjs`, `harvest_/apply_outer_london_prices.mjs` are
   **byte-identical** across `perf/slim-borough-shards`, `feat/zone-price-lens`,
   `data/outer-london-osm` — a shared data-pipeline base, not divergent copies. **Merge-order flag,
   not a refactor:** identical content merges cleanly, but land the shared pipeline once (perf or
   data lane) before the dependent zone lane to avoid a false conflict.

5. **Speculative Generality — watch, lean keep** (`feat/push-senders`). `pushSender.ts`
   `resolvePlanTokens()` returns `[]` and `notifyPlanUpdate()` is a plumbed no-op for a
   plan-identity capability "no spec has yet." Borderline, but the header documents it as a
   deliberate privacy-safe closed seam (sending plan-scoped to all tokens would leak crew↔crew),
   with a concrete activation point. Justified plumbing, not dead abstraction — keep.

## Bottom line
Zero documented-standard violations. Two low-urgency cross-lane cleanups (shared `DeliveryStatus`
union; `DAY_MS` const). One merge-order note (shared slim-shard pipeline). The gate/provider
repetition is sanctioned convention — do **not** "DRY" it.
