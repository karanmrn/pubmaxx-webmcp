# THE LOCAL implementation matrix

Baseline: `codex/pubmaxx-mobile-ui-reset` at `9c1182a3616f2de691451e6b51af435ea25aad1f`.

This matrix reconciles the Fable handoff against the shipped code before THE LOCAL implementation begins. Coverage readiness is evidence, not permission. A grounded route remains available with visible warnings.

| Contract | Baseline state | THE LOCAL decision |
| --- | --- | --- |
| Coordinated mobile shell | Implemented | Preserve one top bar, one rail, one dock, and one shared sheet. |
| Stable map camera | Partial | Route every intent through an identity-deduplicated latest-wins coordinator and expose non-sensitive intent telemetry for regression tests. |
| Describe your night | Partial on `/plan`, buried from Map | Make it the primary 48px map action and render the transient typed or voice form in the planner sheet. |
| Three grounded stops | Implemented | Preserve exactly three stops and grounded alternatives. |
| Coverage gate | Superseded | Remove the `409` route-ready block. Return confidence, evidence gaps, warnings, and provenance. |
| Budget | Partial value/standard/treat bands | Add an explicit per-person cap and an honest route estimate based on one recorded pint per stop. |
| Zero-proof | Implemented as a map filter | Add it to Night Context and plan scoring without changing alcohol-neutral product rules. |
| Weather, hours, events, get-in | Partial across separate services | Compose them into route evidence without inventing unavailable data. |
| Food, Get home, Keep going | Partial | Keep food terminals separate from pubs and require confirmation for every ending action. |
| Crew join and presence | Implemented | Add expiring invites, host/guest roles, constraints, votes, proposals, and host decisions. |
| Live-night actions | Implemented | Consolidate the global card into one plan pill and the shared planner sheet. |
| Completion and Memory | Partial | Seed an editable private recap only after canonical completion. |
| Story publication | Backend partial | Add preview, contributor consent, and explicit publication. Stories stay in Stories. |
| Pub Pal | Three launch forms, five steps, eight states | Add the six-companion cast plus real correction, deletion, export, and proposal controls. Preserve legacy species. |
| Signals | Empty reviewed-signal arrays | Add scheduled provenance-backed claims with review and expiry. Never search third parties in a live route request. |
| Store consolidation | Six stores on shared backend | Migrate in small parity-tested batches after product-facing seams are stable. |

## Stale handoff references

- PR #264's source branch currently resolves locally to `7cf66833` (with map commits `273c2062` and `84601195`). The reset baseline carries the integrated successors `f617e77d`, `61203a8f`, and the environment hardening at `fe8b11ea`; the source branch itself is not an ancestor and is not merged again.
- PR #263's source branch currently resolves locally to `0079edbd` (with the Tonight spine at `573e2c83`). The reset baseline carries the integrated Tonight hardening at `7923531d`; the source branch itself is not an ancestor and is not merged again.
- No commit, branch, or checked-in document in the local repository identifies issue #212. It remains an external research reference and cannot be treated as an implementation contract without a verified source.
- The historical GNHF sequences are already ancestors of `9c1182a` (saved-list tip `d5ecb97d`, optimistic Spill tip `ad434d10`, slim-map tip `fc1ff8a1`). Their retired branch names are not integration inputs, and no files are copied from the dirty Conductor checkout.
- MapLibre 6, Google identity, Microsoft identity, affiliate work, passive location, consumption rewards, and automatic Pal memories remain deferred.

These comparisons were made against the local Git object database. Matching behavior was manually integrated and adapted; differing patch IDs mean the reset commits are not claimed to be byte-for-byte cherry-picks.

## Release contract

Every slice must preserve keyless operation, existing public URLs, current API fields, explicit location consent, and user-controlled memories. Production promotion occurs only for an exact reviewed commit, followed by apex and `www` smoke verification.

## Delivered reconciliation

| THE LOCAL ticket | Delivered state | Local commit / evidence |
| --- | --- | --- |
| 01 verified matrix | Implemented | This document; stale PR, branch, and issue references reconciled against the local object database. |
| 02 map orchestration | Implemented | `953363f1`; one latest-wins camera coordinator, plan coordinator, route-intent trace, and restored mobile session seam. |
| 03 Describe your night | Implemented | `953363f1`; primary map CTA opens the shared planner sheet with transient voice, text, and editable context controls. |
| 04 always-plan confidence | Implemented | `953363f1`; reviewed coverage labels confidence and warnings but no longer returns the old route-readiness block. |
| 05 grounded scoring | Partial | `51226745`; three stops, alternatives, budget/route totals, Tonight evidence, provenance, stale-request aborts, and generation dedupe are live. Opening hours, weather, venue accessibility, and get-in remain explicit evidence gaps and never score as satisfied constraints. |
| 06 night endings | Partial | `51226745` and `029c5e3d`; Food, Get home, and Keep going are confirmation-gated, with live-night late-food and last-train loading. Several Night Areas do not yet have the two grounded late-food records required by the contract, and generation-time Get home does not yet embed live status. |
| 07 secure invitations | Implemented | `0dd43e5b`; hashed, expiring, revocable capabilities with host/guest roles and read-only legacy links. |
| 08 crew decisions | Implemented | `0dd43e5b`; constraints, votes, proposals, host decisions, replay protection, and idempotent mutations. |
| 09 live-night HUD | Implemented | `029c5e3d`; active-plan pill and shared planner surface cover arrival, skip, swaps, and endings without sheet stacking. |
| 10 recap and Story approval | Implemented | `029c5e3d`; versioned pending recaps, editable private Memory seeding, contributor consent, and Stories-local publication. |
| 11 six companions | Implemented | `5a1a316d`; Greyhound, Black Cat, Fox, Pigeon, Badger, and Corgi plus all eight states and legacy species mappings. |
| 12 Pal ownership | Implemented | `5a1a316d`; correction, deletion, export, proposal disabling, visible context, and explicit confirmation gates. |
| 13 scheduled evidence | Partial | `07494b3e`; versioned claim snapshot, provenance/review/expiry validation, scheduled review workflow, and route-affecting review rules are live. The workflow validates staged candidates but does not yet acquire upstream event, price, access, opening, or transport claims; the reviewed snapshot is therefore intentionally empty. |
| 14 cross-tab continuity | Implemented | `07494b3e`; versioned plan, proposal, caption/comment, Pal, and pending-recap adapters exclude voice, secrets, and precise-location history. |
| 15 consolidation | Implemented for this release seam | `07494b3e`; common backend batches and keyless/configured parity tests landed without a wholesale store, CSS, or MapLibre rewrite. |
| 16 Gate Z | Partial, local evidence complete for implemented scope | `docs/screenshots/the-local-gate-z/` plus the refreshed mobile matrix in `docs/screenshots/mobile-reset/`; functional gates and strict performance budgets pass. A continuous full-journey recording and external Fable approvals remain outstanding. |

Metric status: the idempotent `plan_completions` ledger implements the primary
release metric. A browser `planned_night_completed` event is intentionally not the
authority because a committed write can outlive a lost response. Weekly Active
Crews and Worthwhile Nights Completed can be inferred from existing crew, Memory,
contribution, share, and Story events, but a durable privacy-safe aggregation/report
has not landed and remains partial.

The only planned deferrals are the boundaries already named above: Google and Microsoft identity, MapLibre 6, affiliate growth, passive location, drink-volume rewards, and automatic Pal memories. Fable approval is an external release decision, not an implementation state.
