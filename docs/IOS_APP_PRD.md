# PUBMAXXING iPhone App - Product Requirements (v1)

**Status:** For Sol's review. Enables the app BUILD today (owner installs Xcode; free personal-team signing) with **paid Apple Developer enrollment deferred**.
**Author:** Fable 5 (architect/reviewer — no inline execution).
**Date:** 2026-07-18.
**Scope:** London-only v1. Every claim below is grounded in the repo; file references are inline.

> **Historical implementation snapshot.** This PRD records the 18 July review
> state and is not the current build ledger. Since then, F1-F3 have landed,
> the prompt-orchestration contract and implementation have landed, A2HS is
> suppressed inside the native shell, and Android is also scaffolded. A genuine
> first native launch opens guarded `/onboarding`; later cold starts open
> `/tonight`, while a later in-session Home visit may reach `/`. F4 (real Team
> ID + Associated Domains) remains owner-blocked. APNs and FCM delivery still
> need owner credentials, signed builds, and physical-device proof.
> Use `docs/CAPACITOR_WRAP.md`, `docs/STORE_READINESS.md`, and
> `docs/superpowers/plans/2026-08-27-ios-android-release-readiness.md` for
> current build and release truth.

Source branches read for this PRD (all open, none merged — Sol's queue):
- `#295` `feat/capacitor-ios-wrap` — shell, seams, `ios/` scaffold, push-token API + migration, AASA. Base of the native stack.
- `#299` `feat/native-first-run` (stacked on #295) — first-run redirect + contextual push prompt.
- `#300` `feat/push-senders` (stacked on #295) — server-side send pipeline behind an APNs-ready seam.
- `#312` `feat/identity-nudges`, `#313` `feat/a2hs-flow` — the two other interruptive-prompt surfaces the app must coordinate with.
- `docs/merge-order-matrix` → `docs/MERGE_ORDER_2026-07-18.md` (PR #316) — the executable merge plan ("MERGE_ORDER v2").
- `fable-implement-prd.md` — session decision log + PR queue.
- Grounding runbook: `docs/CAPACITOR_WRAP.md` (present on #295/#299/#300).

---

## 1. Product definition

**The iPhone app IS the mobile-web THE LOCAL / near-me experience, wrapped in a native shell, given three native superpowers.** It is not a reimplementation. The persona is unchanged from the mobile-web loop (`fable-implement-prd.md`): *a 9-to-5 worker leaving the office, any night, who wants a cheap good pint near where they are* and needs open → answer in seconds.

The three native superpowers the shell adds on top of the site:

1. **Real camera** — moment capture goes through `@capacitor/camera` instead of the WKWebView file-input (`lib/nativeCamera.ts`, wired into `components/moment/MomentCapture.tsx`). The web `capture="environment"` attribute is unreliable inside WKWebView; the native path returns a `File` shaped exactly like a file-input selection, so the rest of the moment pipeline is unchanged.
2. **Push** — device-token registration today (`lib/nativePush.ts` → `POST /api/push-tokens`), server-side delivery behind an APNs-ready seam (`lib/pushProvider.ts`, `lib/pushSender.ts`). The launch payload is the **night-signal "went live" broadcast** (`broadcastNightSignalLive()`), the only push that can send pre-identity (see §2).
3. **Home-screen presence** - a real App Store icon and one entry policy. A genuine first native launch opens the guarded `/onboarding` route. Later cold starts open `/tonight`; a later in-session Home visit can reach the landing page. `lib/entryDecision.ts`, `lib/nativeFirstRun.ts`, and `components/native/AppEntryRoute.tsx` own this behavior.

**What v1 deliberately is NOT:**
- **No offline app rebuild.** The shell loads `https://pubmaxxing.com` live (remote-URL mode). There is no bundled copy of the product. `native/web-stub/offline.html`, wired through `server.errorPath`, gives an honest retry surface when the first production load fails.
- **No separate native UI.** No SwiftUI screens, no native navigation, no native map. Native code stays limited to the Capacitor shell and bridge glue, including APNs forwarding in `AppDelegate.swift`. Every product screen is the same server-rendered React the web serves.
- **No multi-city.** London only. Wave-2 nine-city and Wave-4 Pub Pal voice are deferred (`fable-implement-prd.md` decision 3).
- **No new product surface.** The app ships no feature the site doesn't already have; it upgrades three interaction points (camera, push, first-run) and adds an install identity.

---

## 2. Architecture as built

### 2.1 Remote-URL Capacitor shell — and why no static export

The Next.js app is **server-rendered** (App Router, API routes, per-request data). There is no `next export`. So the shell runs in **remote-URL mode**: `capacitor.config.ts` sets `server.url: "https://pubmaxxing.com"` and the WKWebView loads the live origin.

```ts
// capacitor.config.ts (#295)
const config: CapacitorConfig = {
  appId: "com.pubmaxx.app",
  appName: "PUBMAXXING",
  webDir: "native/web-stub",
  server: {
    url: "https://pubmaxxing.com",
    errorPath: "offline.html",
  },
};
```

`webDir` must point at a real directory to satisfy the CLI's copy step, but pointing it at `public/` would bake ~6 MB of datasets/screenshots into the binary as dead weight, so `native/web-stub/index.html` is a one-file placeholder that is never actually served (`docs/CAPACITOR_WRAP.md`).

`native/web-stub/offline.html` is the exception: Capacitor serves it through
`server.errorPath` after a failed first main-frame load. It contains no stale
product data.

Stack: **Capacitor 8.5**, **Next 16**, and **Swift Package Manager**
(`ios/App/CapApp-SPM`) - no CocoaPods.

### 2.2 The seam contract (the load-bearing invariant)

**No file imports `@capacitor/*` except the `lib/native*.ts` seam modules. Everything else branches on `isNativeApp()`.**

- `lib/nativePlatform.ts` — the *only* place `window.Capacitor` is probed. `isNativeApp()` is SSR-safe (false on the server) and false on the plain web. `nativePlatform()` returns `"ios" | "android" | null`.
- `lib/nativeCamera.ts`, `lib/nativePush.ts` — dynamically `import("@capacitor/...")` **only on the native path**, so the plugin code never lands in the web bundle. Web/SSR callers get a no-op / `null` and can call unconditionally.

Consequence: the web bundle is provably unaffected by the wrap. The same deploy of pubmaxxing.com serves both the browser and the shell; the shell just injects a `window.Capacitor` bridge before page scripts run, which flips every `isNativeApp()` branch on.

### 2.3 What each PR contributes

```
                        origin/main  (no native code — clean web app)
                             │
              ┌──────────────┴───────────────┐
              │  #295 feat/capacitor-ios-wrap │  ← native STACK BASE
              │  • capacitor.config.ts (remote-URL)
              │  • lib/nativePlatform / nativeCamera / nativePush.ts
              │  • ios/ scaffold (SPM, stock AppDelegate + storyboards)
              │  • POST /api/push-tokens + lib/pushTokenStore.ts
              │  • migration 0039_push_tokens
              │  • public/.well-known/apple-app-site-association (TEAMID placeholder)
              │  • MomentCapture.tsx wired to native camera
              └──────────────┬───────────────┘
                 ┌───────────┴────────────┐
    #299 feat/native-first-run     #300 feat/push-senders
    (stacked on #295)              (stacked on #295)
    • lib/nativeFirstRun.ts        • lib/pushProvider.ts  (noop | apns seam)
      (root→onboarding, once)      • lib/pushSender.ts    (fan-out, prune, dedup)
    • lib/nativePushPrompt.ts      • broadcastNightSignalLive() — the launch push
    • components/native/           • notifyPlanUpdate() — DORMANT (no identity)
      NativePushPrompt.tsx
```

Two adjacent (non-stacked) prompt surfaces the shell must coordinate with:
- `#312 feat/identity-nudges` — sign-in offers after first plan action / first moment draft.
- `#313 feat/a2hs-flow` — install prompt (`lib/a2hsPrompt.ts`, `lib/promptBudget.ts`, `components/pwa/A2HSInstallPrompt.tsx`).

### 2.4 Prompt orchestration (identity > push > A2HS)

Three interruptive prompts can become eligible around the same session. Current source enforces **location or map first-visit arrival > analytics consent > identity > push > A2HS** through `docs/PROMPT_ORCHESTRATION.md` and `lib/promptBudget.ts`:
- **The push gate already defers structurally.** `lib/nativePushPrompt.ts` never fires at boot — iOS' permission dialog is one-shot, so it waits for the first *meaningful* plan action (join / start / confirm), shows an in-app explainer first, and only "Enable" calls `registerNativePush()`. "Later" re-offers only after the *next* qualifying action (monotonic action-sequence gate).
- **A2HS has its own proven-value gate** (`lib/a2hsPrompt.ts`: second distinct day OR one completed night), uses the shared per-session budget, and classifies a Capacitor shell as already installed.

The shared budget is adopted by the tour, analytics consent, identity nudge,
native push, web push, and A2HS surfaces. `PlanCrew` also encodes the same-tap
identity-before-push rule explicitly. These are source guarantees only until a
wrapped runtime pass exercises them.

---

## 3. Build-today path (no paid Apple account)

Goal: get PUBMAXXING booting in the iOS Simulator and on the owner's own iPhone **today**, using a **free Apple ID personal team**. No enrollment, no $99.

This section preserves the original branch-integration sequence. Current source
already contains the camera permission strings, APNs forwarding, prompt
orchestration, native A2HS suppression, and guarded entry policy. Compile,
signing, and device results remain unproved.

### 3.1 Merge prerequisites

Per `docs/MERGE_ORDER_2026-07-18.md`, the native stack lands **last** in the queue (step 28 `#295` → 29 `#299` → 30 `#300`), after `fix/prompt-orchestration` (step 22), `#312` (24) and `#313` (25). Two honest build targets:

- **Minimal buildable shell (today, lowest risk):** merge **`#295` only**. This gives boots-on-device + real camera + remote-URL shell + AASA scaffold. First-run routing, push prompt, and A2HS suppression are absent. Sufficient to prove the wrap works end-to-end.
- **Full v1 per the §6 acceptance criteria:** requires the native cluster **plus** its prompt neighbours — `#295`, `#299`, `#300`, `#312`, `#313`, and `fix/prompt-orchestration`. Because the native stack sits at the tail of a 30-step queue with three conflict clusters, the pragmatic path is to run the MERGE_ORDER top-to-bottom; the acceptance criteria cannot all be met from `#295` alone.

### 3.2 Ordered steps

1. **Land the prerequisite PRs** (§3.1) on `main` via `MERGE_ORDER_2026-07-18.md`. Sol executes; Fable never merges.
2. **Owner installs full Xcode** (App Store, not just Command Line Tools). Confirm `xcode-select -p` points at `…/Xcode.app`, not `…/CommandLineTools` — Capacitor's `cap open ios` and the SPM build both require it (`docs/CAPACITOR_WRAP.md`).
3. `npm install` — installs `@capacitor/{core,cli,ios,camera,push-notifications}`.
4. **Verify the committed camera usage strings.** `ios/App/App/Info.plist` already carries `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`. `NSPhotoLibraryAddUsageDescription` is deliberately absent because the capture seam does not save to the gallery.
5. `npx cap sync ios` — refreshes plugins + `capacitor.config.ts` into `ios/`.
6. `npx cap open ios` — opens `ios/App` in Xcode.
7. **Free personal-team signing** — App target → Signing & Capabilities → uncheck nothing, select the owner's personal Apple ID as Team ("Personal Team"), confirm bundle id `com.pubmaxx.app`. Xcode auto-manages a development cert. (Personal teams cannot add the Push Notifications or Associated Domains entitlements — see expected gaps.)
8. **Run on the Simulator** — the app boots, loads pubmaxxing.com, the full THE LOCAL loop works. Camera on Simulator has no hardware; `CameraSource.Prompt` falls back to the photo library — enough to exercise the native path.
9. **Run on the owner's own iPhone** — free personal-team provisioning signs to a physically-connected device (7-day cert; re-sign weekly). Real camera works here.

### 3.3 Expected gaps at the free-account stage (all honest, all expected)

| Superpower | Free personal team | Why |
|---|---|---|
| Remote-URL shell + full site loop | ✅ source-ready | Runtime proof still needs Xcode, Simulator, and device checks. |
| Real camera capture | ✅ source-ready | Usage strings and camera seam are committed; physical-device capture is unproved. |
| Home-screen icon + entry policy | ✅ source-ready | First eligible native launch opens guarded `/onboarding`; later cold starts open `/tonight`. |
| A2HS behavior inside shell | ✅ source-ready | `isNativeAppShell()` classifies the installed Capacitor shell as standalone, so the install prompt stays hidden. |
| **Push delivery** | ❌ won't deliver | APNs requires a **paid** account for the entitlement + an APNs key; `selectPushProvider("ios")` stays on the `noopPushProvider` with no keys. Registration UI can be exercised but no notification arrives. |
| **Universal links** (`/plan/*`, `/rounds/*`, `/p/*`) | ❌ won't verify | AASA carries a `TEAMID` placeholder and Associated Domains needs a real Team ID; personal teams can't validate the entitlement. |

---

## 4. Paid-account activation checklist (later)

When the owner enrolls (the longest pole, per `fable-implement-prd.md` owner queue):

1. **Enroll** in the Apple Developer Program ($99/yr). Obtain the **Team ID**.
2. **APNs Auth Key** — create an APNs key in the developer portal; note `APNS_KEY_ID` and the `.p8` private key.
3. **Server env vars** - set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, and `APNS_ENV` together. Use `APNS_ENV=production` for TestFlight and App Store production tokens. Use `APNS_ENV=sandbox` only for development-signed sandbox tokens. A configured send with missing or invalid `APNS_ENV` fails closed instead of guessing a host. Never commit the `.p8` key.
4. **Verify `apnsPushProvider.send()`** - the HTTP/2 transport, ES256 provider JWT, payload mapping, invalid-token pruning, and night-signal fan-out are implemented. Live delivery still needs the owner APNs key, entitlement, signed build, and physical-device receipt proof.
5. **AASA Team ID** — replace `TEAMID` in `public/.well-known/apple-app-site-association` with the real Team ID (final appID `TEAMID.com.pubmaxx.app`), deploy, and verify `https://pubmaxxing.com/.well-known/apple-app-site-association` returns `Content-Type: application/json` (header rule in `next.config.mjs`).
6. **Xcode capabilities** — add **Push Notifications** and **Associated Domains** (`applinks:pubmaxxing.com`) to the App target.
7. **Verify AppDelegate APNs forwarding** - committed `ios/App/App/AppDelegate.swift` forwards `didRegisterForRemoteNotificationsWithDeviceToken` and `didFailToRegisterForRemoteNotificationsWithError` to Capacitor. It remains unproved until Xcode compiles the shell and a signed device registers.
8. **TestFlight** — archive, upload, internal testing.
9. **Review-readiness (Apple's thin-wrapper bar).** Apple rejects apps that are "just a website." Our three superpowers are the answer, and they must be demonstrably live at review time: **real camera** capture in moments, **push** notifications (night-signal go-live), and **universal links** that deep-link `/plan`, `/rounds`, `/p` into the app. Guarded first-run onboarding, later `/tonight` cold starts, and home-screen identity reinforce that this is an app, not a bookmark. Do not submit for review until push actually delivers (step 4) and universal links verify (step 5-6), or the thin-wrapper rejection is likely.

---

## 5. Risks + open decisions for Sol / owner

**Risks**

- **Remote-URL shell still depends on production.** The bundled `offline.html` prevents a raw WebView failure and offers retry, but it is not an offline product copy. Product features remain unavailable while production is unreachable.
- **iOS WKWebView quirks worth a dedicated QA pass:** safe-area insets on notch devices, momentum/rubber-band scroll vs. the map's own gestures, the one-shot geolocation permission prompt (near-me), file-input vs. native-camera handoff, `100vh` keyboard behaviour, and pull-to-refresh. None are blockers; all deserve a device pass.
- **Version skew between shell and site.** The shell is a fixed binary; the site deploys continuously. A site change that assumes `window.Capacitor` semantics, or that breaks the `isNativeApp()` branches, ships to shell users instantly with no app update. Keep the seam contract (§2.2) as a review gate.
- **Push delivery still needs owner proof** (§4 step 4) - source transport exists, but APNs credentials, entitlement, signed build, and physical receipt remain required.

**Current unresolved owner gates**

- Replace the AASA `TEAMID` placeholder with the real Apple Team ID.
- Add Push Notifications and Associated Domains entitlements through the signed Xcode project.
- Supply APNs credentials without committing secrets.
- Complete Xcode compile, signed-device camera and push receipt, universal-link return, TestFlight, and store proof.
- Keep Android Firebase configuration, signing fingerprint, App Links, credentials, and device proof tracked in `docs/CAPACITOR_WRAP.md` and `docs/STORE_READINESS.md`.

The older F1-F3 findings are closed in source: native A2HS suppression, APNs
forwarding, and camera permission strings are present. Prompt orchestration now
has both `docs/PROMPT_ORCHESTRATION.md` and adopted source seams. None of these
source checks replace wrapped runtime proof.

---

## 6. Acceptance criteria — "app v1 built"

v1 is "built" when, on the merged native cluster (§3.1 full target):

1. **Boots on Simulator and on a physical device** via free personal-team signing; the app opens and loads pubmaxxing.com in the WKWebView with no error screen.
2. **The map loop works** end-to-end inside the shell — near-me answer, map pan/tap, venue sheets, prices (the same server-rendered surfaces the web serves; `isNativeApp()` branches do not degrade them).
3. **Moment capture uses the native camera** - the moment composer's picker routes through `captureNativePhoto()` (`lib/nativeCamera.ts`) inside the shell, returns a `File`, and the existing upload pipeline is unchanged. Required iOS usage strings are committed.
4. **First-run follows the owner-locked entry policy** - a genuinely first-time native launch with no persisted city preference opens guarded `/onboarding` exactly once. Later cold starts open `/tonight`; a later in-session Home visit may reach `/`; deep links keep their destination.
5. **Prompts obey orchestration** - shared budget and explicit same-tap priority prevent interruptive surfaces from stacking. Runtime proof must still confirm the source contract inside the shell.
6. **A2HS is suppressed inside the shell** - the "Add to Home Screen" prompt never appears because the native bridge is classified as already installed.

Criteria 3-6 are implemented in source. Criteria 1-2 and all credential,
entitlement, signed-device, delivery, and store claims remain unproved until the
owner-gated runtime checks complete.
