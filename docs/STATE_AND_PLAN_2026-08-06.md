# PUBMAXX state and forward plan - 2026-08-06 06:20

Compiled by Fable 5 from live checks. Production, CI, PRs, website, and disk
were each verified this morning, not carried from older documents.

## 1. Where the product stands

Production serves `f16aeabd` (content of current main `3ebacd34`), promoted
READY at 05:29. The v1 release wave (#726) and the CI env fix (#740) are both
merged and live. Migration `0070_v1_release_security` is applied. The Supabase
security advisor is down to one lint: leaked-password protection, a dashboard
toggle.

Verified live this morning on desktop 1440px and phone 390px:

- Landing is a real product introduction with honest price disclosure copy.
  The old "root resolves to Tonight" defect is gone.
- Mobile Map is excellent: one-bar chrome, clustered pins, no install prompt
  covering the viewport.
- Mobile Today flows correctly; the dead-panel defect is gone.
- Venue sheet at 390px shows all six tabs including Train; the price caption
  wraps, never truncates. The #726 fixes are live.

## 2. Bugs and issues found (fix plan, ordered)

P2 - design debt, confirmed still live:
1. Desktop Tonight compresses into a ~380px column with dead canvas either
   side. Today and empty Stories share the pattern. The #725 review's
   recommended slice (route-owned two-column compositions) remains undone.
2. Tonight section header says "No date on this yet" while the deal card below
   it prints a full listed time ("Thursday 6 August 2026; 18:00-19:30").
   Contradictory copy on one screen.
3. Events coverage is thin (3 listings for all London) because
   `events-refresh.yml` schedule is commented out and the events pipeline has
   no provider key. Content, not code.
4. "Lowest listed prices in central London, collected 3 July 2026" - honest but
   a month stale. Operating the refresh loop (Wave 1) is the fix.

P3 - polish questions:
5. "Bitter weather." joke sits beside a figure and a source line (Open-Meteo
   attribution). The voice contract says jokes never sit beside figures or
   sources. Either move it or rule it in as brand.
6. An unknown `?sel=` slug fails silent (opens all-London, no message).
   Decide: silent fail-soft or an honest "we do not know this pub" note.
7. Top-right map controls at 390px partially clip a cluster badge behind the
   persona control.

## 3. CI and infrastructure (the confidence-score work)

- **No CI runs on pull requests.** `ci.yml` is manual-only since 07-07
  (GitHub-hosted runner `startup_failure` on the private repo), and Vercel does
  not build Dependabot PRs. The ESLint 10 PR would have merged green while
  breaking `npm run lint` in every production build.
- **Blacksmith (#747)** is the intended cure and the PR is a clean mechanical
  swap to `blacksmith-4vcpu-ubuntu-2404` across all six workflows. But a live
  dispatch of `ci.yml` on that branch queued for 12+ minutes with no runner
  pickup: the Blacksmith GitHub App does not appear to be active for the
  Singularityszn org. Install/authorize it in the Blacksmith dashboard, rerun
  the dispatch, and only merge #747 once a job actually executes. Then
  re-enable `push`/`pull_request` triggers in `ci.yml` - that closes the
  no-CI-on-PRs hole for good.
- **Weather cache refresh** failure root cause: the workflow fetched weather
  fine, then `gh pr create` was refused - "GitHub Actions is not permitted to
  create or approve pull requests". Org-migration side effect: the new org's
  Actions setting forbids workflow-created PRs. Toggle: Settings > Actions >
  General > Workflow permissions. Same toggle gates drink-price-refresh and
  the whole review-PR data-refresh model. No code change needed.
- Dependabot PR verdicts (evidence-run, not guessed):
  - #738 TypeScript 7.0.2 - full repo typechecks clean under 7.0.2. Mergeable.
  - #739 lucide-react 1.28 - all 122 imported icons exist in 1.28.0. Mergeable.
  - #737 ESLint 10.8 - DO NOT MERGE. Locked eslint-plugin-react 7.37.5 crashes
    under ESLint 10 (removed `getFilename` API; peer range caps at `^9.7`).
    Wait for upstream plugin support.
- #724 (skills+catalog only) and #725 (one review doc) are safe to merge.

## 4. Social Night Loop - six stacked PRs, reviewed

Codex pushed the loop as six stacked draft PRs off main `3ebacd34`. A dedicated
crewmate reviewed all six against the durable contracts. Verdicts:

```
#741 identity        ready-after-fixes   needs product ack: legacy-handle freeze
                                         is NOT behind the beta flag - merging
                                         changes live claim behaviour (it closes
                                         a real hijack vector, but say so aloud)
#742 posts           mergeable           moderation fail-closed verified end to end
#743 interactions    mergeable           APPLY 0073+0074 AS ONE UNIT - block
                                         filtering of the main feed only exists
                                         after 0074 recreates the read functions
#744 composer        mergeable           fix: admin queue route maps store outages
                                         to 403 (outage reads as revoked access);
                                         confirm Vercel plan supports minutely crons
#745 crew authority  NEEDS REWORK        P1: no /privacy or /terms edit despite new
                                         personal data (crews, invites, receipts).
                                         P1: revokes service-role DML on SEVEN live
                                         legacy Plan tables and rewires that write
                                         path inside a flag-off Social PR - needs a
                                         regression proof of existing Plan flows
#746 projected reads ready-after-fixes   edits 0075 IN PLACE - merge #746 before
                                         migration 0075 is ever applied, or the
                                         database silently diverges from the file
```

Cross-stack: retimestamp the five social migrations (all 20260805*) past main's
`20260806035204_0070_v1_release_security` or prove order-independence - on any
fresh environment they currently sort before it. No CI beyond Effective RLS ran
on any of the six; every test claim in the PR bodies is author-run. Merge order
#741->#746 with base retargeting; do not apply any social migration until #746
is merged; then 0071->0075 in order. Single biggest risk: #745's rewiring of
the live legacy Plan collaboration write path.

Issues #734/#735/#736 track the rollout.

## 5. Known unknowns

- Whether Blacksmith runners execute at all for this org (queued test run).
- Whether the six Social PRs preserve the consent and identity contracts
  (crewmate review in flight).
- Clerk: production still carries a dev-instance key (100-user cap). The
  identity bridge (Clerk session -> PUBMAXX account authority) remains the one
  #725 P1 not closed by #726.
- The unapplied merged migration `20260804120000_0070_rate_limit_expiry.sql`:
  rate-limit rows still never expire in production. Karan applies.
- launchd refresh jobs not installed; scheduler shipped in #721 but inert.
- Whether `v1-*` local branches hold anything main lacks (mostly absorbed;
  small residues unverified).

## 6. Unknown unknowns worth instrumenting

- PostHog IS live on production (verified 06:07): a real project token is in
  the shipped bundle, consent-gated in lib/posthogClient.ts, delivered through
  the first-party /ingest reverse proxy. The PostHog wizard was unnecessary.
  What is missing is not instrumentation but ANALYSIS: nobody has read the
  funnel (venue accepted, plan accepted, saved, arrived, completed) out of
  PostHog yet. Wave 1's two-week funnel read can start today.
- No error telemetry on production runtime beyond Vercel logs.
- Price-data decay rate: the freshness spine reports stale vs unmeasurable,
  but nobody graphs row-age distribution over time yet (#725 Wave 1 item).

## 7. Feature gaps against product-market fit

Near-term (already specified, not built):
- Operate the trust loop: install scheduler, review first price-refresh PR,
  publish artifact age. (Wave 1)
- Offline mutation outbox for arrive/skip. (Wave 2)
- Group preferences: budget, accessibility, zero-proof, weather tolerance. (Wave 2)
- Price-free-city menu lookup fix for non-London. (Wave 2)
- Desktop Today/Tonight/Stories purposeful compositions. (Wave 1)

Later (owner-gated):
- Manchester pilot once London trust metrics stabilise (largest non-London
  pack, currently zero priced venues).
- Social rollout behind invite beta once the six PRs pass review and
  moderation staffing exists.
- Native store wrap, membership/payments.

## 8. Bloat and AI-slop audit (repo hygiene)

- 457 markdown docs, many superseded handoffs still claiming authority.
  #725's coordination ask stands: one current execution ledger, stamp the
  rest historical. Candidates for an `docs/archive/` sweep: the July
  FINDINGS_CONFIDENCE V1/V2, dated DEEP_REVIEW_*, superseded PRDs.
- 90 `worktree-agent-*` branches in the conductor pubmax clone and ~149
  local-only branches in the primary checkout are agent scratch; after
  salvage pushes, prune with owner sign-off.
- Open ledger items from confidence V3 remain: DeliveryStatus union duplicate,
  DAY_MS magic number, 7 raw `--brass` refs, share-helper duplication.
  One small cleanup PR closes the lot.
- lint warnings: 29, including controller complexity 255 - schedule a
  decomposition pass on the worst two controllers only.

## 9. Owner action list (everything blocked on Karan)

1. GitHub org: allow Actions to create PRs (weather + price refresh).
2. Blacksmith dashboard: activate the org, rerun the ci.yml dispatch, then
   merge #747 and re-enable ci.yml triggers.
3. Merge order for green PRs: #738, #739, #724, #725. Hold #737.
4. Apply `20260804120000_0070_rate_limit_expiry.sql`.
5. Supabase dashboard: enable leaked-password protection.
6. Clerk: create the production instance.
7. Install the two launchd refresh jobs.
8. londonrent: grant karanmrn access (or switch auth) so 9 unpushed branches
   can be preserved.
9. Conductor pubmax salvage push (pre-push hook blocks agents):
   `cd ~/conductor/workspaces/pubmax/chengdu && git push --no-verify origin conductor-archive/chengdu-dirty-20260806`
