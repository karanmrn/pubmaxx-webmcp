# Viewer Identity Loading Skeleton Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution with TDD and verification before completion.

**Goal:** Keep the You surface neutral while account identity restores, preserve the signed-out invitation, and render resolved account data only after the live identity answer.

**Architecture:** Route viewer identity through `useViewerHandle`, which already returns no handle until `identityResolved`. Add an explicit loading state to the shared `ProfileHeader` so the `/u/you` sentinel cannot paint synthesized `You` data, and apply the same tri-state guard to the borough passport slice that prints viewer-owned stats. Keep the existing signed-out invitation branch and cover it with component tests.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Vitest static component rendering, existing profile CSS.

## Global Constraints

- Identity is tri-state: unresolved surfaces must not name the viewer or print confident zero values.
- The device `pubmax_handle` is valid for signed-out device-only surfaces only after auth identity resolves as signed out.
- Signed-out `/u/you` remains an invitation with one clear sign-in door and no blocking dialog.
- Signed-out and unresolved Social cards must not show authed failure or retry copy; they show loading or sign-in invitation states.
- Loading shapes must use the existing profile geometry and shimmer style, with reduced-motion-safe CSS.
- Validation uses targeted tests and one throttled 390px browser check; no more than one full suite.

### Task 1: Lock the three viewer states with component tests

**Files:**
- Modify: `__tests__/profileRichRender.test.ts`
- Test: `components/profile/ProfileHeader.tsx`, `app/u/[handle]/ProfilePageClient.tsx`

- [x] Add a loading-header test that asserts cover, avatar, name, handle, and all stat tiles use skeleton markers and that the markup contains neither `You`, `@you`, nor numeric zero values.
- [x] Add a signed-out `/u/you` render test that asserts the invitation heading and sign-in door remain present and no pseudo-profile header is rendered.
- [x] Add a resolved viewer test that asserts the real display name, handle, pints, followers, and following values still render.
- [x] Run `npm test -- __tests__/profileRichRender.test.ts` and confirm the new expectations fail for the current implementation before changing production code.

### Task 2: Make the shared profile header neutral while viewer identity is unresolved

**Files:**
- Modify: `components/profile/ProfileHeader.tsx`
- Modify: `app/u/[handle]/profile.css`

- [x] Add an explicit `viewerState` prop with `loading` and `resolved` states, defaulting public profile callers to `resolved`.
- [x] Render a layout-matched loading header for `loading`: brass cover band, circular avatar block, name and handle lines, and stat labels with blank skeleton values.
- [x] Add shimmer styling behind `prefers-reduced-motion: no-preference`; keep static blocks for reduced-motion users.
- [x] Run the focused profile render test and confirm the loading and resolved cases pass.

### Task 2b: Protect the other viewer-owned passport stats

**Files:**
- Modify: `components/borough/BoroughPassportSlice.tsx`
- Modify: `app/borough/[slug]/borough.css`
- Test: `__tests__/boroughPassportIdentity.test.ts`

- [x] Read the borough passport handle through `useViewerHandle` and wait for `identityResolved` before fetching or printing viewer-owned data.
- [x] Render a neutral heading, copy shape, and four stat placeholders while identity is unresolved; preserve the settled signed-out empty state and settled handle data.
- [x] Run `npm test -- __tests__/boroughPassportIdentity.test.ts` and confirm it passes.

### Task 3: Use the shared viewer identity seam in the You route

**Files:**
- Modify: `app/u/[handle]/ProfilePageClient.tsx`

- [x] Replace the page-local `pubmax_handle` subscription/read with `useViewerHandle`, while keeping `syncDeviceHandle` for the signed-out claim action.
- [x] Treat `/u/you` with unresolved identity as a loading surface that renders only the neutral profile header and no zeroed passport, timeline, or saved profile data.
- [x] Keep the existing resolved signed-out invitation and resolved account redirect behavior unchanged.
- [x] Pass `viewerState="loading"` only for viewer-owned sentinel content so public stranger profiles do not become anonymous skeletons while auth restores.
- [x] Run the focused component tests and typecheck.

### Task 4: Verify the original slow-load symptom and prepare delivery

**Files:**
- No further source changes unless verification exposes a defect.

- [x] Run targeted profile, identity, navigation, and relevant source-fence tests.
- [x] Run `npm run lint` and `npm run typecheck`.
- [x] Start the app and use `chrome-devtools-axi` at 390px with throttled network to confirm unresolved You shows skeletons and signed-out You shows the invitation. The bridge timed out when reopening Social for the added scope.
- [ ] Review diff, commit the branch, push `fm/fix-identity-skeleton`, and open a direct PR with `gh-axi`.

### Task 5: Apply tri-state presentation to Social cards

**Files:**
- Modify: `app/social/SocialPageClient.tsx`
- Modify: `components/social/CrewsPanel.tsx`
- Modify: `components/social/SocialTagInbox.tsx`
- Modify: `components/social/SocialOutbox.tsx`
- Modify: relevant Social CSS files only if loading shapes need styling.
- Test: existing Social component/source tests plus a focused tri-state test file.

- [x] Reproduce signed-out Social failure copy and identify each card's auth and identity gate.
- [x] Add unresolved loading shapes and signed-out one-line sign-in invitations for the Social feed, crews, tag inbox, and outbox groups; keep retry copy for authenticated real failures.
- [x] Add component fences for unresolved, signed-out, and authenticated failure states.
- [x] Run the focused Social tests, lint, typecheck, and targeted browser checks before final review. The Social browser bridge timed out after the original You check.
