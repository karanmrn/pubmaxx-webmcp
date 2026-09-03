# Root Landing Mobile Primary Action

Status: ready for implementation on 2026-08-15.

## Goal

Let `Find my pint` own attention on PUBMAXX root landing while keeping full app
navigation after a user enters Near, Map, Plan, or any other product route.

## Route contract

- Exact pathname `/` renders no `MobileTabBar` DOM.
- Root query strings do not change that decision.
- Every non-root pathname keeps the app tab navigation the shared navigation
  model owns (`components/nav/navigationModel.ts`).
- `Find my pint` stays the only button-shaped hero action and keeps
  `/near?locate=1` as its destination.
- Existing Map and Plan text links, copy, analytics, and hero layout stay
  unchanged.

## Layout contract

- Non-root mobile routes reserve the same bottom clearance through the temporary
  `.mobileTabBarClearance` fallback before hydration and `MobileTabBar` after it
  mounts. Exact root renders neither.
- Root landing footer reserves its normal spacing and safe-area inset, not the
  64px app-tab allowance.
- Route loading shells keep their existing app-tab allowance.
- Do not use CSS-only hiding. Root must not run tab warmups or expose hidden
  navigation to assistive technology.
- No horizontal overflow at 320, 390, or 430 CSS pixels.

## Implementation shape

- Export one pure exact-path decision for unit proof.
- Keep `MobileTabBar` as a pathname wrapper.
- Move existing hooks and render logic into a child mounted only for non-root
  paths. This keeps hook order valid and prevents root warmups.
- Gate body clearance with actual `.mobileTabBarClearance` or `.mobileTabBar`
  presence.

## Verification

- Unit: `/` and root query state hide the bar; `/near`, `/map`, `/plan`, and
  governed public routes keep it; the model's tab order stays fixed.
- Browser: root has no Primary app navigation or tab-bar body allowance at
  320, 390, and 430 pixels. Hero action remains at least 44 by 44 pixels, stays
  visible, and creates no overflow.
- Handoff: one tap reaches `/near?locate=1`, then full Primary app navigation
  is visible.
- Desktop: root stays free of mobile navigation and preserves current layout.
- Full: focused lint, typecheck, `git diff --check`, `npm run verify`, then exact
  production Playwright gate.

## Out of scope

- New landing copy, analytics, CTA treatment, sticky controls, or feature flags.
- Changes to app-route tab order, Moment treatment, or navigation destinations.
