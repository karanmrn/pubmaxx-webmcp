# CodexSolPlan — PUBMAXX handoff to the Codex (gpt-5.6-sol) primary
Written 2026-08-27 ~11:15 BST by the outgoing Claude firstmate. Covers 2026-08-25 → 2026-08-27.
Captain: Karan (address as Captain). Product: PUBMAXX app / pubmaxxing.com. Repo: github.com/Singularityszn/pubmax. Fleet home: ~/karan-agent-workspace.

## 0. North star (captain's words)
"Payments with live data for entire London, covering all the places with history, lore, social media, a working V0 with no bugs along with all features from Lets Discover app."
Priority order: (1) live-data coverage → (2) lore/social per place → (3) bug-free V0 (audit clear + QA + zero console errors + pixel pass) → (4) Lets-Discover parity → (5) payments (A affiliate ticket hand-off → B round-split Stripe → C tabs).
NEW standing law (2026-08-27): **"speed should be our defining factor."**
Vision framing: one-stop app for touching grass and making memories; list everything from all apps, then build partnerships with those apps/sites.

## 1. Production vs main — DEPLOY IS THE #1 PENDING ACTION
- Production (Vercel project **chengdu**, team pubmax69, pubmaxxing.com) last deployed **2026-08-25 morning**.
- Merged since, **UNDEPLOYED (8 PRs)**: #1207, #1209, #1210, #1212, #1213, #1214, #1215, #1216.
- Deploy rules: captain word ONLY ("deploy" or naming Vercel), max once/day, end of day, from the GitHub main SHA, phone (390x844) + desktop screenshots BEFORE deploying. A bare "Go" is not deploy authority.
- Deploy method: clean worktree at origin/main, copy in `.vercel/project.json` (projectId prj_FAC09rdCxDiGujUHeDOeZ04JLymc, orgId team_ZHYOvhX8M0Gxyq4J3XOgOwmF), `npx -y vercel@latest deploy --prod --yes`. CLI auth exists on this Mac (karanmrn).
- Build gate: `assertCurrentFamousVenueRows` in scripts/build_slim_index.mjs fails the build when famous-venue 30-day verification windows lapse. Re-verified 2026-08-25 (#1202) — safe for ~30 days. Never hand-bump dates; re-verify honestly.

## 2. PRs merged in the last 3 days (all on main)
Aug 25 (led to the morning deploy + afternoon merges):
- **#1198** venue-rating removal, **#1199** offline copy dedupe, **#1200** "Tonight is pubs" v0 bar (venue-match gate, honest counts), **#1201** wikidata artifact, **#1202** famous-venue re-verification (real fetches; unblocked deploy).
- **#1207** Plan never destroys intent (chips fill empty fields only; Lock-it-in enables; 4 TS errors caught by honest local typecheck).
- **#1209** Circuit-robin mascot default on /pal onboarding.
- **#1210** Mobile map first-paint + control layout fixes (invisible button fixed).
Aug 26:
- **#1212** Signature map style: neon-noir night / warm-paper day palettes, pub-first label hierarchy, palette-only (hero glow + confidence rings REMOVED for paint budget; tests assert their ABSENCE — do not re-add). Fixed barber-as-pub matcher + neighbourhood tier before merge.
- **#1208** UK harvest machinery (OSM enumerate + Exa enrich, resumable shards, citations); all 17 bot threads fixed.
Aug 26 night → Aug 27:
- **#1213** The **Beermat Drop** venue reveal: 4-beat entrance (<=480ms, transform/opacity only), Drop motion ONLY for corroborated in-window figures (provisional slides flat, unknown static — motion grammar = trust tier), repeat-tap decay (>=8s full, else 160ms), interrupt-to-rest, reduced-motion instant, price FIGURE never animates (unit-pinned). 12,046 tests, 80.03% coverage.
- **#1214** Map bundle diet: eager /map JS 3700→3066KB (−634KB; citymcp, crawls, auth, personas, city catalogs, sheets deferred), **pin-ready 9,800ms → 3,999ms** throttled 390x844, Clerk lazy-load with proven paint-before-auth fix.
- **#1215** Exa fail-loud fence: fatal API errors (401/402/NO_MORE_CREDITS) rethrow instead of writing empty rows.
- **#1216** Pal cards open venues: PalChat openVenue navigates to /map with venue selected (was analytics-only stub), unmatched fallback, 3 bot majors fixed (nested anchor, shard coverage status, partial-payload caching).
Declined by captain: #1196 (Blacksmith CI — secrets on third-party VMs), #1191 (Wanteds rework).

## 3. Merge procedure (until Actions billing is fixed)
GitHub Actions billing is DEAD ("recent account payments have failed") → every check fails in ~2s repo-wide. House rule: **local verify is the green bar; GitHub reds are environment-not-code**. Standard: bot review threads must be 0 unresolved (fix real ones, reply+resolve stale ones), no-mistakes run passed, then:
`gh api -X DELETE repos/Singularityszn/pubmax/branches/main/protection/enforce_admins && gh pr merge N --squash --admin && gh api -X POST repos/Singularityszn/pubmax/branches/main/protection/enforce_admins` (verify `.enabled==true` after). yolo is ON for pubmax (standing captain grant): merge green in-scope work autonomously; NEVER merge red local verify; destructive/irreversible still escalate.

## 4. The UK harvest campaign (data spine for the north star)
- **Pubs: 38,215/38,215 enriched** via Exa (OSM enumerate found 38,484; 7,091 plain bars split out). Reality check (data/uk-pub-harvest/quality-report.md): only 2,443 pubs (6.4%) got Exa content; ~27% of lore hits were about the WRONG pub (famous namesakes). Zero opening hours (never a field).
- **First bars + website-contents runs wrote 100% EMPTY rows**: Exa credits exhausted (402 NO_MORE_CREDITS, proven with request IDs); old code swallowed errors (fixed by #1215). Captain supplied a **fresh Exa key** — it lives in `/Users/karanmanoharan/.treehouse/pubmax-bde241/3/pubmax/.env.local`.
- **LIVE RIGHT NOW (detached, caffeinated, survives everything):** bars rerun with REAL data (500/500 observations in shard 0; ~732/hr; ETA ~14:14 UTC today) → auto-chained OSM-website /contents pass (9,628 https sites — the biggest cheap coverage gain) → fold-ready rebuild. Progress: `data-harvest/{bars-enriched,contents-enriched}/` + progress.json in the slot-3 worktree. Exa free window ends **Aug 31**.
- **Captain's fold rules (decided, binding):** lore prints ONLY on name+town matched pubs, with citation URLs, under a NEW closed HeritageFact source (suggest `web`); website/menu CTAs https-only, allowed on any pin incl. unpriced base; lore lives in the lazy venue-sheet overlay, NEVER in pin/slim payloads; socials OUT of scope v1; identity = OSM id (never name); empty row ≠ "no history". Folding plan details: quality-report.md section 4. **Folding lane queued** — dispatch after the contents pass completes (fold once).

## 5. Lanes in flight / paused at handoff
- **editorial-rss-overlay** (captain's Substack/news directive): implementation COMMITTED on fm/editorial-rss-overlay (slot-1 worktree): RSS poller (title+link+excerpt≤240ch ONLY — never store full bodies), static public/data/editorial/latest.json, credited "via {Publisher}" link-out rails on /out+/tonight. Needs: validation run driven to PR + merge. Handoff: data/editorial-rss-overlay/handoff.md. Source allowlist + laws: data/research-london-supply/report.md (22 verified feeds; ArtRabbit excluded; GLA = OGL credit).
- **map-speed-caching** (captain's speed law): branch created, NO commits. Full spec in data/map-speed-caching/brief.md: S1 service-worker stale-while-revalidate (tiles/style/glyphs/indices, version-busted, LRU-capped), S2 location-first spatial shards (load only user's region, ~5x first-visit payload cut), S3 instant last-view resume from IndexedDB, S4 evidence (repeat-visit <1s; cold pin-ready must stay <=4000ms). Handoff: data/map-speed-caching/handoff.md.
- Both were on Grok workers now RATE-LIMITED (captain: quota rests 13:00). Captain's routing order: **difficult work → codex gpt-5.6-luna at MAX effort** (recorded in config/crew-dispatch.json); no idle agents ever — successor starts the instant a lane frees.

## 6. Research artifacts (read before building in these areas)
- `data/research-london-supply/report.md` — London editorial feed ecosystem, ingestion pattern, top-5 partnership targets (PoK hello@pintsofknowledge.co.uk, Londonist TTD 103k, Seed Talks, ianVisits, Andie Dev).
- `data/research-3d-wow-ui/report.md` — 3D/wow technique audit: ThreeUI = moodboard only (52MB pkg, 2nd WebGL context hazard); Apple/Airbnb fake 3D with 2D; wow = the transition; MapLibre stays the only WebGL.
- `data/ideate-3d-reveal-panel/report.md` — panel verdict that produced the Beermat Drop (shipped as #1213); slices D (base-pin sheets same entrance) and B (desktop photo tilt) still queued.
- `data/uk-pub-harvest/quality-report.md` — harvest coverage truth + folding plan.
- Lets Discover teardown: small, not a threat; The London Nightlife Card = real lane-overlap competitor (Play Store).

## 7. Queue after the in-flight lanes (captain-ordered)
1. **UI/UX bug batch** (captain: "the next batch would be fixing all ui/ux bugs") — full QA sweep as the gate, then: search-row-click bug, one-chrome/nav pass (+390px wordmark), fix-desktop-voids, map-matcher-refinement (poi fallback token + CARTO place_town), reveal slices D + B.
2. **Harvest data folding** (after contents pass; rules in §4).
3. out-list-everything, price-confidence-tiers (green confirmed / yellow labeled estimate / grey unknown incl. restaurant menu costs), whats-on-harvest-cron.
4. Design resources (captain): Mobbin MCP + 60fps MCP installed user-scope — **await captain /mcp Authenticate**; galleries collectui.com, recent.design, canvasui.dev recorded as taste references.

## 8. Held for captain (do not act without his word)
- **DEPLOY** the 8-PR pile (recommended: tonight, after screenshots).
- GitHub **Actions billing** fix (removes the entire bypass dance).
- **Stripe keys** (round-split build parked; ADR freeze decisions also parked).
- **Skiddle** written commercial approval email; Skiddle logo asset.
- **Google Places budget** (~£300-500) + key for webless-pub extras.
- Exa top-up beyond current key if contents pass exhausts it again (fail-loud will catch it).
- ~40 older parked decisions in data/backlog.md (tasks-axi; hold kind=captain).

## 9. Fleet/ops facts a Codex primary must know
- **Session start:** run `bin/fm-session-start.sh` once; supervision per emitted codex protocol (bounded foreground checkpoints). Backlog: tasks-axi on data/backlog.md.
- **Worktrees (treehouse pool pubmax-bde241):** slot 1 = editorial lane, slot 2 = speed lane, slots 3+4 = harvest — **ENTANGLED: shared gitdir `pubmax2`, admin points at slot 4 while processes+data live in slot 3. Do NOT delete either or run `git worktree prune` until the harvest lane is fully done.** Never bare-prune anywhere (2026-08-24 incident).
- **8GB Mac:** memory floor 1.2GB free (vm_stat free+inactive), NODE_OPTIONS=--max-old-space-size=2048 (4096 only for tsc), ONE browser/Playwright worker, df -h before browser-test phases (ENOSPC hit twice; npm cache clean + rm -rf ~/.npm/_npx are the safe reclaims).
- **Mac sleep kills agents/loops** — long runs go under `caffeinate`; suggest captain enable prevent-sleep-on-power.
- **no-mistakes pipeline:** worker owns axi run/respond (never the primary); ci gate = classify billing reds as environment; bot threads to 0 before merge; ask-user findings → firstmate decides unambiguous ones.
- **Primary clone projects/pubmax is DIRTY** (810-file vendored-skills churn from 8/24, 100+ commits behind) — awaiting captain's discard word; workers pull origin/main directly so it blocks nothing.
- Captain-facing style: outcomes not mechanics, full PR URLs always, plain-words options + recommendation, concise; address as Captain.

## 10. The 3-day story in one paragraph
Deployed Monday's 16-PR pile to production, then merged 11 more PRs across three days: honest-data gates (#1200/#1202), UX intent protection (#1207), the brand mascot (#1209), map bug fixes (#1210), the signature map look (#1212), the harvest machinery (#1208), the Beermat Drop trust choreography (#1213), a 2.5x faster map (#1214), the fail-loud data fence (#1215), and Pal navigation (#1216). Harvested every UK pub, learned the honest coverage numbers, survived an Exa credit exhaustion with a new key and a fence that makes silent failure impossible, and got bars + 9,628 pub websites re-harvesting live. Established the speed law, difficulty-based model routing, the no-idle law, and the name+town honesty gate for lore. Everything is saved, durable, and waiting on two words from the captain: "deploy" tonight, and "go" at 1pm.
