# Full Spirits and Drinks Taxonomy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users refine existing drink-category filters to common one-level subtypes and known top-shelf pours without widening or breaking the closed nine-category contract.

**Architecture:** Keep `DrinkCategory` and persona validation unchanged. Add a browser-safe subtype registry whose entries point to one existing category, carry ordered text signals, and optionally derive from known brands. Store selected subtype and top-shelf state as orthogonal `Filters` fields, then apply them alongside existing category, price, and zone predicates. Expose refinements only after a category is active.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Vitest, Playwright, MapLibre, CSS.

## Global Constraints

- Existing `DRINK_CATEGORIES` remains the same closed nine-item union.
- Taxonomy has exactly one subtype level and no subtype children.
- Persona validation continues to validate only top-level categories.
- Mobile top-level chip strip remains unchanged at rest.
- Subtype, price, and zone filters compose through logical AND.
- `components/map/canvas/` changes stay limited to a glyph-category lens if compilation requires one.
- Never modify generated files manually.

---

### Task 1: Rebase Prior Work on Current Main

**Files:**
- Preserve: all existing uncommitted taxonomy files
- Integrate: current `main`, including clustering and persona changes from PRs #612 and #613

**Interfaces:**
- Consumes: uncommitted worktree state on `fm/spirits-taxonomy`
- Produces: conflict-resolved branch based on current `main`

- [ ] **Step 1: Save current worktree state**

Run:

```bash
git stash push --include-untracked -m "fm spirits taxonomy before main integration"
```

- [ ] **Step 2: Merge current main**

Run:

```bash
git merge --no-edit main
```

- [ ] **Step 3: Restore taxonomy work**

Run:

```bash
git stash pop
```

- [ ] **Step 4: Resolve conflicts without broad canvas edits**

Keep PR #612 clustering implementation authoritative. Reapply taxonomy only outside `components/map/canvas/`, except a minimal category glyph lens if required.

- [ ] **Step 5: Remove generated-file noise**

Restore `next-env.d.ts` to repository state. Next.js owns this file.

### Task 2: Taxonomy and Keyword Classification

**Files:**
- Create: `lib/drinkSubtypes.ts`
- Modify: `lib/drinkCategoryFromText.ts`
- Test: `__tests__/drinkSubtypes.test.ts`
- Test: `__tests__/drinkCategoryFromText.test.ts`

**Interfaces:**
- Consumes: `DrinkCategory`, `DRINK_CATEGORIES`, drink-brand normalization
- Produces: `DrinkSubtype`, `DRINK_SUBTYPES`, `subtypesForCategory`, `parseDrinkSubtypeParam`, `drinkSubtypeFromText`, `haystackMatchesSubtype`, `haystackIsTopShelf`, and richer ordered text classification through `lib/drinkCategoryFromText.ts`

- [ ] **Step 1: Add failing contract tests**

Test literals including:

```typescript
expect(drinkSubtypeFromText("Black rum")?.id).toBe("rum-dark");
expect(drinkSubtypeFromText("Japanese whisky")?.id).toBe("whisky-japanese");
expect(drinkSubtypeFromText("GUINNESS", "beer")?.id).toBe("beer-stout");
expect(DRINK_CATEGORIES).toHaveLength(9);
```

Also test conflicting category pins, unknown subtype IDs, word boundaries, and representative exact strings from `data/pint_prices_app_dataset.csv`.

- [ ] **Step 2: Run tests and verify expected RED**

Run:

```bash
npx vitest run __tests__/drinkSubtypes.test.ts __tests__/drinkCategoryFromText.test.ts
```

Expected: missing subtype registry or richer classifier assertions fail.

- [ ] **Step 3: Implement shallow registry and ordered mapper**

Every entry has a globally unique `${category}-${slug}` ID, one `DrinkCategory`, labels, and ordered tokens. More specific tokens precede broader ones. Top-shelf matching uses explicit premium language and known brands only.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
npx vitest run __tests__/drinkSubtypes.test.ts __tests__/drinkCategoryFromText.test.ts
```

Expected: all tests pass.

### Task 3: Filter State, Persistence, URLs, and Venue Predicates

**Files:**
- Modify: `lib/venues.ts`
- Modify: `lib/crawlUrl.ts`
- Modify: `lib/mobileShell.ts`
- Modify: `components/map/ControlRail.tsx`
- Test: `__tests__/venues.test.ts`
- Test: `__tests__/venuesSlim.test.ts`
- Test: `__tests__/crawlUrl.test.ts`
- Test: relevant mobile-session tests

**Interfaces:**
- Consumes: subtype lookup and top-shelf predicates from Task 2
- Produces: `Filters.drinkSubtype`, `Filters.topShelfOnly`, URL keys `sub` and `topshelf`, backward-compatible saved-session upgrade

- [ ] **Step 1: Add failing filter-composition tests**

Cover subtype plus price, subtype plus category, mismatched subtype/category, unknown subtype, and top-shelf false-positive avoidance:

```typescript
expect(filterVenues(pubs, makeFilters({
  drinkCategory: "beer",
  drinkSubtype: "beer-stout",
  maxPrice: 4,
}))).toHaveLength(0);
```

- [ ] **Step 2: Add failing URL and persistence tests**

Verify `drink=rum&sub=rum-dark&topshelf=1` round-trips, bare `sub` supplies its parent, conflicting subtype is rejected, and old saved filters upgrade with both new fields off.

- [ ] **Step 3: Run focused tests and verify RED**

Run:

```bash
npx vitest run __tests__/venues.test.ts __tests__/venuesSlim.test.ts __tests__/crawlUrl.test.ts
```

- [ ] **Step 4: Implement minimal state and predicates**

Subtype match order:

```typescript
valid explicit filterHints.drinkSubtypes
  ?? matching known brand subtype
  ?? category-pinned menu/price text match
```

Unknown subtype fails closed. A valid subtype from a different active category is ignored as stale UI state. Top shelf matches known evidence only.

- [ ] **Step 5: Verify GREEN**

Run the focused test command again and require zero failures.

### Task 4: Progressive Mobile UI and Backward-Compatible Category Lens

**Files:**
- Modify: `components/map/DrinkShapeChips.tsx`
- Modify: `components/map/MapToolbar.tsx`
- Modify: `components/PubMap.tsx`
- Modify: `components/map/mapToolbar.css`
- Modify: `components/mobile/mobileMapShell.css`
- Test: `__tests__/drinkShapeChips.test.ts`

**Interfaces:**
- Consumes: `subtypesForCategory`, active `Filters`
- Produces: unchanged top-level chips plus conditional subtype row and top-shelf toggle

- [ ] **Step 1: Add failing state-transition tests**

Verify category changes clear stale subtype, selecting subtype sets its parent, repeated selection toggles only subtype off, and top-shelf toggles independently.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
npx vitest run __tests__/drinkShapeChips.test.ts
```

- [ ] **Step 3: Implement conditional refinement row**

Render the existing nine category chips unchanged. Only after a category selection, render that category's one-level subtype chips plus top-shelf toggle. Keep category selection as source for existing glyph and persona paths.

- [ ] **Step 4: Constrain mobile layout**

Use independent horizontal scrolling in toolbar and wrapping controls in the mobile filter sheet. Require `min-width: 0`, bounded width, visible keyboard focus, and mobile touch targets.

- [ ] **Step 5: Verify GREEN**

Run focused tests again and require zero failures.

### Task 5: End-to-End Mobile Acceptance and Full Verification

**Files:**
- Modify tests only if a newly reproduced regression needs coverage

**Interfaces:**
- Consumes: complete Tasks 1-4 implementation
- Produces: evidence for 390x844 mobile acceptance, clean project checks, committed branch

- [ ] **Step 1: Run focused tests**

```bash
npx vitest run __tests__/drinkSubtypes.test.ts __tests__/drinkCategoryFromText.test.ts __tests__/drinkShapeChips.test.ts __tests__/venues.test.ts __tests__/venuesSlim.test.ts __tests__/crawlUrl.test.ts
```

- [ ] **Step 2: Run compiler and lint**

```bash
npm run typecheck
npm run lint
```

- [ ] **Step 3: Run full pre-push gate**

```bash
npm run verify
```

- [ ] **Step 4: Exercise real mobile UI**

Start `npm run dev`, open `/map` at a 390x844 viewport through `chrome-devtools-axi`, select Rum then Dark and Whisky then Japanese, and verify no horizontal page overflow, progressive disclosure, filter state, and coexistence with price and zone controls.

- [ ] **Step 5: Review diff and project instructions**

Confirm `DRINK_CATEGORIES` and persona validation remain unchanged, no generated file is modified, no unintended `components/map/canvas/` file changed, and AGENTS.md maintenance requirement is satisfied.

- [ ] **Step 6: Commit**

```bash
git add <explicit taxonomy files>
git commit -m "feat(drinks): add subtype taxonomy filters"
```
