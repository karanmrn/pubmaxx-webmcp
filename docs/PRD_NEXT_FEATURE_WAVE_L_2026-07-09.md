# PUBMAXXING — Next Feature Wave (Wave L)

Date: 2026-07-09  
Audience: product owner  
Live: [pubmaxxing.com](https://pubmaxxing.com) · Stack: Next.js + Supabase (no Convex)  
Supersedes: `docs/PRD_NEXT_FEATURE_WAVE_2026-07-09.md` (Wave K) where that plan is stale

---

## 1. Current state

PUBMAXXING is a live London pub-crawl product: map planner, curated crawls, route packs, Discover, Pint Drops, ratings, feed, DMs, borough pages, Outer London coverage, and security hardening.

**Just landed on main**
- Wave I — Memory Timeline + trusted DMs (#71)
- Security / review leftovers (#81, #84, #90)
- Map-first crawls & route packs, Pint Drops landing polish, landing contrast

**Coded but not fully live**
- Google OAuth UI + callback (needs your Supabase / Google Cloud enablement)
- Microsoft / Azure OAuth — open PR #87 (needs Entra + Supabase Azure after Google works)
- Discover → map chrome — open PR #89
- Instant Spill / warm venue cache / passport share polish — open PR #88
- Dark map streets + mobile Drop/sheet polish — open PR #92

**Strategic gap:** the map loop is strong; identity is still demo-grade until someone can actually sign in, claim their night, and share a passport that is theirs. Do **not** expand to multi-city (#91) until London identity + share are real.

---

## 2. Recommended next wave (ordered)

Opinionated sequence: land open polish → **you turn on Google** → claim memories → passport + share → honesty + one new crawl. Scope is technical, not calendar.

| # | Item | Scope | Invasiveness | Risk | Owner dashboard? |
|---|------|-------|--------------|------|------------------|
| L0 | Merge open polish PRs (#89, #92, then #88) | Small–Medium | Low | Low | Approve / merge |
| L1 | Turn on **Google** sign-in in production | Small code / medium ops | Low code | Medium (misconfig) | **Yes — required** |
| L2 | Merge Microsoft OAuth (#87) after Google works | Small | Low | Low | Entra + Azure provider |
| L3 | First-sign-in **claim**: device memories → account | Medium | Medium (API / ownership) | Medium–High | Spot-check one linked profile |
| L4 | Pint Passport as profile hero + share | Medium | Medium (UI + OG) | Low–Medium | Brand-check one share preview |
| L5 | Price freshness honesty everywhere | Small–Medium | Low | Low | No |
| L6 | Chat-native share cards (crawl / drop / passport) | Medium | Medium (OG) | Low–Medium | Optional iMessage check |
| L7 | One new editorial London route pack | Small–Medium | Low | Low | Approve theme + pub list |

### L0 — Land the open polish PRs

**Goal:** Clear the runway so main has Discover→map, dark-map readability, and the feel/passport share work already coded.

**Why now:** These PRs are already open. Leaving them draft blocks a clean identity wave and leaves Discover / dark mode half-finished on production.

**Merge order (suggested):**
1. [#89](https://github.com/karanmrn/pubmax/pull/89) — Align map chrome + Discover taps open map routes  
2. [#92](https://github.com/karanmrn/pubmax/pull/92) — Dark map streets + mobile Drop/sheet polish  
3. [#88](https://github.com/karanmrn/pubmax/pull/88) — Instant Spill, warm venue cache, passport share (rebase if needed after #89/#92)

**Acceptance criteria:**
- [ ] Discover editorial / pub rows open `/map` with venue select or crawl polyline
- [ ] Phone Home + Search bars align; dark basemap streets readable
- [ ] Spill composer closes immediately; venue sheet feels warm after prefetch
- [ ] Vercel CI green on each merge

**Owner work:** Review + merge. No dashboard.

---

### L1 — Activate Google sign-in (production)

**Goal:** Tap **Continue with Google** on pubmaxxing.com → land signed in with session + avatar; anonymous browse still works.

**Why now:** Auth UI and `/auth/callback` already exist. Memory Timeline and trusted DMs are on main but stay demo-grade until a real JWT exists. This is the single highest-leverage owner action in the wave.

**Scope:** Mostly **your dashboard**. Tiny code polish only if redirect errors need clearer copy.

**Acceptance criteria:**
- [ ] Google provider enabled in Supabase with correct client ID/secret
- [ ] Redirect URI includes `https://iankajxliutqogqkmvdg.supabase.co/auth/v1/callback`
- [ ] Site URL `https://pubmaxxing.com`; Redirect URLs include `/auth/callback` (+ localhost)
- [ ] Sign-in → callback → session; sign-out works; no forced wall for anonymous users

**Owner work (required):**
1. Google Cloud → OAuth Web client → Supabase callback URI  
2. Supabase → Authentication → Providers → Google → Enable  
3. Supabase → URL Configuration → Site URL + Redirect URLs  
4. Smoke on production (or a preview with the same Supabase project)

---

### L2 — Microsoft / Outlook sign-in (optional, after Google)

**Goal:** Same flow for Microsoft accounts via Supabase `azure` provider.

**Why now:** Code is ready in [#87](https://github.com/karanmrn/pubmax/pull/87). Do not block L1/L3 on Entra — ship Google first, then Outlook.

**Acceptance criteria:**
- [ ] #87 merged  
- [ ] Entra app: personal + org accounts; Web redirect = Supabase `/auth/v1/callback`  
- [ ] Graph delegated: `openid`, `profile`, `email`, `User.Read`; optional claims `email` + `xms_edov`  
- [ ] Supabase Azure provider enabled; Microsoft button completes sign-in  

**Owner work:** Entra + Supabase Azure (see `docs/DEPLOYMENT.md` on that branch).

---

### L3 — Claim your night (first sign-in migration)

**Goal:** Someone who dropped pints or saved pubs before signing in keeps that history on their account after Google login.

**Why now:** Turning auth on without claim creates a cliff — early users feel punished. Ownership gates and `profiles.user_id` migrations already exist; the missing product moment is the **claim / migrate** confirmation.

**Scope / components:** Link profile on first auth; migrate unclaimed device-handle drops/saves/follows when safe; honest conflict UX if the handle is already owned; after claim, private writes use the account (not a free-typed handle).

**Dependencies:** L1 (real sessions). Builds on Wave I trust model already on main.

**Acceptance criteria:**
- [ ] First successful sign-in links or creates a profile for the auth user  
- [ ] Prior unclaimed device-handle Pint Drops / saves attach when safe  
- [ ] Handle-already-owned shows a clear choice — never silent overwrite  
- [ ] Edit / delete / message paths use the linked account after claim  

**Owner work:** Spot-check one real linked row in Supabase Table Editor after first production sign-in.

---

### L4 — Pint Passport as the profile hero

**Goal:** Opening `/u/you` immediately shows a collectible passport (pubs, boroughs, crawls, badges, next quest) — not a sparse grid.

**Why now:** Passport math and much of #88’s share surface already exist. After claim, the passport becomes the reason to come back after one crawl.

**Scope / components:** Profile hero layout, badge shelf, next-badge chips, share/copy passport link, public readable view. Prefer existing design system; no new backend platform.

**Dependencies:** Stronger after L3. Visual pass can land with #88; treat “owned history” as the real acceptance bar.

**Acceptance criteria:**
- [ ] Passport is the first thing on your own profile (hero-level)  
- [ ] Stats/badges match computed data; empty state invites Drop / Open the map  
- [ ] Share link opens a readable public passport for that handle  
- [ ] Phone one-thumb scroll; no dashboard-of-widgets clutter  

**Owner work:** None required (optional brand check of share preview).

---

### L5 — Price freshness honesty

**Goal:** Every price on map, venue sheet, and Discover says how fresh it is (or that it is baseline/seeded). Never imply fake “live tonight” data.

**Why now:** Trust is the brand. Contributor drops already carry timestamps; UI still often reads as “the price” without age. Small scope, high credibility; does not block L1–L4.

**Acceptance criteria:**
- [ ] Venue sheet shows last observed / contributor update when available  
- [ ] Seeded or stale baselines never claim to be live tonight  
- [ ] Demo content keeps the Demo label  
- [ ] No competitor scraping — existing contributor + curated sources only  

**Owner work:** None.

---

### L6 — Share cards that look good in chat

**Goal:** Sharing a crawl, Pint Drop, or passport produces a rich preview people want to tap in iMessage / WhatsApp / X.

**Why now:** Share URLs exist; previews are uneven. Growth for a Friday-night London app is chat-native. Best after L4 (passport worth sharing) and L0 (stable map URLs).

**Acceptance criteria:**
- [ ] Shared crawl link shows title + London/pub vibe (correct domain)  
- [ ] Public Pint Drop permalink preview includes photo when visible  
- [ ] Passport share preview shows handle + short stats line  
- [ ] Private / ledger-only / hidden content never leaks into OG  

**Owner work:** Optional — open one link in iMessage and confirm the card.

---

### L7 — One new editorial “London night” route pack

**Goal:** Add **one** new curated lane (e.g. late-train friendly, writers’ London, or Thames walk) that opens from Crawls/Discover straight onto the map with a polyline.

**Why now:** Route packs → map already shipped. Content is the cheapest way to make the map feel alive without more platform code. Do this after Discover→map (#89) is on main.

**Acceptance criteria:**
- [ ] New pack appears in Crawls (and Discover if that lane exists)  
- [ ] Tap opens map with lead crawl drawn; stops are real venues with provenance  
- [ ] Outer London honesty rules still apply — no invented pubs  
- [ ] Mobile path: pack → map → venue → Drop / Last Train  

**Owner work:** Approve the theme and skim the pub list for “would I actually walk this?”

---

## 3. Explicitly deferred / later bets

Do **not** pull these into Wave L:

| Deferred | Why wait |
|----------|----------|
| **UK multi-city (#91)** | London identity + share must be excellent first; multi-city dilutes focus |
| Convex / second backend | Stay on Supabase; avoid dual-write chaos |
| Area busyness / live heatmap | Needs privacy design + signal; not core loop |
| Full food menus / live scrapers | Governance + maintenance; cuisine tags enough |
| Group chat / encrypted DMs | Auth ownership must settle; 1:1 DMs are enough |
| Turn-by-turn / taxi | Wrong product; walking time labels are enough |
| Native apps / payments / pub-owner dashboards | Premature |
| Scheduled price-refresh agent | Only after L5 honesty labels; ToS-safe sources only |
| Remounting Legacy “T” / Lock-In ledger modes | Out of product direction |

---

## 4. What to do next (concrete)

**This week’s order of operations**

1. **You merge** #89 → #92 → #88 (L0) when CI is green.  
2. **You enable Google** in Google Cloud + Supabase (L1) — checklist above.  
3. **Agents ship** L3 claim/migrate as the first new feature PR after L1 works in prod or preview.  
4. **Then** L4 passport hero (finish what #88 started) → L5 freshness → L6 OG cards → L7 one route pack.  
5. **Microsoft (#87)** whenever you want Outlook — after Google is proven.

**Do not start:** multi-city, heatmap, or more map spectacle before L1–L3.

---

## Owner checklist (dashboard vs code)

| You | Agents |
|-----|--------|
| Merge L0 polish PRs | Rebase/fix conflicts on #88/#89/#92 if needed |
| Enable Google (then Microsoft) | L3 claim/migrate flow |
| Spot-check first linked profile in Supabase | L4–L6 passport + freshness + OG |
| Approve L7 crawl theme + pub list | One curated pack + map deep-link |
| Keep #91 multi-city closed / deferred | Stay Supabase-only; no Convex |

---

## Success for this wave

When Wave L is done, a visitor can: open Discover → land on a crawl on the map → walk it → drop a pint → **sign in with Google** → **keep that night** on a **passport they can share** — without the app lying about prices, handles, or private messages. London stays the product; multi-city waits.
