# Fable review iteration — multi-PR build queue

> Status: **EXECUTING** (2026-08-07). Separate PRs for Fable review tomorrow.
> Does **not** reopen [#816](https://github.com/Singularityszn/pubmax/pull/816) (invite-ready / WhatsApp next step / map orientation) or duplicate its ShareBar work.
> Relates to [#817](https://github.com/Singularityszn/pubmax/pull/817) (outings S1–S4 + review fixes) and [`OUTINGS_WAVE_REVIEW.md`](./OUTINGS_WAVE_REVIEW.md).

---

## Goal

Keep shipping useful product slices overnight as **small, reviewable PRs**. Each PR owns one concern, has tests, and stays inside `docs/VOICE.md`.

## Already in flight (do not duplicate)

| PR | Owns |
|---|---|
| [#817](https://github.com/Singularityszn/pubmax/pull/817) | Outings story, landing why, coffee taxonomy + `0082`, Open Pubs scaffold, taxonomy follow-through |
| [#816](https://github.com/Singularityszn/pubmax/pull/816) | First-map band tour, WhatsApp-first `PlanInviteNextStep`, contribution gate before price form, invite e2e |

## PR queue (this iteration)

### PR-A — Coffee lens empty-state honesty
**Branch:** `cursor/coffee-lens-empty-states-dd0b`  
**Base:** `cursor/first-principles-outings-plan-dd0b` (needs coffee taxonomy) or stack after #817  
**Job:** When the map lens is coffee, unknown/empty copy uses a coffee noun, not beer or “alcohol-free or soft drink”. Reuse `drinkLensUnknownRowLabel` / coverage helpers. No seeded prices.  
**Done when:** focused vitest on mapExperienceLens / mapPriceLegend / venue list labels green; VOICE fences green.

### PR-B — Open Pubs London match report
**Branch:** `cursor/open-pubs-london-report-dd0b`  
**Base:** `cursor/first-principles-outings-plan-dd0b` (uses Open Pubs scaffold)  
**Job:** CLI/report mode that evaluates Open Pubs rows against **London curated identity**, writes a JSON summary (matched / unmatched / ambiguous counts), never merges into slim. Document in `docs/data/OPEN_PUBS.md`.  
**Done when:** unit test with fixture; dry-run script exits 0; no network in tests.

### PR-C — Map-sheet outing copy
**Branch:** `cursor/map-sheet-outing-copy-dd0b`  
**Base:** `main` (independent of coffee)  
**Job:** Align `MobilePlanActivation` / residual “Plan my night” / “Describe the night” user-facing strings on the map sheet with outing language already on `/plan`, without breaking onboarding companion CTA that #816/e2e may still pin — update e2e in the same PR.  
**Done when:** em-dash/voice tests + touched e2e locators updated.

### PR-D — Guest RSVP → map soft prompt (only if missing on #816)
**Branch:** `cursor/invite-rsvp-map-prompt-dd0b`  
**Base:** `main` or #816 tip  
**Job:** After successful guest RSVP on `/invite/[token]`, show one soft prompt to open stops on the map (no account). Skip if #816 already ships this.  
**Done when:** unit or e2e pins the prompt; VOICE-clean.

### PR-E — Coffee submit surface smoke (test-only)
**Branch:** `cursor/coffee-submit-e2e-dd0b`  
**Base:** outings tip  
**Job:** Extend price-submission e2e (or vitest route test) so coffee is a submittable category in the UI list; no fake prices in fixtures beyond what tests already allow.  
**Done when:** test green keyless/mocked.

### PR-F — Plan occasion chip honesty (from S1–S4 review)
**Branch:** `cursor/plan-occasion-chip-honesty-dd0b`  
**Base:** outings tip  
**Job:** Wire `inferNightContext` so coffee / soft drink / food / daytime chips set real context fields; tests per chip.  
**Done when:** vitest asserts parsed occasion fields per `DESCRIBE_FIRST_CHIPS` label.

### PR-G — Lens reach note + Discover lede
**Branch:** `cursor/lens-reach-note-discover-dd0b`  
**Base:** outings tip  
**Job:** `communityReachNote` honesty for map-lens non-beer; Discover lede includes coffee; drop soft invented “small team” on `/about`.

## Execution rules

1. One concern per PR; prefer stacked base notes in the PR body when depending on #817.
2. No invented biography, fake counts, or Wetherspoons app reverse.
3. Captain applies migrations — agents only ship SQL.
4. Do not touch `AuthProvider` token-fragment paths.
5. Commit + push + open/update draft PR per branch before claiming done.

## Fable checklist (tomorrow)

- [ ] #817 outings + review fixes
- [ ] #816 invite-ready V1 gaps
- [ ] PR-A coffee lens copy
- [ ] PR-B Open Pubs London report
- [ ] PR-C map-sheet outing copy
- [ ] PR-D/E if opened
