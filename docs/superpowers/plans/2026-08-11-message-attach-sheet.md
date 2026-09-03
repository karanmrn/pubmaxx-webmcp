# Message Attach Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile message composer attach button with a WhatsApp-shaped bottom sheet while preserving the existing photo upload path and desktop control.

**Architecture:** Keep `MessageThread` as the owner of attachment state and file selection. Render a mobile-only portal-like sheet that follows the existing mobile map sheet geometry and gesture conventions, with three labelled targets that select the existing file path. Keep the desktop inline controls unchanged except for shared attach analytics and the mobile trigger.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS tokens, Vitest, Playwright, `lucide-react`, `chrome-devtools-axi`, `gh-axi`.

## Global Constraints

- Mobile sheet only at the existing `MOBILE_MEDIA_QUERY` breakpoint.
- Targets are Photos, Camera, and Document. Photos has no `capture` attribute. Camera has `capture="environment"`. All use the existing message photo input and crop/upload path.
- No new attachment kind, server route, upload type, or migration.
- Each chosen attach kind emits one existing `trackEvent` event with a closed kind value.
- Reuse `mobileMapShell.css` sheet tokens, safe-area insets, touch-action, and spring/ease conventions.
- Sheet dismisses on scrim tap, Escape, and swipe down. Targets are at least 56px circular controls with labels below.
- Product copy uses British English and no em dash.
- Capture browser proof at 390x844 and include it in the pull request body.

---

### Task 1: Lock the mobile attach behaviour with a regression test

**Files:**
- Modify: `__tests__/messageBubbleAndComposer.test.ts`
- Modify: `lib/analyticsEvents.ts` if the chosen attach event is not in the existing closed registry

**Interfaces:**
- Consumes: current `MessageThread` markup, `app/messages/messages.css`, and `MOBILE_MEDIA_QUERY`.
- Produces: assertions that fail while the composer has only the desktop-style direct file control.

- [ ] **Step 1: Add a focused failing test**

Assert all of the following from real shipped source and CSS: the mobile trigger has a mobile-only class, the sheet names Photos, Camera, and Document, Photos has no `capture`, Camera has `capture="environment"`, the sheet uses the shared sheet classes, the targets have 56px circle sizing and touch-safe declarations, and the attach event is registered with a closed `kind` prop.

- [ ] **Step 2: Run only the focused test**

Run: `npm test -- __tests__/messageBubbleAndComposer.test.ts`

Expected: FAIL because the current composer has no mobile sheet, camera target, document target, or attach event.

- [ ] **Step 3: Commit the red test only**

```bash
git add __tests__/messageBubbleAndComposer.test.ts lib/analyticsEvents.ts
git commit -m "test(messages): define mobile attach sheet contract"
```

### Task 2: Implement the mobile sheet and shared file selection

**Files:**
- Modify: `components/messages/MessageThread.tsx`
- Modify: `app/messages/messages.css`
- Modify: `components/mobile/mobileMapShell.css` only if an existing sheet token or gesture declaration cannot be consumed directly
- Modify: `lib/analyticsEvents.ts` only if Task 1 identified a missing event registration

**Interfaces:**
- Consumes: `PROFILE_IMAGE_PICKER_ACCEPT`, `MESSAGE_PHOTO_CROP_TARGET`, `trackEvent`, `MOBILE_MEDIA_QUERY`, and the existing `cropping` state.
- Produces: `MobileAttachSheet` markup owned by `MessageThread`, three labelled target handlers, and one shared `onPhotoFileChange` path.

- [ ] **Step 1: Add the smallest state and handlers needed**

Add `mobileAttachOpen` state, a stable close callback, and a target handler that closes the sheet, emits one `message_attach_selected` event with `kind: "photos" | "camera" | "document"`, then clicks the selected existing file input. Keep file change handling pointed at the existing cropper state and reset the input value after selection.

- [ ] **Step 2: Add the failing test's production markup**

Render a mobile-only trigger beside the existing desktop attach control. Render the sheet only while open with a scrim, a drag handle, a concise title, and three target buttons. Use existing Lucide icons. Render three hidden, laid-out file inputs with the same accepted image types and the same `onPhotoFileChange`; omit `capture` from Photos and Document, and set `capture="environment"` on Camera.

- [ ] **Step 3: Reuse mobile map sheet CSS conventions**

Use `mobileSheetPortal`, `mobileSheetScrim`, and `mobileSharedSheet` class names so `mobileMapShell.css` supplies the material, z-index, safe-area, and bottom anchor. Add only message-specific sheet rules in `messages.css`: a coral-accent icon grid, circular controls at least 56px, label alignment, `touch-action: manipulation`, `user-select: none`, press scale, and a small CSS transition using the same ease tokens. Add a pointer gesture on the sheet handle or sheet header that calls close when downward movement passes the existing swipe threshold.

- [ ] **Step 4: Keep desktop behaviour intact**

Use `@media (max-width: 640px)` to show the mobile trigger and hide it on wider viewports. Keep the existing desktop photo and pub buttons available on desktop. Do not add a document attachment to `PendingAttachment` or the server payload.

- [ ] **Step 5: Run the focused test green**

Run: `npm test -- __tests__/messageBubbleAndComposer.test.ts`

Expected: PASS with no warnings.

- [ ] **Step 6: Commit the implementation**

```bash
git add components/messages/MessageThread.tsx app/messages/messages.css components/mobile/mobileMapShell.css lib/analyticsEvents.ts __tests__/messageBubbleAndComposer.test.ts
git commit -m "fix(messages): add mobile attachment sheet"
```

### Task 3: Verify browser behaviour and capture proof

**Files:**
- Create: `docs/proof/message-attach-sheet-390x844.png`
- Modify: `e2e/messages-mobile.spec.ts` only if the repository already has a signed-in harness seam for this exact composer

**Interfaces:**
- Consumes: the committed mobile sheet and the repository's signed-in browser harness if available.
- Produces: a 390x844 screenshot of the open sheet and evidence for dismiss, target attributes, and desktop absence.

- [ ] **Step 1: Run the browser repro at 390x844**

Use `chrome-devtools-axi` against the local app. Reach a signed-in message thread, open the attach control, and inspect the sheet. Confirm the three labels, icon circles, safe bottom spacing, and dark panel with coral accent.

- [ ] **Step 2: Exercise dismiss paths**

Confirm scrim tap closes the sheet and a downward drag on the grabber closes it. Confirm a target click closes the sheet before opening the file picker.

- [ ] **Step 3: Capture the proof image**

Save the open-sheet viewport at exactly 390x844 as `docs/proof/message-attach-sheet-390x844.png`.

- [ ] **Step 4: Run targeted validation**

Run: `npm test -- __tests__/messageBubbleAndComposer.test.ts __tests__/analyticsEvents.test.ts`

Run: `npm run lint -- --file components/messages/MessageThread.tsx`

Run: `npm run typecheck`

Expected: all commands exit 0.

- [ ] **Step 5: Commit proof and validation updates**

```bash
git add docs/proof/message-attach-sheet-390x844.png e2e/messages-mobile.spec.ts
git commit -m "test(messages): capture mobile attach sheet proof"
```

### Task 4: Review, rebase, push, and open the pull request

**Files:**
- Modify: none unless review finds a required fix

- [ ] **Step 1: Check memory pressure before any full suite**

Run: `memory_pressure -Q`

If free memory is below 35 percent or another crewmate is running a full suite, run targeted suites only and report that constraint. Otherwise run the one permitted full validation command, `npm run verify`, once.

- [ ] **Step 2: Review the final diff**

Run: `git diff origin/main...HEAD --check` and inspect `git diff origin/main...HEAD`. Confirm no generated files or unrelated changes are included.

- [ ] **Step 3: Rebase immediately before opening the PR**

```bash
git fetch origin main
git rebase origin/main
```

Re-run the focused test and typecheck after the rebase.

- [ ] **Step 4: Push only the feature branch**

```bash
git push -u origin fm/fix-attach-sheet
```

- [ ] **Step 5: Open the pull request with screenshot evidence**

Use `gh-axi` to open a PR from `fm/fix-attach-sheet` to `main`. Include the problem, implementation, validation commands, and this relative image in the body:

```markdown
![Mobile message attachment sheet](docs/proof/message-attach-sheet-390x844.png)
```

- [ ] **Step 6: Append terminal status**

```bash
echo "done: PR {url}" >> '/Users/karanmanoharan/karan-agent-workspace/state/fix-attach-sheet.status'
```
