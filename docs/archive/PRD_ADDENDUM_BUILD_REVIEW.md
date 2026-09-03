# PubMaxing — Build Review & Defect Triage (Addendum for Fable)

> **Superseded** — see docs/PRD_PUBMAXXING_SOCIAL_MEMORY_LAYER.md and cc_plan.md. Historical context; current state also lives in teach.md.

> Companion to `PRD_FINAL_FOR_FABLE.md`. That doc is the *vision + roadmap*. This doc is the *verified state of the build* and the *ranked pain-point list* as of the handoff. Where the two disagree, this one is newer.
>
> **Snapshot:** 2026-07-04, ~14:50 BST, branch `prd-implementation-review`, HEAD `3a17f18` + a large uncommitted working tree. **This was reviewed by five parallel opus agents** (map / seeds / backend-security / Landlord / build-verification) plus a live green-tree run.
>
> ⚠️ **The tree is moving under us.** A co-developer (codex) is committing in real time. During this very review the test suite went from `77 tests, 1 red` → `87 tests, all green`, and a missing seed test was added mid-review. Treat *transient* findings below (a red test, a missing test) as possibly-already-fixed. The findings that matter for a design handoff are the **architectural / spec-level** ones — those do not self-heal from "make tests pass" commits, and every one flagged **CONFIRMED-LIVE** was re-verified against the current file, not the snapshot the agent read.

---

## 1. What changed since the PRD — the roadmap got built

The `PRD_FINAL_FOR_FABLE.md` roadmap was largely *implemented* between writing it and this review. Verified present and working:

| PRD item | Status | Evidence |
|---|---|---|
| **P0.1** Seed 8–12 demo Pint Drops | ✅ **DONE** | `lib/pintDropSeeds.ts` — 11 seeds / 8 curated pubs, all `provenance:"demo"`; IDs hash-verified against the real dataset |
| **P0.2** Fix `hasStory` overfire | ✅ **DONE** | `lib/venues.ts:245` — gated on non-empty note; demo drops filtered out of *both* price and story signals |
| **P0.3** Landing honesty | ✅ **MOSTLY** | `£1.99`, "mapped", `Example` badges done; residual "Logged" on labelled sample cards |
| **P1.4** Rebuild map (3-D/orbit/buildings/sky/fly-to/pins/clusters) | ✅ **7 of 8** | `components/PubMapCanvas.tsx` (+642) — see §3 |
| **P1.5** Surface story on map load | ❌ **MISSING** | Map opens neutral; no hero/heritage teaser |
| **P3.9** Durable rate limiting | ✅ **DONE** | `supabase/migrations/0003_rate_limits.sql` + `lib/supabase.ts` RPC — durable, salted-hashed IP, atomic, deny-all RLS |
| **P3.10** Landlord LLM bounds | ✅ **DONE** | `lib/heritage.ts` — `temperature:0`, 10s `AbortController` timeout, `max_tokens:400`, phantom fact-id → fail-closed |
| **P2.6** Decompose `PubMap.tsx` | ❌ **OPEN** | Still one large file |
| **P2.7** Unify the two backends | ❌ **OPEN** | Still branches on `isSupabaseConfigured()`; this diff *added* a 3rd branch point |
| **P2.8** Delete dead code / gitignore `.context/` | ⚠️ **PARTIAL** | eslint ignores `.context/**` but `.gitignore` still doesn't |

**Verified green:** `eslint` clean (2 `<img>` warnings), `tsc --noEmit` clean, `vitest run` **87/87**.
**Verified live earlier this session:** Supabase writes/reads, public photo bucket, service-role writes, RLS public-read.

**Bottom line:** this is no longer "a planner with a roadmap." The differentiators — the rotating 3-D map, the live community layer (seeded), the truth-grounded Landlord, durable abuse limits — are *built*. What remains is **polish, three real bugs, and one spec gap**, not net-new construction.

---

## 2. Defect & gap triage (ranked, with owner)

Owner tag: **[Fable]** = design/experience work · **[Eng]** = engineering hardening before public UGC. Each is re-verified against the current tree.

### 🔴 CRITICAL

**C1 · Map crashes on theme toggle — unguarded `addLayer` [Fable-visible / Eng-fix] · CONFIRMED-LIVE**
`components/PubMapCanvas.tsx` — `buildScene` runs on every `style.load` (fires on every theme switch). *Sources* are guarded (`if (!map.getSource)`); the ~10 **layers are added unconditionally** (lines 320–510, no `if (!map.getLayer)`). Second pass → `addLayer` throws *"Layer with id X already exists"*, which propagates out of a MapLibre-internal event dispatch (React can't catch it) and **aborts the rest of `buildScene`** → half-styled map, buildings/pins/landmarks silently gone until full reload.
*Why it matters for Fable specifically:* a design studio's first instinct is to rapid-toggle light/dark to judge the palette. This throws on the second click, in front of them.
*Fix (one line per layer):* wrap each `addLayer` in `if (!map.getLayer("id"))` — the guard pattern **already exists** in this same function for `buildings-3d`; it's just inconsistently applied.

### 🟠 HIGH

**H1 · No WebGL-failure fallback [Eng] · CONFIRMED-LIVE**
`PubMapCanvas.tsx:280` — `new maplibregl.Map({...})` has **no `try/catch`**. On any no-WebGL environment (headless demo box, locked-down corporate Chrome, some Safari, screenshot CI) it throws synchronously in the effect → whole map area blank-screens with no message. The londonszn reference *already solved this* (`.context/londonszn/.../MapLibreMap.tsx:151-163` renders "Map renderer unavailable"); the rebuild dropped it. Port the fallback back.

**H2 · Landmark card doesn't clear on venue/route select [Fable] · CONFIRMED-LIVE**
`PubMapCanvas.tsx:264-267,676-687` — open a landmark's history card, then click a pub pin: camera flies to the pub while the landmark card stays pinned over it, now describing a place off-screen. Call `selectLandmark(null)` in the venue/route-stop handlers.

**H3 · Rate limiter fails *open*, silently [Eng] · CONFIRMED**
`lib/supabase.ts:44-49` + `app/api/pint-drops/route.ts:84-93` — when the durable RPC errors/times out (Supabase outage, or migration 0003 not applied), it returns `null` and the route silently reverts to the **in-memory per-process** limiter — the exact thing P3.9 replaced. On Vercel each cold-start instance gets a fresh budget → limiter is near-useless precisely during an outage, with **no log or metric** that the downgrade happened. Either add logging/alerting on every `null` verdict, or return 503 when Supabase is configured-but-unreachable. Also: label it **fail-open, not fail-safe**, in the launch checklist.

**H4 · Report-count increment is a read-then-write race [Eng] · CONFIRMED**
`lib/pintDropsStore.ts:210-230` — two concurrent reports read `report_count=n`, both write `n+1`, one lost. One-line fix: `UPDATE ... SET report_count = report_count + 1 RETURNING report_count` (Postgres per-row UPDATE is atomic; the bug is doing the read as a separate statement). Not a new RPC.

**H5 · Landmarks are a parallel Wikipedia widget, not wired to heritage [Fable + Eng] · SPEC GAP · CONFIRMED-LIVE**
PRD target #6 asks that tapping a landmark tie "directly into The Landlord + `pub_heritage`." As built, `lib/landmarks.ts` is a **fully separate static list** with its own card UI, disconnected from `lib/curation.ts` / `LandlordPanel` / any nearby pub. Tapping Big Ben shows a standalone paragraph unrelated to any crawl or pub. **This is the single biggest shipped-vs-spec divergence** — and it's the one that makes the map "teach you London" instead of being a pretty pin layer. Design + eng job: landmark tap → nearby heritage pubs + a Landlord teaser.

### 🟡 MEDIUM

- **M1 · `x-forwarded-for` spoofable [Eng]** — `route.ts:76-82` trusts the header with no proxy allowlist; anyone can set it per-request for a fresh rate-limit key. Vercel's edge normalizes it, but nothing in the repo documents that dependency. Document the trust boundary or treat IP as a secondary signal only.
- **M2 · `ADMIN_TOKEN` not constant-time [Eng]** — `route.ts:63` plain `===` (timing side-channel) guards the entire moderator surface. One-liner: `crypto.timingSafeEqual`.
- **M3 · `ADMIN_TOKEN` unset opens moderation on any non-`production` env [Eng]** — dev-open/prod-closed keys on `NODE_ENV`. A public Vercel *preview* URL without `NODE_ENV=production` → moderation endpoints wide open. Verify every reachable env sets it.
- **M4 · Two Pint-Drop backends still not unified [Eng]** — P2.7 open; this diff added a 3rd `isSupabaseConfigured()` branch. Collapse behind one store interface before it grows further.
- **M5 · No hero/story teaser on map load [Fable]** — PRD P1.5; map opens neutral, nothing signals "this map has soul" before the user clicks.
- **M6 · No map smoke/E2E test [Eng]** — PRD asks for "map-render nonblank + orbit + fly-to smoke"; none exists. No Playwright over `/`, `/map`, composer, report, theme.

### 🟢 LOW (do before handoff, all trivial)

- **L1 · Doc drift** — `PRD_FINAL_FOR_FABLE.md:34` says "63 tests"; actual is 87. *(Fixed in this pass.)*
- **L2 · Landing residual "Logged"** — sample cards (`LandingPage.tsx:75,81,200`) still say "Logged"; they're `Example`-tagged so low, but swap to "mapped/added" for consistency.
- **L3 · `.gitignore` still doesn't exclude `.context/`** — eslint ignores it but git doesn't (a 989-line reference map lives there).
- **L4 · Seed sort order** — demo seeds `.concat` after organic drops unsorted by `createdAt`; cosmetic in any "recent activity" feed.
- **L5 · `hasStory` / `mergeVenueDrops` has no dedicated regression test** — the literal P0 bug this work fixed isn't pinned by a test (though `pintDropSeeds.test.ts` now exists for the IDs).

---

## 3. The map, in detail (the centrepiece — mostly a win)

**Built and verified working (7 of 8 PRD targets):** 3-D pitch on load (`pitch:45,bearing:-15,zoom:10.5`) · slow idle orbit that pauses on interaction, resumes on idle, respects `prefers-reduced-motion` **and** pauses on `document.hidden` (better than the londonszn reference, which does neither) · 3-D `fill-extrusion` buildings · `setSky` + fog · cinematic `easeTo` fly-to with brass selection ring · animated brass route dash · custom price-coloured clustered pins with story stroke + drops halo (no per-listing React markers — correct perf) · fully token-driven light/dark rebuild · **complete unmount teardown** (RAF cancelled, observers disconnected, `map.remove()`).

**The gaps are C1, H1, H2, H5 above** — three fixable bugs and one spec-wiring job. Fix C1 first; it's the one that fails in front of the client.

---

## 4. The demo deck needs regenerating (`PubMaxing_Final_Demo.pptx`)

The deck is a **580 KB binary committed to git** (un-diffable, un-reviewable) and it is **stale — it undersells the product**, the opposite failure from the landing page's old overclaiming:

| Slide | Says | Reality | Rewrite |
|---|---|---|---|
| S5 | "photo UI is the **next completion step**" | Photo composer + thumbnails + report **shipped** (`5e1605f`) | "Photo upload, thumbnails & report flow are **live**." |
| S6 | Moderation "**Next ship slice**: hidden queue, restore…" | `/admin` console + restore/keep-hidden **shipped** (`ecdf58e`) | Move to "shipped"; use the slide for the 3-D map. |
| S4 | "community Pint Drops" | They're **seeded demo** data (correctly badged in-app) | "…a handful of clearly-labelled **example** Pint Drops; real community activates at launch." |
| S4 | "**Writer Trail**" | Flagged **dead code to delete** | Remove the mention. |
| S3 | "prices **logged**" implication | Baseline is **mapped**, not community-logged | Use "mapped" to match the landing fix. |
| S6 | "…acknowledged into **process memory**" | Internal agent-harness jargon | Delete — not client-facing. |

**Recommendation:** regenerate the deck from `PRD_FINAL_FOR_FABLE.md` §"Current state" (the accurate source of truth), lead with the 3-D map, and **check in a markdown version** so it's diffable. Keep the `.pptx` as a build artifact, not a source-of-truth in git.

---

## 5. What Fable should own next (design priorities, in order)

1. **Make the map unforgettable, then bulletproof.** The engine is built and good. Fix **C1** (toggle crash) and **H1** (WebGL fallback) so it survives their own hands-on review, then apply craft: pin design, landmark glyphs, the brass route, the fly-to easing curve, the two-mood palette. This is where a design studio adds the most value.
2. **Wire landmarks into story (H5).** Turn the parallel Wikipedia widget into "tap a landmark → the heritage pubs near it + a Landlord teaser." This is what makes the map *teach London*, not just decorate it.
3. **The story on first paint (M5 / P1.5).** One hero heritage venue or Landlord teaser on map load, so the soul survives the click from the landing page.
4. **Regenerate the deck** (§4) — accurate, map-led, diffable.
5. **Honest copy sweep** — clear L2, keep every seeded/example surface visibly labelled.

## 6. Engineering hardening backlog (not Fable's job, but gates public UGC)

H3 (fail-open + logging) · H4 (report-count race) · M1 (XFF trust) · M2 (constant-time token) · M3 (`NODE_ENV` on previews) · M4 (unify backends, P2.7) · M6 (Playwright/E2E + map smoke) · P2.6 (decompose `PubMap.tsx`) · P3.12 (stable venue-id alias table before any dataset re-geocode — the seed IDs silently break if the dataset is re-exported).

---

## 7. The one-paragraph status for the Fable kickoff

> PubMaxing is past prototype. The rotating 3-D London map is built and, bugs aside, genuinely good; the community layer is live (seeded, honestly labelled); The Landlord narrates real history and refuses to invent it, with production LLM bounds; abuse limits are durable in Postgres; 87 tests pass. What's left is **craft and three bugs**: one theme-toggle crash to guard, one blank-screen fallback to restore, and one spec wire-up (landmarks → heritage) that turns the map from pretty into *teaching*. Fix those, regenerate the deck honestly, and this is a demo that opens with London turning under you and every claim — price and past — carrying its receipts.
