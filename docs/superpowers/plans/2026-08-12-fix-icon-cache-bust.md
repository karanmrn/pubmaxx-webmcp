# Icon Cache Bust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every browser and PWA icon URL versioned, explicitly declare the versioned Apple touch icon, and preserve all legacy public icon paths.

**Architecture:** Keep existing icon bytes and `MARK_GEOMETRY` unchanged. Update the root Next metadata and static web manifest URL references, add one byte-identical renamed Apple touch icon for iOS cache invalidation, and cover the URL contract with a focused metadata test.

**Tech Stack:** Next.js Metadata API, static `public/manifest.webmanifest`, Vitest, TypeScript.

## Global Constraints

- Reuse existing icon assets byte-for-byte. Change URLs only.
- Prefer renamed path `apple-touch-icon-v2.png` for the Apple touch icon.
- Keep old public icon paths serving the same bytes.
- Version every favicon, icon, Apple touch icon, and manifest icon URL.
- Use British English in new prose.
- Run targeted tests, lint, and typecheck only.
- Immediately before the PR, run `git fetch origin main` and `git rebase origin/main`.

---

### Task 1: Lock icon URL behaviour with a regression test

**Files:**
- Create: `__tests__/rootIconMetadata.test.ts`
- Modify: `__tests__/brandIconAssets.test.ts`

**Interfaces:**
- Consumes: `metadata` from `app/layout.tsx` and JSON from `public/manifest.webmanifest`.
- Produces: Assertions that all root icon metadata URLs are versioned, the Apple touch icon uses `/apple-touch-icon-v2.png`, manifest icon sources are versioned, and the renamed Apple asset matches the existing bytes.

- [x] **Step 1: Write the failing test**

Assert that root metadata contains `/favicon.ico?v=2`, versioned favicon/icon entries, and an Apple touch icon URL of `/apple-touch-icon-v2.png`. Parse the manifest and assert every `icons[].src` contains `?v=2`. Read `public/apple-touch-icon-x.png` and `public/apple-touch-icon-v2.png` and assert byte equality.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `npx vitest run __tests__/rootIconMetadata.test.ts`

Expected: FAIL because current metadata and manifest use unversioned URLs and `public/apple-touch-icon-v2.png` does not exist.

### Task 2: Implement versioned icon URLs without changing geometry

**Files:**
- Modify: `app/layout.tsx`
- Modify: `public/manifest.webmanifest`
- Modify: `lib/brandIconAssets.mjs`
- Create: `public/apple-touch-icon-v2.png` as a byte-identical copy of `public/apple-touch-icon-x.png`

**Interfaces:**
- Consumes: Existing icon metadata entries and existing generated icon files.
- Produces: Versioned document links and manifest sources, plus a renamed Apple touch icon that serves the current coral X bytes.

- [x] **Step 1: Add the renamed Apple asset**

Copy `public/apple-touch-icon-x.png` to `public/apple-touch-icon-v2.png` and verify the two files have identical SHA-256 hashes.

- [x] **Step 2: Version the Next metadata URLs**

Add `?v=2` to every favicon/icon URL in `metadata.icons`, including the shortcut icon and dark favicon. Change `metadata.icons.apple[0].url` to `/apple-touch-icon-v2.png` while keeping its existing type and size.

- [x] **Step 3: Version every manifest icon source**

Add `?v=2` to every `icons[].src` value in `public/manifest.webmanifest`. Keep names, sizes, types, purposes, and existing asset paths unchanged.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `npx vitest run __tests__/rootIconMetadata.test.ts`

Expected: PASS with no warnings.

### Task 3: Validate served bytes and repository quality

**Files:**
- No additional files.

- [x] **Step 1: Check old and new asset responses**

Against the running app, request `/favicon.ico`, `/favicon-x.svg`, `/icon-x-192.png`, `/icon-x-512.png`, `/apple-touch-icon.png`, `/apple-touch-icon-x.png`, and `/apple-touch-icon-v2.png` with `curl -sSI`; each must return HTTP 200. Fetch old and new Apple touch icon bodies and compare SHA-256 hashes.

- [x] **Step 2: Capture browser head proof**

Use `chrome-devtools-axi` to inspect `document.head` and capture a screenshot showing the manifest, versioned favicon/icon links, and explicit versioned `apple-touch-icon` link.

- [x] **Step 3: Run targeted quality checks**

Run: `npx vitest run __tests__/rootIconMetadata.test.ts`, `npm run lint`, and `npm run typecheck`.

- [x] **Step 4: Re-read the diff and verify geometry unchanged**

Run `git diff --check`, inspect the diff, and compare hashes for the old/new Apple touch icon. Confirm no `MARK_GEOMETRY` or icon bytes changed.

- [ ] **Step 5: Rebase, commit, push, and open the PR**

Run `git fetch origin main`, `git rebase origin/main`, commit on `fm/fix-icon-cache-bust`, push that branch, and open a PR with `gh-axi`. Append `done: PR {url}` to the task status file.
