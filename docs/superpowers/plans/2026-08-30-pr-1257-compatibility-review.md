# PR 1257 Compatibility Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix strict TypeScript test errors, support account-bound request cancellation on Safari 16.4 through 17.3, and keep expected Social Post submission aborts silent.

**Architecture:** Keep native `AbortSignal.any` as first choice. When it is absent, use one source listener plus weak dependent-signal references so provider and caller cancellation retain first-reason semantics through the native response-body lifetime without wrapping `Response` or using finalizers. Social Composer classifies `AbortError` as expected cancellation while other failures keep existing user feedback.

**Tech Stack:** TypeScript, React 19, DOM Abort APIs, Vitest, jsdom

**Spec:** `AGENTS.md` and delegated PR #1257 review findings

## Global Constraints

- Support Safari 16.4 through 17.3, where `AbortSignal.any` is absent.
- Keep provider and caller cancellation active through response-body reads.
- Preserve first abort reason.
- Do not wrap `Response` and do not use finalizers.
- Keep native `AbortSignal.any` preferred when present.
- Run only focused serial tests and targeted static checks.
- Preserve protected untracked paths.

---

### Task 1: Account-bound abort fallback

**Files:**
- Modify: `__tests__/authedFetch.test.ts`
- Modify: `lib/authedFetch.ts`

**Interfaces:**
- Consumes: provider revision `AbortSignal`, Request signal, and `RequestInit.signal`
- Produces: `compositeActionSignal(signals): AbortSignal` with native-first and weak fallback paths

- [x] **Step 1: Write failing fallback tests**

Temporarily replace `AbortSignal.any` with `undefined`. Start account-bound requests, keep returned native responses, abort caller or rotate provider, and assert signal/body rejection uses first abort reason.

- [x] **Step 2: Run tests to verify RED**

Run: `vitest run __tests__/authedFetch.test.ts --maxWorkers=1`

Expected: FAIL because `AbortSignal.any` is not a function.

- [x] **Step 3: Implement minimal fallback**

Use `WeakMap<AbortSignal, AbortController>` to retain a controller only while its dependent signal is reachable. Store `WeakRef<AbortSignal>` followers behind one listener per source signal, prune dead followers on registration, remove cross-source registrations on first abort, and call `controller.abort(abortReason(source))`.

- [x] **Step 4: Repair strict test signal captures**

Read passed signals from `fetchSpy.mock.calls` and `transport.authedActionFetch.mock.calls` after calls occur. Do not rely on callback assignments that TypeScript narrows to `null` or `never`.

- [x] **Step 5: Run focused tests to verify GREEN**

Run: `vitest run __tests__/authedFetch.test.ts __tests__/socialAccountBoundary.test.tsx --maxWorkers=1`

Expected: PASS.

### Task 2: Provider revision callback order

**Files:**
- Modify: `__tests__/authProviderRevision.test.ts`

**Interfaces:**
- Consumes: `createProviderIdentityRevisionStore()`
- Produces: regression proof that old signal abort and new live signal rotation occur before subscriber notification

- [x] **Step 1: Strengthen test**

Inside subscriber callback, record old signal state, current signal identity, current signal state, and revision. Expect abort first, rotation second, notification last.

- [x] **Step 2: Run focused test**

Run: `vitest run __tests__/authProviderRevision.test.ts --maxWorkers=1`

Expected: PASS without production change unless callback order regressed.

### Task 3: Social Composer submission abort

**Files:**
- Modify: `__tests__/socialComposerAbort.test.tsx`
- Modify: `app/social/SocialComposer.tsx`

**Interfaces:**
- Consumes: `authedActionJson` rejection
- Produces: silent expected cancellation and existing alert for network failure

- [x] **Step 1: Write failing submit-abort test**

Open composer, enter body, submit, reject with `DOMException(..., "AbortError")`, and assert no raw abort feedback appears. Retry with `TypeError("network failed")` and assert user-facing failure remains.

- [x] **Step 2: Run test to verify RED**

Run: `vitest run __tests__/socialComposerAbort.test.tsx --maxWorkers=1`

Expected: FAIL because submit renders raw abort text.

- [x] **Step 3: Implement minimal catch branch**

In `submit`, return from catch when an object has `name === "AbortError"`. Do not depend on a same-realm `Error` prototype. Keep `finally` so busy state clears.

- [x] **Step 4: Remove unused transport mock results and run GREEN**

Delete unused `authedActionFetch` mock setup. Run focused Social Composer test and expect PASS.

### Task 4: Verification and delivery

**Files:**
- Review all changed files from Tasks 1 through 3

**Interfaces:**
- Consumes: repository scripts and git state
- Produces: verified commit on PR branch

- [x] **Step 1: Run focused tests serially**

Run focused auth transport, provider revision, Social Composer, and Social account-boundary Vitest files with one worker.

- [x] **Step 2: Run targeted ESLint**

Run ESLint only for touched TypeScript and TSX files.

- [x] **Step 3: Run available strict type check**

Use repository TypeScript binary only if present. Do not install dependencies. If unavailable, report that typecheck was not run and use targeted lint plus test compilation evidence.

- [x] **Step 4: Check patch integrity**

Run `git diff --check`, inspect `git diff`, confirm protected untracked paths remain, and confirm no generated file changed.

- [ ] **Step 5: Commit and push**

Commit only intended files and push without force.
