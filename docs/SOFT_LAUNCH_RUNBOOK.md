# Soft-launch runbook

_An operator's checklist for the PubMaxx v1 soft launch. Follow it in order. It tracks issue [#392](https://github.com/Singularityszn/pubmax/issues/392)._

---

## 1. Rollout order

### 1.1 Deploy mechanism

Vercel builds on every push through its Git integration. `vercel.json` sets the build command:

```json
{ "buildCommand": "npm run validate-data && npm run build" }
```

This runs the data gate and the Next build only. It does not run lint, typecheck, tests, or the audit.

**`docs/DEPLOYMENT.md` says the build command is `npm run ci` (the full gate). That is out of date.** PR [#748](https://github.com/Singularityszn/pubmax/pull/748) narrowed the Vercel build command on 2026-08-06 to cut build-hour cost. Tests, lint, and typecheck moved to GitHub Actions CI (`.github/workflows/ci.yml`).

GitHub Actions CI is configured for stock `ubuntu-latest` runners via `.github/workflows/ci.yml` (lint, `tsc --noEmit`, sharded `vitest run` on every pull request and on push to `main`). Hosted jobs can fail before execution when the repository has a billing or runner-allocation fault. That state is not a test failure, but it is still a release-gate failure. Record local `npm run ci` evidence and restore hosted execution before calling the release gate green. Do not repoint `runs-on` to a private runner as a silent workaround.

Effective RLS stays in `.github/workflows/rls-session.yml` (Postgres 16 + PostgREST 14). Keep both workflows green on every pull request.

### 1.2 Promote after deploy

This project does not auto-assign the production domain to every deploy. After a Vercel deploy, promote it explicitly:

```sh
vercel deploy
vercel promote <deployment-url>
```

Deploying from a Mac is fine because the build runs in Vercel's cloud. Never pass `--prebuilt` from a Mac: the locally built sharp binary is darwin-arm64 and crashes the linux runtime. `docs/DEPLOYMENT.md` documents why promotion is safe to use after a build: the promotion API points production traffic at an existing deployment and does not rebuild it. The exact `vercel deploy` / `vercel promote` command pair above is operator practice; it is not itself written down in `docs/DEPLOYMENT.md`, so treat this section as the source for it going forward.

After promotion, confirm both hosts serve the release:

```sh
curl -sSIL https://pubmaxxing.com/map
curl -sSIL 'https://www.pubmaxxing.com/map?sel=venue-xjf3n0'
```

### 1.3 Migrations

The owner applies migrations. Agents ship SQL only.

`FABLE_HANDOFF.md` is not a current ledger. Its latest entry is dated 2026-07-23 and covers migrations only up to roughly `0053`. Do not use it to decide what is applied.

To check the live ledger, compare `supabase/migrations/` against the Supabase dashboard's migration history for the project (Database → Migrations), or run:

```sh
supabase migration list
```

**Ledger reconciliation re-verified 2026-08-31:** production contains the objects
recorded by source migrations `0127`-`0132`. The production objects were applied
on 2026-08-27 through PR [#1237](https://github.com/Singularityszn/pubmax/pull/1237),
which then closed unmerged. The source bodies are idempotent against that
production state and let a fresh database reproduce it. This records source-ledger
parity; it does not prove that Captain has applied these new version rows to the
remote ledger.
Check `supabase migration list` before any push or database action.

The Plan account-claim follow-up migrations `0133` and `0134` are in the
source ledger with matching rollback files. Their account-claim RPCs are
already live in production, so the application change has no deploy-order
hazard. Captain still owns reconciling and applying these source migration
rows before treating their revised recovery and account-join behaviour as
applied.

The complete applied order is deliberately not copied here. Treat the live
`supabase migration list` and the files in `supabase/migrations/` as authoritative.

Note the order: `0075_social_crews` has a later timestamp than `0076` and `0077`, so it applied after them despite its lower number. This is the same out-of-order case `docs/DEPLOYMENT.md` documents for `0070`-`0072`. Future pushes should still use `supabase db push --include-all` rather than assuming filename-number order.

If a later agent finds the live ledger behind the tree again, re-run `supabase migration list` (or the dashboard history) before applying, and never assume this section is current.

### 1.4 Feature flags

Social ships behind one server-checked launch switch:

| Flag | Read in | Emergency rollback (`=0`) | Live default |
|---|---|---|---|
| `PUBMAX_SOCIAL_FRIENDS_LAUNCH` | `lib/socialAccessServer.ts`, `app/layout.tsx`, `app/api/out/route.ts`, and public Crew route | Set only to `0` during an incident. Every Social surface returns to **preview**. Landing and `/we-are-out` point at Memories, not Open Social. The surface names itself **Social preview** in the desktop nav, command palette, and Social pages; the phone tab keeps `Social` with a preview dot and spoken name `Social preview`. | Unset, empty, `1`, or `true` keeps Social **live**. Signed-in Supabase accounts with a claimed handle and an 18+ answer reach **verified** access. When a date of birth exists, it decides the answer; otherwise, one recorded self-assertion can answer it. Friends-only reads use mutual follows (WP6). |

**Live default:** leave `PUBMAX_SOCIAL_FRIENDS_LAUNCH` unset or empty in Production and Preview. `1` and `true` are also live values. `0` is the only emergency rollback value and returns Social to preview.

**Live-state verification (captain act):**

1. Confirm `PUBMAX_SOCIAL_FRIENDS_LAUNCH` is unset, empty, `1`, or `true` in Vercel **Production** environment variables.
2. Confirm `OPENAI_API_KEY`, `SUPABASE_*`, `ADMIN_TOKEN`, and `RATE_LIMIT_SALT` are already set (avatar scan + moderation queue).
3. Promote a fresh production deployment (`vercel --prod` or dashboard promote). The flag is read at request time, but a redeploy is the audited change record.
4. Run the captain demo script below on the production host (or a staging env with the same flag and secrets).
5. Keep `PUBMAX_SOCIAL_FREEZE` unset unless ops needs to pause writes without hiding the surface.

**Emergency rollback (captain act):**

1. Set `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` in Vercel **Production** environment variables.
2. Promote a fresh production deployment and run the rollback check below.
3. Restore the live default by removing the variable or setting it to `1` or `true`, then promote again.

### 1.5 Captain demo script (Social + avatars dress rehearsal)

Run after a fresh deployment with `PUBMAX_SOCIAL_FRIENDS_LAUNCH` unset, empty, `1`, or `true` in the demo environment. `0` is rollback state and must pass the rollback check below.

**Emergency rollback check (`=0`):**

1. Open `https://pubmaxxing.com/social` signed out.
2. Confirm the preview heading: "Social preview is invite-only for now. It opens more widely soon."
3. Confirm no post lanes, compose button, or protected feed content appears.
4. Confirm the desktop nav and the command palette both read `Social preview`, and the phone tab reads `Social` with the preview dot.

**Live default check (full loop):**

1. **Sign in** at `/login` with a fresh Supabase test account (magic link).
2. **Claim a handle** and provide an 18+ answer. When a date of birth exists, it decides the answer; otherwise, record one self-assertion (D2).
3. Confirm `/social` lands in **verified** state (compose + Posts lane visible).
4. **Upload a profile photo** on `/u/<handle>` → Edit profile. A normal photo should appear on the public profile after one request.
5. **Join a plan crew** with a second account and confirm the mutual follow edge forms (WP7); search handles from Social if needed.
6. Post a **friends-only** update from account A; confirm account B (mutual) sees it and account C (non-mutual) does not.
7. **Flag a photo** via the reader report path; confirm it queues in Admin → profile avatars (reported lane).
8. **Hide** the reported avatar from the admin console; confirm the public profile falls back to initials.
9. Attempt a **known-bad test image** upload; confirm instant honest refusal (no silent publish).
10. Temporarily unset `OPENAI_API_KEY` in a staging slot and retry upload; confirm the photo still uploads and one `uploaded_image.scan_skipped` line names the surface and the reason. The scan is advisory; the report/hide lane is the net.

**Automated rehearsal (Playwright):**

```sh
# Live smoke coverage - explicit `=1` is equivalent to live default.
npm run test:e2e -- e2e/smoke.spec.ts e2e/profile-avatar.spec.ts

# Social live-loop dress rehearsal (`=1`):
PW_SOCIAL_OPEN=1 PUBMAX_SOCIAL_FRIENDS_LAUNCH=1 npm run test:e2e -- e2e/social-open.spec.ts
```

---

## 2. Smoke checklist (post-deploy)

Run each check on the production host after every promoted deploy.

| Check | URL | Good looks like |
|---|---|---|
| Sign-in journey | `https://pubmaxxing.com/login` | Email field accepts an address, submit shows the same neutral confirmation message for any address, magic link email arrives, the link signs the browser in and lands on `/map`. |
| Handle claim | `https://pubmaxxing.com/map` after sign-in | Account onboarding offers a handle claim. An account with an existing handle shows it as already owned, never a fresh claim form. |
| Map paint | `https://pubmaxxing.com/map` | Pins render within a few seconds, cluster and un-cluster on zoom, no console errors. |
| Venue sheet | Tap any pin on the map | Sheet opens with venue name, address, and price state (a real price, or an honest "no price logged" line, never a blank). |
| Plan generate | `https://pubmaxxing.com/plan` | Five-step intake completes and returns a priced route, or the honest 422 "No three-stop route ... meets every must-have need" message. Never a raw error page. |
| Plan invite share | After locking in a plan on `/plan/[id]` | "Send on WhatsApp" is the primary next action; "Copy invite link" works for the host session and never for an anonymous visitor to the same URL. |
| Public invite RSVP | `/invite/[token]` from the host copy | Guest can RSVP with a name only; "Open these stops on the map" is present before and after the RSVP, and opens `/map?mode=build&pubs=<ordered stops>` (one stop opens `/map?sel=<id>`). |
| Host Remove (cookie path) | Host revisits `/invite/[token]` after a guest RSVP | Remove appears for the host; after Remove the guest row is gone and stays gone on reload. Guest browsers never see Remove. |
| Social tab | `https://pubmaxxing.com/social` | With `PUBMAX_SOCIAL_FRIENDS_LAUNCH` unset, empty, `1`, or `true`: verified adults see the feed; everyone else sees the correct `sign_in_required` or `SOCIAL_ADULT_VERIFICATION_REQUIRED` state with `Adult verification is needed for Social.`. With `=0`: the surface is named `Social preview`, safe preview copy only, no post content, and no sign-in-required content leak. |

---

## 3. Rollback

### 3.1 Application code

Promote the previous known-good deployment:

```sh
vercel promote <previous-deployment-url>
```

Find the previous URL in the Vercel dashboard's Deployments list, or `vercel ls`. This does not rebuild anything; it repoints production traffic.

### 3.2 Migrations are not rollback-safe by default

Applied migrations are not covered by a code rollback. Rolling back the app does not undo a schema change.

Every migration from `0071` onward, including reconciliation migrations `0127`-
`0134` (section 1.3), has its own matching file in
`supabase/migrations/rollback/`. Run the rollback SQL manually against the
database; nothing runs it automatically.

Two points to know about the already-applied history:

- `0065`-`0069` (the RLS wave 2 migrations) share one combined rollback file, `20260803200000_rls_wave2_rollback.sql`. Roll all five back together, not one at a time.
- `20260806035204_0070_v1_release_security.sql` has its own rollback file. Its same-numbered sibling, `20260806145644_0070_rate_limit_expiry.sql`, has none. If a problem traces back to that second migration, write and review rollback SQL by hand before running it. Do not assume the two share a rollback file just because they share a number.

Migrations before `0065` have no rollback files at all. Treat any rollback need there as a manual, reviewed operation.

---

## 4. Monitoring

| Source | What it shows | Where |
|---|---|---|
| Vercel deployment logs | Build and runtime logs, function errors | Vercel dashboard → project → Deployments → select a deployment → Logs |
| Vercel usage | Build-hours, function invocations, bandwidth | Vercel dashboard → project → Usage |
| Supabase logs | Postgres and PostgREST request logs | Supabase dashboard → project → Logs |
| Supabase advisors | Security and performance lint findings on the live schema | Supabase dashboard → project → Advisors |
| PostHog | Product analytics, funnels, sign-up conversion | `https://eu.posthog.com/project/219466` |
| RLS session tests | Effective row-level-security proof on every push | `gh run list --repo Singularityszn/pubmax --workflow=rls-session.yml` |

### First 48 hours, watch for

- 401 spikes on `/api/*` routes: a real auth regression, not routine sign-out traffic.
- 429 spikes: rate-limit budgets too tight for real launch traffic, or a client retry loop.
- Error rate climbing on any single route in Vercel's runtime logs.
- Sign-up funnel drop-off in PostHog between `/login` submit and a completed session.
- The RLS session workflow going red on a push to `main`: treat as a launch blocker, not a routine CI flake, because it is the one currently reliable automated safety net alongside a local `npm run ci`.

---

## 5. Comms

### 5.1 Where users report problems

The site's one public contact address is `CONTACT_EMAIL` in `lib/siteContact.ts`. Read it from that file rather than copying the address into a message; the file is the single place the app itself uses, and it can change without this runbook going stale.

### 5.2 Social moderation rota

Live Social uses the existing admin session and named moderator role for queue
decisions. Check queue access and moderator ownership during each launch
review. The historical
[`SOCIAL_BETA_CONTRACT.md`](social/SOCIAL_BETA_CONTRACT.md) is not a current
launch gate. During `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0`, use static preview only.

---

## 6. V1 invite cohort (map + plan invite + price logging)

V1 is not a Social launch. Invite 15–40 London drinkers you already WhatsApp nights with. Product strategy: [docs/plans/PLG_STRATEGY.md](plans/PLG_STRATEGY.md). Weekly scoreboard detail: [docs/growth/V1_INVITE_SCOREBOARD.md](growth/V1_INVITE_SCOREBOARD.md). Full Horizon 0 merge / promote / smoke / anti-goals checklist: [docs/growth/HORIZON0_OPS_CHECKLIST.md](growth/HORIZON0_OPS_CHECKLIST.md). Seed density playbook: [docs/growth/SEED_BOROUGH_PLAYBOOK.md](growth/SEED_BOROUGH_PLAYBOOK.md).

### 6.1 What you send

One WhatsApp message with:

1. Map link (`https://pubmaxxing.com/map` or `/near`)
2. Optional plan invite for a real upcoming night (`/invite/[token]` from Copy invite link)
3. One-line ask: open the map / RSVP / log a pint if you buy one

### 6.2 Seed density before the blast

Captain + early cohort pre-log corroborated prices in 1–2 boroughs guests will open first (for example Soho + Camden). Grey pins in the first viewport kill trust. Follow [SEED_BOROUGH_PLAYBOOK.md](growth/SEED_BOROUGH_PLAYBOOK.md).

### 6.3 Weekly scoreboard (PostHog)

Instrument already lives in [docs/METRICS_FUNNEL.md](METRICS_FUNNEL.md). Track invite k-factor / RSVP rate, corroborated coverage in seed boroughs, meaningful plan actions (`plan_saved`, `plan_invite_sent`, `plan_invite_link_copied`), return `activity_pulse`, and landing CTA mix (`landing_cta_clicked`). Track Social only for an explicit, consented product question; `PUBMAX_SOCIAL_FRIENDS_LAUNCH=0` provides static preview only.

### 6.4 Done when

At least 10 distinct humans completed a map open and at least 5 RSVPs or price logs in week 1 without paid ads. Seed boroughs must not read as empty grey; invite share should appear on most successful locked plans.

---

## 7. Owner go-live evidence

Do not mark issue #392 complete until each row has a dated link or screenshot from the owning service.

| Gate | Required evidence | Status on 2026-08-23 |
|---|---|---|
| Google Search Console | Verified domain property, submitted `https://pubmaxxing.com/sitemap.xml`, and successful fetch | Owner action |
| Bing Webmaster Tools | Verified site, submitted sitemap, and successful fetch | Owner action |
| Android PWA install | After a second distinct-day visit or a completed Crawl Route, supported Android Chrome emits `beforeinstallprompt`; the PUBMAXX prompt appears and the installed PWA launches from the home screen | Owner action |
| iOS install | Safari Add to Home Screen instructions are accurate and the installed app launches from the home screen | Owner action |
| Demo content | Vercel Production environment shows `NEXT_PUBLIC_DEMO_CONTENT=off`; promoted deployment ID recorded | Owner action |
| Analytics order | PostHog receives release, map open, plan generated, invite opened, invite accepted, crew activation, completion, recap share, and repeat-plan events in that order | Owner action |
| First cohort | Dated result for 10 distinct map opens and 5 RSVPs or price logs, with no paid ads | Owner action |
| Release gate | Exact `main` SHA, local `npm run ci`, RLS, browser smoke, hosted CI state, and promoted deployment ID | In progress |
