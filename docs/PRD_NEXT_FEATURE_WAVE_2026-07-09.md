# PUBMAXXING — Next Feature Wave (Wave K)

Date: 2026-07-09  
Audience: product owner  
Live: [pubmaxxing.com](https://pubmaxxing.com) · Stack: Next.js + Supabase (no Convex)

---

## 1. Current state

PUBMAXXING is a real London pub-crawl product: map planner, curated crawls, route packs, Discover, Pint Drops, ratings, social feed, DMs, and borough pages. Recent ships tightened the map-first loop (featured crawls on the map, route packs → polyline, Pint Drops landing polish, Discover→map wiring + chrome alignment in flight). Security hardening and Outer London coverage are on main. Google and Microsoft sign-in are **coded**; they still need owner dashboard setup before anyone can actually log in. The biggest product gap is no longer “more map features” — it is **turning on real accounts**, then making memories, passport, and social feel owned and trustworthy.

---

## 2. Recommended next wave (ordered)

Opinionated sequence: activate what you already built → finish in-flight social trust → one sticky identity surface → one London discovery bet → then bigger bets later.

| # | Item | Scope | Invasiveness | Risk | Owner dashboard? |
|---|------|-------|--------------|------|------------------|
| K0 | Land Discover→map chrome PR | Small | Low | Low | No |
| K1 | Turn on Google (+ optional Microsoft) sign-in | Small code / medium ops | Low code | Medium (misconfig) | **Yes — required** |
| K2 | Finish Memory Timeline + trusted DMs (Wave I) | Medium | Medium | Medium | Needs K1 live to fully prove |
| K3 | First-sign-in claim: device memories → account | Medium | Medium (API/RLS) | Medium–High | Supabase already; verify RLS |
| K4 | Pint Passport as the profile hero | Medium | Medium (UI + share) | Low–Medium | No |
| K5 | Price freshness + “last seen” honesty | Small–Medium | Low | Low | No (data labels) |
| K6 | Share cards that look good in chat | Medium | Medium (OG/images) | Low–Medium | No |
| K7 | One new London route pack lane (editorial) | Small–Medium | Low | Low | Optional content review |

### K0 — Land the Discover → map chrome PR

**Goal:** Ship the in-flight map chrome / Discover deep-link work so Discover, Crawls, and Map feel like one product.

**Why now:** It is already coded on `cursor/map-chrome-discover-nav-8c7c`. Leaving it open blocks a clean next branch and leaves Discover half-wired on production.

**Scope / components:** Discover editorial hrefs, map toolbar / nav clearance, auth control sizing with map chrome. Pure merge + smoke.

**Dependencies:** None. Do this before starting K2/K3 on a fresh branch from main.

**Acceptance criteria:**
- [ ] Discover CTAs open the map with the intended filters/routes (no dead editorial links).
- [ ] Map chrome cards and phone clearance look intentional; auth control matches 32px chrome.
- [ ] Vercel CI green; quick mobile smoke on Discover → Map → venue sheet.

**Owner work:** Merge/approve PR only.

---

### K1 — Activate real sign-in (Google first)

**Goal:** A visitor can tap **Continue with Google** on pubmaxxing.com and land signed in with a linked profile handle.

**Why now:** Auth UI and callback already exist. Without dashboard enablement, every social trust feature stays demo-grade. Microsoft can follow Google; do not block the wave on Entra.

**Scope / components:** Mostly **owner ops**. Code path: `SignInButton`, `AuthProvider`, `/auth/callback`. Optional: merge Microsoft branch after Google works.

**Dependencies:** K0 preferred (clean main). Public Supabase env vars already required in production.

**Acceptance criteria:**
- [ ] Google OAuth enabled in Supabase; redirect URIs correct for production + localhost.
- [ ] Sign-in → `/auth/callback` → session present; avatar/name in nav; sign-out works.
- [ ] Anonymous browse still works without forcing sign-in.
- [ ] (Optional follow-up) Microsoft/Azure provider enabled the same way.

**Owner work (required):**
1. Google Cloud OAuth client → redirect `https://<project-ref>.supabase.co/auth/v1/callback`
2. Supabase → Authentication → Providers → Google → enable + secrets
3. Supabase URL Configuration: Site URL `https://pubmaxxing.com`, Redirect URLs include `/auth/callback` (prod + local)
4. Later: Entra app registration + Supabase Azure provider (see `docs/DEPLOYMENT.md` on the Microsoft branch)

**Code work:** Smoke test + tiny copy/error polish if redirect fails; merge Microsoft PR when you want Outlook users.

---

### K2 — Memory Timeline + trusted messaging (finish Wave I)

**Goal:** Profiles show a real Spill timeline (same cards as the feed), and DMs/activity require a signed-in, linked account — not a typed handle anyone can impersonate.

**Why now:** Branch `cursor/memory-timeline-social-ux-aec3` already implements most of this. It is the highest-value unfinished social slice and pairs directly with K1.

**Scope / components:** `ProfileTimeline`, feed/profile CSS declutter, `authedFetch`, messages/notifications JWT gates, AuthProvider handle link, demote fake Discover/feed demo lanes.

**Dependencies:** K1 for end-to-end proof. Can merge code before Google is live, but acceptance needs a real session.

**Acceptance criteria:**
- [ ] Profile **Timeline** reuses feed cards for that handle’s drops.
- [ ] “Message” / activity / notification actions require sign-in; unauthenticated users see a clear prompt.
- [ ] Signed-in users cannot act as someone else’s handle.
- [ ] Demo-only feed lanes that do not filter real data are hidden or clearly demoted.
- [ ] Mobile feed does not duplicate the Drop CTA already owned by the tab bar.

**Owner work:** None beyond K1. Approve/merge PR after review.

---

### K3 — Claim your night: first sign-in migrates device memories

**Goal:** Someone who dropped pints or saved pubs before signing in keeps that history on their account after Google login.

**Why now:** Without this, turning auth on creates a cliff — early users feel punished for signing in. Ownership gates already exist in stores; the missing product moment is the **claim / migrate** flow.

**Scope / components:** Profile link on first auth (`profiles.user_id`), migrate local/device handle drops/saves/follows where safe, one clear “This is your account now” confirmation, refuse re-linking a handle owned by someone else.

**Dependencies:** K1 + K2 (trusted actor model). Supabase migrations for `profiles.user_id` already exist — verify, do not reinvent.

**Acceptance criteria:**
- [ ] First successful sign-in links or creates a profile for the auth user.
- [ ] Prior device-handle Pint Drops / saves that are unclaimed attach to the account when safe.
- [ ] Conflict case (handle already owned) shows an honest choice — never silent overwrite.
- [ ] After claim, edit/delete/message paths use the account, not a free-typed handle.

**Owner work:** Spot-check one real account in Supabase Table Editor after first production sign-in; confirm RLS advisors still clean.

---

### K4 — Pint Passport as the profile hero

**Goal:** Opening `/u/you` (or your handle) immediately shows a collectible passport: pubs, boroughs, crawls, badges, next quest — not a sparse grid.

**Why now:** Passport math (`lib/passport.ts`, badges, quest chips) already exists. Making it the hero turns logging and crawling into identity, which is the stickiness loop after auth.

**Scope / components:** Profile header / passport card, badge shelf, next-badge chips, share/copy passport link. Prefer existing DESIGN_SYSTEM; no new backend platform.

**Dependencies:** Stronger with K2/K3 (real owned history). Can ship a visual pass earlier on demo data, but recommend after claim.

**Acceptance criteria:**
- [ ] Passport is the first thing you see on your profile (hero-level, not a buried tab).
- [ ] Stats and badges match computed passport data; empty state invites “Drop a pint” / “Open the map”.
- [ ] Share link opens a readable public passport view for that handle.
- [ ] Works on phone one-thumb scroll; no dashboard-of-widgets clutter.

**Owner work:** None.

---

### K5 — Price freshness honesty everywhere prices show

**Goal:** Every pint price on map pins, venue sheet, and Discover says how fresh it is (or that it is baseline/seeded), so the product never feels like fake live data.

**Why now:** Trust is the brand. Contributor Pint Drops already carry timestamps; the map still often reads as “the price” without age. Small scope, high credibility.

**Scope / components:** Venue sheet price stamp, map/tooltip or sheet “Updated …”, Discover/leaderboard honesty, keep Demo/Sourced/Contributor provenance chips.

**Dependencies:** None. Complements K1–K4; does not block them.

**Acceptance criteria:**
- [ ] Venue sheet shows last observed / contributor update when available.
- [ ] Seeded or stale baseline prices never claim to be “live tonight”.
- [ ] Demo content keeps the Demo label.
- [ ] No scraping competitor sites; only existing contributor + curated sources.

**Owner work:** None (unless you later approve a scheduled price-refresh agent — deferred).

---

### K6 — Share cards that look good in iMessage / WhatsApp / X

**Goal:** Sharing a crawl, Pint Drop, or passport produces a rich preview people want to tap.

**Why now:** Share URLs and crawl-complete copy links exist; previews are still uneven. Growth for a London night-out app is chat-native.

**Scope / components:** Open Graph images/metadata for `/map` crawl links, `/p/[id]` drops, `/u/[handle]` passport; fix known OG domain typos; keep share actions on celebration + feed.

**Dependencies:** Best after K4 (passport worth sharing) and K0 (stable map URLs).

**Acceptance criteria:**
- [ ] Shared crawl link shows title + London/pub vibe image (not a blank or wrong domain).
- [ ] Pint Drop permalink preview includes photo when public/visible.
- [ ] Passport share preview shows handle + a short stats line.
- [ ] Private / ledger-only / hidden content never leaks into previews.

**Owner work:** None. Optional: brand-check one preview in iMessage.

---

### K7 — One editorial “London night” route-pack expansion

**Goal:** Add **one** new curated lane people can open from Crawls/Discover straight onto the map (e.g. late-train friendly, writers’ London, or Thames walk) — not a dozen half-finished themes.

**Why now:** Route packs → map already shipped. Content is the cheapest way to make the map feel alive for tourists and locals without more platform code.

**Scope / components:** Curated crawl JSON / route pack entry, Discover or Crawls card, map deep-link with polyline, provenance labels on editorial picks.

**Dependencies:** K0 (Discover→map wiring). Editorial judgment from you.

**Acceptance criteria:**
- [ ] New pack appears in Crawls (and Discover if that lane exists).
- [ ] Tap opens map with the lead crawl drawn; stops are real venues with provenance.
- [ ] Thin Outer London honesty rules still apply — no invented pubs.
- [ ] Mobile one-thumb path: pack → map → venue → Drop / Last Train.

**Owner work:** Approve the theme and skim the pub list for “would I actually walk this?”

---

## 3. Explicitly deferred / later bets

Do **not** pull these into Wave K:

| Deferred | Why wait |
|----------|----------|
| Convex or any second backend | Stay on Supabase; avoid dual-write chaos |
| Area busyness / live heatmap | Needs privacy design + signal; not core loop |
| Full food menus / live Wetherspoons scraper | Governance + maintenance cost; cuisine tags enough for now |
| Group chat / encrypted DMs / Round crew live presence | Auth ownership must settle first; current 1:1 DMs are enough |
| Turn-by-turn navigation / taxi | Wrong product; walking time labels are enough |
| Native apps / payments / pub-owner dashboards | Premature |
| Multi-city | London loop must be excellent first |
| View Transitions / heavy map scene-graph growth | Polish after identity + share |
| Scheduled price-refresh agent | Only after K5 honesty labels; ToS-safe sources only |
| Remounting Legacy “T” / Lock-In ledger modes | Explicitly out of product direction |

---

## 4. Suggested first PR after this plan

**PR title (suggested):** `chore: land Discover→map chrome; start Wave K`

**Do this first:**
1. Merge / finish `cursor/map-chrome-discover-nav-8c7c` (K0) onto main.
2. Open a **tiny** follow-up PR only if needed: production smoke checklist for Google sign-in + link to the owner dashboard steps in `docs/DEPLOYMENT.md` (K1 activation doc, no feature sprawl).

**Then immediately:**
3. Rebase and ship Wave I (`memory-timeline-social-ux`) as the first real feature PR of the wave (K2), once Google works in production or preview.

Do **not** start Passport polish or share-card art until K1–K3 are real — otherwise you decorate an identity system nobody can own.

---

## Owner checklist (dashboard vs code)

| You (dashboard / judgment) | Agents (code) |
|----------------------------|---------------|
| Enable Google (then Microsoft) in Supabase + IdP consoles | Merge K0; finish Wave I; claim/migrate; Passport UI; freshness stamps; OG cards; one route pack |
| Approve Entra app settings when you want Outlook | Keep Supabase-only; no Convex |
| Pick / approve the K7 crawl theme | Keep PRs narrow; Vercel as deploy gate |
| Spot-check first real linked profile in Supabase | Preserve provenance + demo labels |

---

## Success for this wave

When Wave K is done, a new visitor can: open Discover → land on a crawl on the map → walk it → drop a pint → sign in with Google → keep that night on a passport they can share — without the app lying about prices, handles, or private messages.
