# Gate 0 reconciliation ledger

**Snapshot:** 2026-07-13, local `main` at `36e8421a8a62a8909d40088baee6981281d182b2`, one commit ahead of `origin/main` at `04bd6004f490cd2d94f84f4b54bfbbacfd0c748c`.

This ledger is the release-routing view of the FABLE_SOL_PLAN. It records repository evidence, not product aspiration. The untracked planning documents present in `docs/` are deliberately preserved and are not treated as shipped functionality.

## Release blockers and hygiene

| Item | Status | Evidence / required disposition |
|---|---|---|
| Local/remote reconciliation | **Blocked for release** | Local `main` contains the unpushed `feat: add Pub Pal planning foundations` commit. Any release or agent branch must explicitly include or exclude `36e8421`; do not plan from `origin/main` as if it were current. |
| Keyless production build | **Passed** | `npm run ci:isolated` completed without Supabase/OpenRouter credentials after centralizing the production-build exception and retaining runtime production guards. |
| Isolated build cleanliness | **Passed** | Direct custom-dist builds rewrote tracked `next-env.d.ts` and `tsconfig.json`. `npm run ci:isolated` now creates and removes a unique ignored sibling dist directory, preserves caller-provided directories, restores both Next-managed files exactly, and rejects any other new tracked mutation. Seven focused behavior tests and a complete isolated CI run pass. |
| Generated data cleanliness | **Passed** | `prebuild` regenerated the tracked data artifacts idempotently during the successful isolated CI run; the wrapper found no new tracked changes after completion. Detail binaries under `data/generated/` remain ignored. |
| Concurrent build isolation | **Harnessed** | `next.config.mjs` respects `NEXT_DIST_DIR`. The isolated wrapper defaults to a unique child of ignored `.next-isolated/`, which cannot be deleted by a simultaneous default `.next` build, and removes only the directory it owns. An explicit caller-provided directory is preserved. Simultaneous builds targeting the same caller-provided directory remain invalid evidence. |
| Screenshot gate | **Harness passed partially; acceptance open** | The repaired keyless dev harness produced 18 fresh viewport captures across the required matrix before the shared dev server reset during an active-night fixture. It also exposed and fixed an unclosed desktop media block in `venueSheet.css`. A stable full matrix and visual read are still required before Gate 0 closes. |
| Untracked planning material | **Preserve** | Eleven existing untracked documents/notes were present before this ledger. Do not stage, overwrite, or infer shipped state from them. |

## Capability reconciliation

| Plan capability | Repository state | Routing decision |
|---|---|---|
| C1 concierge-as-map-home | **Partial / overlapping** | `/plan` has grounded description-to-route generation, while the app also has map concierge components and established `/api/concierge` behavior. The new generator is not yet the canonical map-home flow. Reconcile semantics and data contracts before more concierge UI is added. |
| C2 active plan drawn on map | **Implemented on remote main** | `origin/main` already includes #251 with an active-plan route line and stop markers. Remove this from greenfield scope; verify it in the canonical end-to-end journey. |
| C3 event-aware planning | **Implemented on remote main, broader context partial** | `origin/main` includes #250 for event weighting and event-at-stop chips. Budget, live get-in, and weather behavior remain separate acceptance items; do not relabel the whole C3 bundle complete. |
| Planned Night lifecycle | **Foundation implemented locally** | `36e8421` adds draft/ready/active/ending/completed/abandoned states, guarded transitions, stop actions, Crawl Endings, API persistence, migration `0026`, and tests. UI coverage for the complete live lifecycle remains incomplete. |
| Night Context | **Foundation implemented locally** | Structured inference, editing, persistence, and tests exist. Only six pilot Night Areas are accepted, and generation currently fails outside their radii; this conflicts with the agreed overlay-not-gate direction and must be reconciled before expansion. |
| Night Area catalogue | **Partial and contract-conflicting** | Six areas exist: Clapham, Victoria, Piccadilly & Soho, Canary Wharf, Barnes, Chiswick. The FABLE_SOL_PLAN calls them Night Districts and proposes route-readiness gating. Canonical language is **Night Area**, and weak coverage must change confidence/explanation rather than prohibit grounded route generation. |
| Pub Pal | **Presentation contract plus planning foundation only** | ADR 0004 makes persona optional and neutral-equivalent, and the local commit provides lifecycle/context foundations. Character UI, structured memory, morning-after recap, voice, zero-proof routing, guest adoption, and endings UX are not thereby complete. |
| Anonymous crew participation | **Existing foundation** | Plan APIs already use member tokens and local/session storage paths. Account adoption, revocation, duplicate-person reconciliation, deletion, and cross-device identity remain unimplemented contracts. |
| F2 component decomposition | **Substantially implemented; issue stale** | Current `VenueInspector`, `RoutePanel`, and `PintDropComposer` are about 201/276/266 lines, not the 1044/733/854-line audit figures. Issue #166 should be re-audited against current composition/complexity before assigning more split work. |
| F1 map decomposition | **Needs fresh measurement** | The paths/numbers in the plan no longer match the current file layout. Issue #165 must be re-scoped from current map modules rather than executed from stale line counts. |
| F4 store factory | **Open, not Gate 0** | Issue #168 remains open. This is architectural debt and should not block the keyless Map-to-Night release seam unless a measured defect depends on it. |
| CityMCP rate limiting | **Already present** | `lib/citymcpRateLimit.ts` and route usage exist. Verify every public proxy route and response headers, but do not schedule a blanket greenfield implementation. |
| Shared API errors | **Partial** | `jsonNoStore` is the established response helper; error payload strings remain route-specific. Introduce a stronger public error contract only from an interface decision, not as mechanical churn. |
| Tonight, feed, profiles, heritage, historic routes | **Implemented surfaces** | Routes, components, tests, and screenshot baselines exist. Treat them as regression surfaces and integration inputs, not new feature epics. |
| Live Signals / Pulse | **Not implemented as proposed** | What's On and CityMCP signals exist, but there is no evidenced expiring, corroborated `AreaPulse` publication pipeline. Do not equate existing venue events with the proposed Pulse trust model. |
| Coverage snapshots / late-food terminal model | **See owner contracts** | Endpoint terminals remain separate under [`API_CONTRACTS_THE_LOCAL.md`](API_CONTRACTS_THE_LOCAL.md). Curated map venues keep their distinct Venue Dataset contract. Neither contract turns a food anchor into a pint price. |
| World Cup strike lane | **Time-sensitive and unverified** | No shipped implementation was established in this snapshot. It may proceed only behind a flag with verified source/expiry evidence and must not displace Gate 0. |
| Growth, push, identity, affiliate rails | **Portfolio scope, not Gate 0** | Existing profile/feed/storage pieces are not proof of the proposed account adoption, push, referral, leaderboard, or affiliate contracts. Keep these sequenced after the core anonymous Planned Night loop. |

## Open-work reconciliation

The current GitHub queue has ten open issues. The release-relevant interpretation is:

- **Re-audit before assignment:** #165, #166, #167. Their titles and/or measurements overlap functionality already decomposed or shipped on current `main`.
- **Independent hardening:** #212 canonicalization and #222 map opacity/style reload. These can run as bounded lanes after Gate 0 evidence establishes no shared-file collision.
- **Architecture debt:** #168 store factory. Do not make it a release prerequisite without a defect or measured maintenance payoff.
- **Product contracts:** #252, #253, #258. Reconcile terminology and the overlay-not-gate rule before schema or UI work.
- **Transport follow-up:** #45. Integrate with Crawl Ending/get-home behavior rather than building a second planning lifecycle.

## Gate 0 exit criteria

Gate 0 is complete only when all of the following are evidenced from one stable checkout:

1. The team records whether `36e8421` is the integration base and prevents agents from silently planning from `origin/main`.
2. `npm run ci:isolated` passes keyless; callers may set `NEXT_DIST_DIR` only when they intentionally own that directory's lifecycle.
3. The command leaves every tracked file byte-for-byte unchanged, including `next-env.d.ts` and generated public datasets; temporary dist directories are ignored or removed.
4. Focused tests cover plan generation, Night Context inference/editing, lifecycle transitions/actions, anonymous member authorization, and active route rendering.
5. A browser loop passes: landing → map → express intent/select grounded venues → editable `/plan` → share → anonymous join → activate → record stop action → choose ending → complete.
6. Fresh screenshots are read at desktop/mobile and light/dark for landing, map clean/selected, Tonight, plan composer, shared plan, and active-night states.
7. `git diff --check` passes and the final status contains only explicitly owned changes; pre-existing untracked documents remain untouched.

Until those criteria pass, feature agents may research or work in non-overlapping flagged lanes, but their changes must not be described as release-ready.
