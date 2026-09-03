# Dark Mode and Caption Wrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve full claim qualifiers at phone widths and give landing, map, and venue sheet deliberate, accessible dark-mode contrast.

**Architecture:** Audit each truncation rule by semantic role, then remove clipping only from claim-bearing copy while retaining bounded identity labels. Extend existing shared theme tokens for dark surfaces and states, using component overrides only where a surface has a distinct material role. Lock behavior with browser assertions at 390px and 430px, plus focused CSS contract tests where token ownership is the contract.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS custom properties, Vitest, Playwright, Chrome DevTools.

## Global Constraints

- Do not change caption wording.
- Do not restructure components or rename classes.
- Stay in stylesheets and use component markup only when wrapping requires it.
- Do not touch postcode data, account identity work, server routes, or theme-switcher behavior.
- Measure contrast and geometry before recording numeric claims.
- Keep pub and area names truncated where truncation remains semantically safe.
- Commit caption safety and dark-mode styling as separate coherent pieces.

---

### Task 1: Claim Caption Safety

**Files:**
- Modify: claim-bearing CSS rules found by `rg -l 'text-overflow|ellipsis|-webkit-line-clamp' components app`
- Create: `e2e/price-caption-integrity.spec.ts`
- Modify: `__tests__/mobileChromeFit.test.ts` only if an existing CSS ownership contract needs extension

**Interfaces:**
- Consumes: existing caption strings and rendered landing, map, and venue-sheet DOM
- Produces: in-flow wrapped captions with unchanged `textContent` and no overlap at 390px or 430px

- [ ] **Step 1: Write failing browser assertions**

Add a Playwright helper that reads each target element's `textContent`, compares it with the full expected literal, and rejects clipping styles:

```ts
async function expectFullCaption(locator: Locator, expected: string): Promise<void> {
  await expect(locator).toHaveText(expected);
  const state = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      text: element.textContent,
      overflow: style.overflow,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
      lineClamp: style.getPropertyValue("-webkit-line-clamp"),
    };
  });
  expect(state.text).toBe(expected);
  expect(state.textOverflow).not.toBe("ellipsis");
  expect(state.lineClamp).toBe("none");
  expect(state.whiteSpace).not.toBe("nowrap");
}
```

Run at `{ width: 390, height: 844 }` and `{ width: 430, height: 932 }`. Add geometry checks proving the next in-flow sibling starts at or below the caption's bottom edge and fixed mobile chrome does not cover the caption.

- [ ] **Step 2: Run test against unfixed code**

Run:

```bash
npx playwright test e2e/price-caption-integrity.spec.ts --project=chromium
```

Expected: FAIL on at least one full qualifier because computed CSS uses ellipsis, nowrap, hidden overflow, or a line clamp.

- [ ] **Step 3: Audit each truncation owner**

For each selector returned by the inventory command, trace its rendered string. Classify it as:

```text
identity label: may remain truncated
bounded user excerpt with full destination: may remain clamped
claim qualifier, date, source, status, or condition: must wrap in full
```

Record selector, decision, and reason for commit message.

- [ ] **Step 4: Apply minimal wrapping changes**

For claim-bearing selectors, remove ellipsis or line clamps and use:

```css
white-space: normal;
overflow-wrap: break-word;
```

Remove fixed heights or grid constraints that prevent container growth. Preserve truncation for pub names, handles, area labels, and bounded excerpts whose shortened form remains honest.

- [ ] **Step 5: Run focused and browser checks**

Run:

```bash
npm test -- __tests__/mobileChromeFit.test.ts
npx playwright test e2e/price-caption-integrity.spec.ts --project=chromium
```

Expected: PASS at both widths, with exact full strings and clear geometry.

- [ ] **Step 6: Commit**

Commit caption CSS and regression tests. Commit body must list each changed and retained truncation selector with one-line rationale.

### Task 2: Dark Landing, Map, and Venue Sheet

**Files:**
- Modify: `app/theme.css`
- Modify: `app/globals.css` only for shared semantic token definitions
- Modify: `components/landing/landing.css`
- Modify: `components/map/mobileMapShell.css` or actual shipped map shell stylesheet if inspection identifies another owner
- Modify: `components/map/venueSheet.css`
- Modify: relevant map control stylesheets only for state-specific relationships not expressible through shared tokens
- Create or modify: focused dark-theme contract tests under `__tests__`

**Interfaces:**
- Consumes: `html[data-theme="dark"]`, shared semantic tokens, existing landing/map/sheet markup
- Produces: deliberate elevation, readable text, visible focus/disabled/placeholder/divider states, and intact price-band semantics

- [ ] **Step 1: Capture unfixed dark surfaces**

Run app with isolated `NEXT_DIST_DIR`, open landing, map, and selected venue sheet in Chrome at 390px and 430px, then record screenshots and computed styles for primary text, muted text, placeholders, controls, dividers, selected rows, hover rows, disabled controls, glass panels, and pin bands.

- [ ] **Step 2: Add failing theme contract tests**

Add tests for missing shared dark semantic roles and for each repeated relationship that should flow from one token. Expected failure: old tokens or component rules resolve to insufficient contrast or light-mode material tint.

- [ ] **Step 3: Measure baseline contrast**

Use computed foreground and composited background colours from Chrome. Calculate WCAG contrast with a deterministic script and retain exact input pairs. Do not record inferred values.

- [ ] **Step 4: Fix shared tokens first**

Define or retune shared dark tokens for:

```css
surface floor
raised card
overlay or sheet material
primary, secondary, muted, and placeholder text
neutral divider
focus ring
disabled foreground and surface
hover and selected surface
```

Use elevation through surface luminance and restrained top edges. Keep map-specific paint tokens separate from DOM chrome tokens.

- [ ] **Step 5: Apply distinct surface roles**

Wire landing, map chrome, and venue sheet to semantic tokens. Add scoped selectors only for truly distinct materials, translucent panels, or state ownership. Check focus, disabled, placeholder, divider, selected, hover, blur, and price-band states.

- [ ] **Step 6: Verify visual and numeric outcomes**

At 390px and 430px in dark mode, capture landing, map, and venue sheet. Re-read computed colours, calculate worst-case contrast ratios, and confirm AA at each touched text size. Check horizontal overflow and fixed-element obstruction.

- [ ] **Step 7: Run tests**

Run:

```bash
npm run lint
npm run typecheck
npm test
npx playwright test e2e/price-caption-integrity.spec.ts e2e/mobile-map-shell-matrix.spec.ts e2e/mobile-shared-sheet-layout.spec.ts --project=chromium
```

Expected: PASS with clean output.

- [ ] **Step 8: Commit**

Commit dark-mode tokens, surface styles, and tests. Commit body must include measured worst-case contrast ratios and explain shared-token changes.

### Task 3: Closeout Verification

**Files:**
- Review: complete branch diff
- Review: `AGENTS.md`

**Interfaces:**
- Consumes: two committed implementation pieces
- Produces: verified branch ready for firstmate validation

- [ ] **Step 1: Review shape and diff**

Confirm no caption copy, server route, postcode data, account identity code, generated file, or unrelated class name changed.

- [ ] **Step 2: Run project gate**

Run:

```bash
npm run verify
```

Expected: data validation, lint, typecheck, coverage, and resilient audit pass.

- [ ] **Step 3: Run project memory check**

Run:

```bash
/Users/karanmanoharan/karan-agent-workspace/bin/fm-ensure-agents-md.sh .
```

Keep `AGENTS.md` unchanged unless work produced durable guidance useful to future sessions.

- [ ] **Step 4: Report implementation complete**

Append:

```text
done: caption qualifiers wrap in full and dark landing, map, and venue sheet meet measured AA
```

Do not run the no-mistakes pipeline until firstmate requests it.
