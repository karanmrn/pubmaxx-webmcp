# Task 5 report: canonical Social shell

## Status

Complete. `/social` is canonical mobile-first Social route. Legacy route families redirect directly to canonical Social state. No push performed.

## Delivered

- Added strict closed shell state for `tab`, `feed`, and listed Nearby `area` values. Invalid, duplicate, unknown, identity, coordinate, and cursor query state redirects to `/social`.
- Added safe Social access boundaries. Preview and unverified states do not request protected posts or authorised Activity.
- Added chronological Following, Nearby, and Discover feed lanes with explicit pagination. Cursor state stays in API requests only.
- Embedded reusable Discover body without nested page landmarks, navigation, or heading hierarchy.
- Added mobile-first layout with 44px controls, fixed-tab clearance, no horizontal overflow, focus clearance, and responsive desktop columns.
- Added canonical navigation, sitemap, analytics, warmup, route-pattern, tracing, and internal-link changes. `/feed` and `/stories` redirect to `/social`. `/discover` and `/drinks` redirect to `/social?tab=discover`.
- Added a bounded desktop Activity rail from `/api/social/interactions?view=notifications&limit=5`. It parses only generic notification kind, read state, and time. It never renders source IDs or protected text.
- Kept Task 6 scope closed. No composer, Cheers, comment, repost, or presence controls were added.

## TDD and review findings

- Initial route, navigation, sitemap, shell, and redirect tests failed before implementation.
- Browser RED found public Discover requested Social access and feed retry repeated access. Both paths now keep reads in their proper boundary.
- UI review found nested main navigation, weak desktop balance, a venue noun mismatch, and keyboard focus under fixed mobile tabs. All were fixed before proof capture.
- Cross-task audit found authorised Social Activity linked to legacy `/activity`, whose handle-keyed boundary is not safe for protected Social. Added failing unit and browser fences, removed legacy continuation, and kept Activity inline and bounded. Empty and unavailable Activity states now reserve no visible dead rail.

## Verification

- Focused Social tests: 13 files, 107 tests passed before final audit fix.
- Final Activity fences: 2 files, 16 tests passed.
- Full unit suite: 779 files, 7,850 tests passed in 371.12 seconds.
- TypeScript: `npm run typecheck` passed.
- ESLint: `npm run lint` passed.
- Isolated production build: `NEXT_DIST_DIR=.next-task5-final3 npm run build` passed.
- Chromium: 10 tests passed against isolated production output.
- Browser coverage: 320px, 390px, 430px, 1280px, and 1440px; light and dark; refresh and Back; keyboard; axe; no horizontal overflow.
- Build retained existing `lib/ogBrand.tsx` Edge-runtime warnings. No new build error.

## Proof

Screenshots and command index: `docs/proof/social-shell/README.md`.

## Concerns

- Social remains behind existing preview and verification policy. This task does not enable beta access.
- Empty and unavailable Activity results hide the desktop rail. This avoids dead chrome while Task 6 owns richer interactions.
- No migration or privacy practice changed.

## Fix round 1

### Findings and root cause

- `longFeaturePost` inherited `visibility: "public"` while adding an exact `venueId`. This test fixture could not pass the Social post validator and gave false proof for the Venue action.
- `SocialPostCard` trusted the DTO shape and rendered exact Venue context whenever `venueId` was present. A malformed or legacy public DTO could therefore expose exact Venue context even though write validation rejects that state.
- Four desktop feed frames were captured before removal of the legacy `/activity` continuation and no longer matched final source.

### RED

Unit seam:

```sh
npx vitest run __tests__/socialShellUi.test.ts
```

Result: 1 failed and 10 passed. The new public DTO test received `Open venue` and `/map?sel=venue-a`.

Browser seam against the prior isolated production build:

```sh
PW_SKIP_WEBSERVER=1 PW_PORT=32114 npx playwright test e2e/social-shell.spec.ts --project=chromium --workers=1 --grep "invalid public post DTO"
```

Result: 1 failed. Browser expected zero `Open venue` links and received one.

### GREEN

- `SocialPostCard` now derives exact Venue context only for non-public DTOs. Public Night Area context remains visible.
- `longFeaturePost` now uses `visibility: "friends"`, which is a valid exact Venue state.
- `__tests__/socialShellUi.test.ts` covers public exact Venue suppression and existing friends-only Venue rendering.
- `e2e/social-shell.spec.ts` covers malformed public DTO suppression in a browser and keeps exact Venue proof on the friends-only fixture.

Commands and results:

```sh
npx vitest run __tests__/socialShellUi.test.ts
```

Result: 11 passed.

```sh
npx vitest run __tests__/socialShellUi.test.ts __tests__/socialCanonicalLinks.test.ts
```

Result: 2 files and 17 tests passed.

```sh
npm run typecheck
npm run lint
```

Result: both passed.

```sh
NEXT_DIST_DIR=.next-task5-fix1 npm run build
```

Result: passed. Existing `lib/ogBrand.tsx` Edge-runtime warnings remain.

```sh
npm test -- --maxWorkers=1
```

Result: 779 files and 7,851 tests passed in 260.85 seconds.

```sh
PW_SKIP_WEBSERVER=1 PW_PORT=32115 npx playwright test e2e/social-shell.spec.ts --project=chromium --workers=1
```

Result: 11 passed in 18.2 seconds. This final run includes public Venue suppression, Activity continuation absence, keyboard, axe, history, viewport, and theme checks.

### Regenerated proof

Regenerated from `.next-task5-fix1` and inspected directly:

- `docs/proof/social-shell/1280-light.png`
- `docs/proof/social-shell/1280-dark.png`
- `docs/proof/social-shell/1440-light.png`
- `docs/proof/social-shell/1440-dark.png`

Each Activity card contains only generic `New comment` and time. No frame contains `Open Activity` or a legacy `/activity` continuation.

### Final diff check

```sh
git diff --check
```

Result: exit 0 with no output.
