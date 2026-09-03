# Growth Activation Wave

Status: released to production on 10 August 2026.

## Fable Review Handoff

Three isolated worktrees implemented the slices with test-first red and green
evidence. Integration branch is `codex/growth-outing-decision-20260810`.

- [x] Slice 01: enforce free-text access, numeric budget, and transport constraints through the grounded planner.
- [x] Slice 02: offer the usual lot from the one-time morning recap card.
- [x] Slice 03: add Islington as the fifth seed-borough campaign row.
- [x] Integrate isolated commits.
- [x] Run slice-level targeted tests, focused lint, and diff checks.
- [x] Run integrated TypeScript, focused lint, and production build gates.
- [x] Inspect the deployed morning card at 390px in light and dark mode.

## Verification Evidence

- Integrated branch: 176 targeted tests passed across Tonight Agent, hard
  route constraints, Plan generation, morning re-entry, usual-lot storage,
  analytics, and borough coverage.
- `npx tsc --noEmit`, focused ESLint, and `git diff --check` passed.
- Morning slice: 10 targeted tests passed across usual-lot storage and the
  mounted morning card. Focused ESLint and diff check passed.
- Borough slice: 8 targeted tests passed. Focused ESLint and diff check passed.
- Vercel preview `dpl_GTn2hH6XgruL13F18pcqVhWALsFT` and production
  `dpl_6YkkY5faYYj5Afr3npLb9EEdizou` reached `READY`. Production serves merged
  main commit `98b27ab09299e1e1b61663b8ae760d1878711dcd`.
- Browser QA passed at 390px in light and dark and at 1440px. No horizontal
  overflow appeared. Private crew names stayed out of rendered copy.
- The live free-text check returned grounded scarcity for `Step-free in
  Camden`; the soft Clapham ask returned three grounded stops and its invite.
- GitHub Actions run `31428847405` did not allocate a runner during the release
  window, so it was not counted as green. Vercel production build, local
  TypeScript, lint, diff checks, and targeted tests were the release gates.
- No product or Fable files were deleted to make room. Only two clean Codex
  worker worktrees were removed after their commits were integrated; their
  branches and commits remain recoverable.

## Goal

Close the remaining day-zero growth gaps without rebuilding work already on
`origin/main`: honest free-text constraints, a direct next-night crew loop, and
a five-borough evidence pilot.

## Slice Graph

1. `slices/01-grounded-free-text-constraints.md` fixes the decision contract.
2. `slices/02-morning-usual-lot.md` composes the existing recap and crew loop.
3. `slices/03-five-borough-pilot.md` expands the existing status campaign.

Slices are independent and may run in parallel. Integration follows in this
order because planner behavior carries the highest user-risk.

## One-Owner Invariants

- `lib/planGenerationSelection.server.ts` remains the only bridge from Night
  Context into grounded route constraints.
- `lib/lastCrew.ts` remains the only usual-lot storage and analytics-prop owner.
- `lib/boroughCoverageStatus.ts` remains the only seed campaign definition.
- No new recommendation engine, crew store, recap entity, borough page,
  analytics duration property, or public price archive is allowed.

## Scope Firewalls

- Public Pint Index snapshot currently contains zero eligible observations.
  Do not publish a weekly price claim, fabricate a league, or promote legacy
  competitor-derived prices.
- Transport constraints remain unsupported by the grounded optimizer and must
  return scarcity rather than be silently relaxed.
- Memories and crew rosters stay private by default.
- Reward evidence and coordination, never alcohol volume.

## Review Map

- Slice 01: targeted Vitest route and optimizer tests.
- Slice 02: mounted component behavior plus usual-lot tests. Visual review is
  required on the integrated build at phone width before release.
- Slice 03: pure unit test and playbook review. No new visual component.

## Deferred Work

- Weekly original price release starts only after `pint_index_snapshot.json`
  contains eligible observations with a public source, observation day, stable
  Venue ID, and canonical borough.
- External Reddit, X, and creator posting stays owner-led. This wave prepares
  product loops and does not publish on the founder's behalf.
