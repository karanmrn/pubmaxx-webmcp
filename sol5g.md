# sol5g - PUBMAXX handoff, 30 Aug to 3 Sep 2026

Written 3 Sep 2026 00:20 BST by Fable 5.1 (firstmate orchestrator) for the captain and the next Codex primary. Covers the work since `sol30aug.md`. Product: PUBMAXX at pubmaxxing.com. Repo: github.com/Singularityszn/pubmax. Fleet home: `~/karan-agent-workspace`.

Everything here is on GitHub. Nothing lives only on the Mac.

---

## 0. Where production stands

- Production = Vercel project `chengdu` (team `pubmax69`), deployment `chengdu-7kap3whew`, built from main `3544db5` on 3 Sep 00:05.
- Migrations applied to the live Supabase project (`iankajxliutqogqkmvdg`): 0123 harvest overlays, 0123 social admin moderation, 0124 social admin revision guard, 0124 plan invite canonical membership, 0126 price trust reconciliation queue (1 Sep); 0133 plan account recovery idempotency, 0134 plan join account transition, 0135 plan claim active seat (2 Sep). 0127-0132 are ledger records of objects that were already live; never execute them.
- Deploy method: shallow clone of main, write `.vercel/project.json` (`projectId prj_FAC09rdCxDiGujUHeDOeZ04JLymc`, `orgId team_ZHYOvhX8M0Gxyq4J3XOgOwmF`), `npx -y vercel@latest deploy --prod --yes --scope pubmax69`. Builds remotely. One deploy per day, on the captain's word only.
- GitHub Actions is alive again. The full check set (four unit shards, lint and typecheck, production build, performance budget, coverage, UX lane performance, two RLS jobs, browser law pins) runs on every PR. Issue #1181 is stale on this point. Branch protection requires the head to be up to date with main; `gh pr update-branch <n>` fixes that from GitHub's side.

## 1. Merged this cycle (22 PRs, all deployed)

| PR | What it ships |
|---|---|
| [#1254](https://github.com/Singularityszn/pubmax/pull/1254) | Founder note on /about |
| [#1257](https://github.com/Singularityszn/pubmax/pull/1257) | Social state isolated per account |
| [#1261](https://github.com/Singularityszn/pubmax/pull/1261) | Legacy beta access kept retired (test pin) |
| [#1262](https://github.com/Singularityszn/pubmax/pull/1262) | Admin moderation of held social posts, safely |
| [#1270](https://github.com/Singularityszn/pubmax/pull/1270) | Public RSVP membership unified |
| [#1276](https://github.com/Singularityszn/pubmax/pull/1276) | UK base pubs load on map arrival |
| [#1282](https://github.com/Singularityszn/pubmax/pull/1282) | iOS and Android release paths refreshed |
| [#1284](https://github.com/Singularityszn/pubmax/pull/1284) | City entry aligned with capability evidence |
| [#1285](https://github.com/Singularityszn/pubmax/pull/1285) | Pal voice entitlement enforced |
| [#1286](https://github.com/Singularityszn/pubmax/pull/1286) | Index page props aligned with Next 16 |
| [#1287](https://github.com/Singularityszn/pubmax/pull/1287) | Missions on UK base pubs |
| [#1288](https://github.com/Singularityszn/pubmax/pull/1288) | Durable What's-On kept London-only |
| [#1289](https://github.com/Singularityszn/pubmax/pull/1289) | Durable price trust recovered safely |
| [#1295](https://github.com/Singularityszn/pubmax/pull/1295) | Production migration ledger reconciled (0127-0132 record live objects), 13 typecheck repairs, landing fences, account-switch card fix |
| [#1301](https://github.com/Singularityszn/pubmax/pull/1301) | Plan claim lane: guest-to-account join atomicity (E2) and capability recovery (E3) on the live RPCs |
| [#1302](https://github.com/Singularityszn/pubmax/pull/1302) | Captain's live bug list: one signed-in state across every page (`useViewerSession`, self-enforcing door test), map camera token owner, UK pin contrast 9.18:1, viewport-first map load (34 cells instead of 163), founders wall link, six UI audit fixes, FAB clearance |
| [#1303](https://github.com/Singularityszn/pubmax/pull/1303) | Speed programme, 8 units: `lcpMs` ceilings in CI, landing and /pal JS diet (/pal minus 603KB voice SDK), /about and /pubs split, font subsetting, honest API cache headers (raw viewer coordinates never in a URL or cache key), `api-budgets.json` with a trusted-code CI probe, DPR-1 method stated honestly, ratchet warning. Ceilings only ever come down |
| [#1304](https://github.com/Singularityszn/pubmax/pull/1304) | Shared e2e auth doubles; capability recovery proven in the browser. The signed-in journey is a documented skip: no CI secrets, no keyless auth bypass, ever |
| [#1305](https://github.com/Singularityszn/pubmax/pull/1305) | AGENTS.md pointer integrity fence (every pointer in the file resolves; corrections included) |
| [#1307](https://github.com/Singularityszn/pubmax/pull/1307) | Landing "Sign in" on a long-lived session fixed (`providerHasAnswered` in `lib/authProviderRevision.ts`: an `unavailable` provider state no longer renders as signed out). Greyhound and black cat Pal art wired in Circuit Robin style. Two residual sign-in races filed as #1306 |
| [#1308](https://github.com/Singularityszn/pubmax/pull/1308) | Design pass, desktop and mobile, 7 commits: 4 craft fixes, 4 captain-ruled fixes, empty-state gaps closed, phone typography scoped, editorial rail retry rule. Kickers above headings are brand and stay |
| [#1309](https://github.com/Singularityszn/pubmax/pull/1309) | /out venue badge: the label has one owner (`OUT_LISTING_VENUE_BADGE_LABEL` in `lib/outDesktopGrouping.ts`), duo mark kept |

## 2. Root causes found this cycle (so nobody re-investigates)

- **Landing showed "Sign in" on a long-lived session.** The auth provider's `unavailable` state was passed through as signed out. Fixed in #1307. Two narrower races remain (#1306).
- **Pub Pal showed old art.** Only Circuit Robin ever existed as new art; the six species were legacy SVG. Greyhound and black cat now exist (#1307). Fox, pigeon, badger, corgi still need generating (ElevenLabs free tier caps at 3 images a day; flow `I9rZih8pT1Z63EYwBSJF`, robin reference node `TQLw0dtKg7IAqPBs1GWO`, model gemini-3-pro-image, crop centre-square from 1376x768).
- **UK prices are not missing, they do not exist.** The dataset is London-only for prices. The UK harvest captured websites, menus, and lore, no prices. A UK price harvest is a sized-L job with one policy question: how much trust to give scraped prices (report: `data/queue-reconcile/uk-prices-report.md` in the fleet home).
- **PMTiles is not worth it** for the map: 5x fewer bytes but 3x more requests (`data/queue-reconcile/pmtiles-report.md`).
- **Map opened the wrong area.** Camera token had no single owner (#1302).
- **`/map` root is hard-wired to London.** A drinker who chose a city must be sent to `/map/<city>` from every Map link; the phone tab bar now uses `preferredCityMapHref()` like the landing page (on the audit branch, section 3).

## 3. Branches pushed and waiting (resume in this order)

All on origin. Two workers were still running when this file was written; check `gh pr list` first.

1. `fm/followups-0902` - design-pass follow-ups (admin social retry re-mints the session; malformed JSON classified as "unreadable answer"). Was in review round 3 at 00:15.
2. `fm/e1-claim-swap-prep` - E1 RPC swap (app half of migration 0135, which is now applied).
3. `fix-desktop-voids-rebased` - desktop layouts for /we-are-out, /near, /login (CSS only above 1024px).
4. `fix-session-password-prompt-rebased` - one-shot password-creation prompt.
5. `voice-audit-remaining-surfaces-rebased` - 16 brand and honesty copy fixes; composed stale line "No fresh picks to show just now. Last checked {date}."
6. `fm/grokbot-audit-fixes-v2` - the big one. Eight audit fixes plus nine rounds of pipeline fixes that chased account-boundary seams to their root. Its review ran 11 hours; the captain ordered it split. Rulings already made on it, keep them: preferred city is the single Map destination everywhere; event source links must be a real route, never a publisher front door with a tracking parameter; anonymous check-in and anonymous Wanted saves stay allowed; an action that names an account aborts on account rotation, an action that carries no identity completes as anonymous and never inherits the arriving account (encode as `requiresIdentity` on the queued action). Split into small PRs before validating again.
7. `fm/about-owner-biography-local-rescue` - superseded by #1254; verify nothing extra is on it, then delete.
8. `fm/agents-md-trim` - 164KB to 76KB. Lost four laws per review round twice. Re-enter only law by law, now that the #1305 fence exists.

## 4. Open issues that matter

- #1306 auth bootstrap: two races still let a failed auth read render as signed out.
- #1296 two CI checks were red on main (route over its perf ceiling; account-switch browser spec). Re-check after #1303.
- #1294, #1298, #1299, #1300 plan-account RPC edge cases (revoked seat, keyless replay, join and redeem fallback, browser proof). #1294 is closed by migration 0135 once E1 lands.
- #1292 `create_one_tap_price_pair` can report a Pint Drop nobody submitted. Live in prod but uncalled: revive or roll back.
- #1293 migration ledger numbers collide (two 0123s, two 0124s); the fence checks timestamps only.
- #1253 `crew_committed` counts join events, not nights.

## 5. Laws in force (captain's words, binding)

- Speed is the defining factor. Performance ceilings only ratchet down. Viewport-first progressive loading is the house law for heavy surfaces.
- Never merge red. Bot threads to zero. Local verify plus GitHub checks both green.
- No CI secrets and no keyless auth bypass seams for tests (refused three times). The signed-in journey is a documented skip until an isolated CI Supabase project exists.
- Raw viewer coordinates never in a URL or a shared cache key.
- Migrations run only on the captain's explicit word. Deploy only on the captain's word, once a day.
- Kickers above headings are brand. Design skills do not overrule them.
- Branding is PUBMAXX / PUBMAXXING. British English. No em dashes.
- Two workers max, two validation lanes max (raised from one on 2 Sep), memory checked every wake (below 25% free or above 3GB swap: act; below 5GB disk: reclaim caches). Workers never idle. Completed agents exit and close their panes.
- Never tear down unlanded work. Deep-verify before any deletion.
- Firstmate on Fable 5.1; workers on claude-opus-5 at xhigh.
- No synthetic traffic loops against production (Vercel's bot challenge trips).

## 6. Fleet and ops facts for the next primary

- Session start: `bin/fm-session-start.sh` once. Supervision per the emitted protocol. Backlog: `tasks-axi` on `data/backlog.md`.
- Worktrees: treehouse pool `pubmax-bde241`. Slot 4 = badge/train worker. `qr-recovery` = design worker. Slots 1, 2, 3, 5, 6, 7 were deleted after verification on 2 Sep. Stash@{2} is kept (WIP `fm/map-bundle-...`).
- The primary clone `projects/pubmax` holds skill-installer churn (deleted and modified files under `.agents/skills`, `skills/`, `package-lock.json`). Not real work. Awaiting the captain's discard word; workers pull origin directly so it blocks nothing.
- The no-mistakes pipeline (v1.53.0; v1.60.2 update held for an idle window) wedges its step agents at times: 0% CPU, 15 to 30 minutes silent. It usually resumes on its own within 20 to 30 minutes. Killing the pid (captain only; the permission classifier blocks the firstmate) respawns it at the cost of the round's review context. Prefer waiting unless past 30 minutes.
- A pipeline reviewer that logs `findings: []` every few minutes is working through a large diff, not looping.
- Split large branches before validating. Nine commits took 11 hours; one commit took 55 minutes.
- Browser automation against production hits Vercel's Security Checkpoint. The captain's phone is the real check.
- 8GB Mac: `NODE_OPTIONS=--max-old-space-size=2048`, one Playwright worker, `df -h` before browser phases.

## 7. Captain-gated decisions still open

1. UK price harvest: go or not, and the trust policy for scraped prices.
2. Authenticated e2e lane: service-role in an isolated CI Supabase project, yes or no.
3. Clerk: adopt or cancel.
4. Night-streaks shape (recommended: monthly recap alone plus spend-as-awareness).
5. Discard word for the dirty primary clone.
6. Stripe keys and the payments build.
7. Skiddle commercial approval; Google Places budget; Exa top-up.

## 8. Next features to build (Fable's plan, priority order)

This is the orchestrator's plan from established evidence and the captain's stated ambitions (speed as the differentiator, number-one consumer app, universal payments, free event API aggregation, CTA focus). The captain has not yet answered the grilling questions on the payments and events ambitions; those answers change the shape of items 10 to 13, not items 1 to 9.

### Tier 1 - land what is already written (day 1)
1. **Finish the branch queue** (section 3, items 1 to 5). Every one is already coded and rebased. Split item 6 into three PRs: badge and copy fixes; event-source honesty; account-boundary rule. Value on the board today.
2. **Deploy once a day** after the queue lands. Phone and desktop screenshots before each deploy.

### Tier 2 - close the trust gaps the audits exposed (days 1 to 3)
3. **Auth bootstrap races (#1306)**. One small PR. The seam is `lib/authSessionBootstrap.ts` plus `AuthProvider.tsx`; the tests must drive the real order (read fails, then session settles).
4. **Plan-account RPC edge cases (#1294, #1298, #1299)**. E1 lands first (0135 is applied), then the revoked-seat and replay cases in one PR with behavioural tests against the RPC.
5. **Remaining Pal species** (fox, pigeon, badger, corgi) in Circuit Robin style. Generate three a day on the free tier or use Grok Imagine with the captain's token. Wire through `pubPalMascotSlugFor`; rig fallback selection stays per-species.

### Tier 3 - the speed and honesty programme, phase 2 (week 1)
6. **API latency budgets, phase 2**: per-route p75 targets in `api-budgets.json` for the map and /out endpoints; the CI probe already exists. Ratchet down after each measurement.
7. **Map bundle, phase 3**: the stash `fm/map-bundle-...` WIP; target eager /map JS under 2.5MB. Pin-ready under 3.0s throttled 390x844.
8. **Price confidence tiers** (green confirmed / yellow labelled estimate / grey unknown) across every price surface, then the UK price harvest if the captain approves the trust policy. This is the honest path to "prices for other pubs".
9. **Monthly recap ("Year in Pints")**: genuine gap, standing free-forever commitment. Awaits the night-streaks shape call.

### Tier 4 - the ambitions (weeks 2 to 4, shape depends on the captain's answers)
10. **Free event API aggregation**: one ingestion layer for Skiddle, Eventbrite public feeds, TfL events, council feeds, and the editorial RSS overlay already committed on `fm/editorial-rss-overlay`. Store title, link, time, venue match, excerpt under 240 characters; never full bodies. Provider-agnostic route rule from the audit ruling: a listing gets a source link only when the URL is a real event route. Design the schema first (`event_listings` with source, external id, venue match confidence, freshness).
11. **CTA focus**: one primary action per surface, measured. Instrument `cta_tap` with surface and action, ship a weekly PostHog view, then cut every surface to its one CTA. The design pass (#1308) already removed competing controls on landing and /pal; extend to /out, /map sheets, and venue pages.
12. **Payments, step A (affiliate hand-off)**: ticket and booking hand-off to the provider with attribution, no card entry in PUBMAXX. Needs the Skiddle approval. Step B (round split) stays parked on Stripe keys and the ADR freeze decisions.
13. **Universal payment platform** is the captain's stated ambition. Do not start it before A ships and the trust tiers exist; the product promise is honesty first, and a payment surface on unverified prices breaks it.

### Always on
- Every PR through no-mistakes with the rulings above. Every merge on green. Every ask-user finding to the orchestrator.
- Keep AGENTS.md accurate; the pointer fence (#1305) fails the build on rot.

## 9. The four days in one paragraph

Merged 22 PRs and deployed twice: the social revival's follow-ups, the plan-account claim lane on live RPCs, the captain's whole live bug list (signed-in state, map camera, UK pins, viewport-first map), an eight-unit speed programme with CI ceilings that only ratchet down, a full desktop and mobile design pass, the landing sign-in fix, two new Pal species, and the badge fix. Eight production migrations applied. Found and recorded the real answers to the captain's three questions (sign-in state, Pal art, UK prices). Raised the fleet to two validation lanes, learned that one nine-commit branch costs eleven hours of review while one-commit branches cost an hour, and split accordingly. Six branches of finished work wait on origin for the morning.
