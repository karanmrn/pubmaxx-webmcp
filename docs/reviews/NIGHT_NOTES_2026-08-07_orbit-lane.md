# Night notes — orbit-lane, 2026-08-07

> Lane summary for the morning retro. Covers the two tasks this lane ran
> tonight. Companion PRs: #893, #894.

## 1. Confidence run on main tip

Ran `npm run verify` and `npm test` on main before other work started.
The audit gate failed. `nanoid` carried a transitive advisory,
GHSA-2v37-7h3g-55p8.

Reported the red gate per the standing rule: stop and report, do not
patch around a red gate alone. Team-lead fixed the root cause in PR
#893 (merged as `a684d598`, bumps the transitive `nanoid` version past
the advisory). Re-ran the audit script alone after the fix. Green.

## 2. #851 unblock — brand-first `/about` hero

Task: merge `origin/cursor/about-brand-hero-dd0b` (PR #851) into a
fresh branch off main, fix the failing `aboutPintIndexStory` test, and
open a PR without merging it.

### Root cause of the test failure

The failure was "invariant expected app router to be mounted",
thrown when `renderToStaticMarkup` hits `SiteNav`'s real render tree,
which pulls in `NotificationBell` and its `useRouter` call. There is
no App Router context in that render harness.

The codebase's established fix for this is to mock `SiteNav` out
entirely at the test level, not to change the page. See
`__tests__/journeyEntryPoints.test.ts` for the existing precedent.
The merged `aboutPintIndexStory.test.ts` already carried this mock,
unconflicted, from the source branch. No production seam code was
needed; the merge conflicts were narrow content and assertion
differences only.

### Conflicts resolved

11 files conflicted. Two were genuine #851 conflicts:

- `app/about/page.tsx`: kept main's "founder-led by Karan Manoharan"
  paragraph, dropped the source branch's added "with a small team"
  claim. No invented team headcount.
- `__tests__/aboutPintIndexStory.test.ts`: kept both sides' assertions
  plus the source branch's new hero regression test.

The other nine were staleness conflicts from unrelated main-side
changes since the source branch's merge base (`openPubs`,
`planDescribeFirst`, docs tables, a `package.json` script line,
`landing.css` rules). All resolved by keeping main's version; each
was a confirmed superset of the stale branch's side.

### Gates

- `aboutPintIndexStory.test.ts`: 4 passed
- `emDashLaw` + `frictionVoice` + `landingPriceHonesty`: 35 passed
  across 3 files
- `npm run typecheck`: clean

PR #894 opened, not merged by this lane. Team-lead reviewed
independently and merged it as `7246b58b` (33 tests green on their
pass, no small-team regression).

## 3. Not covered by this lane

This lane did not touch dev-store desync or a chrome bridge sandbox
issue. If those are real findings from tonight, they belong to
whichever lane hit them; check that lane's own notes before folding
them into this file.
