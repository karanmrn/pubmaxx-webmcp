# Android FCM Delivery Implementation Plan

> **For Codex:** Execute this plan in order. Keep all validation focused because this Mac has active swap pressure.

**Goal:** Deliver public native push notifications to stored Android registrations through Firebase Cloud Messaging without changing iOS APNs or installed-web VAPID delivery.

**Architecture:** Keep `push_tokens.platform` as transport authority. Add an FCM HTTP v1 provider behind the existing `PushProvider` interface, then group fan-out targets by stored platform before provider selection. Use a short-lived OAuth 2.0 access token minted from server-only service-account credentials. Treat only FCM-specific invalid registration responses as prune signals.

**Tech Stack:** Next.js 16 server modules, TypeScript, Node `crypto`, native `fetch`, Vitest, Capacitor 8 Push Notifications.

---

### Task 1: Pin FCM transport behavior

**Files:**
- Modify: `__tests__/pushProvider.test.ts`

1. Add failing tests for complete FCM configuration, RS256 service-account JWT claims, OAuth token reuse, HTTP v1 payload shape, sent delivery, invalid registration pruning status, and retryable provider errors.
2. Add a failing provider-selection test that maps `android` to an FCM-specific no-op when credentials are absent.
3. Run only the new FCM test cases and confirm they fail because the FCM symbols do not exist.

### Task 2: Implement FCM HTTP v1 provider

**Files:**
- Create: `lib/fcmPushProvider.ts`
- Modify: `lib/pushProvider.ts`

1. Add strict `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY_ID`, and `FCM_PRIVATE_KEY` configuration resolution.
2. Mint and cache short-lived OAuth tokens with the Firebase Messaging scope.
3. Send one HTTP v1 message per Android registration with notification text, string data, priority, and optional grouping tag.
4. Map only structured HTTP 404 `UNREGISTERED` responses to `invalid`. Keep invalid arguments, auth, quota, network, and server failures retryable.
5. Make `selectPushProvider(platform)` the only selector and remove token-shape routing that cannot distinguish iOS from Android.

### Task 3: Route fan-out by stored platform

**Files:**
- Modify: `__tests__/pushSender.test.ts`
- Modify: `lib/pushSender.ts`

1. Add failing tests that seed iOS, Android, and web registrations and assert one correctly selected provider call for each stored platform.
2. Change `dispatch()` to accept token plus platform targets, group them without losing result order, and isolate a provider-level failure to that platform group.
3. Keep explicit installed-web sends on the web provider and keep dormant Plan targeting identity-safe.
4. Confirm invalid Android results prune only their matching registration.

### Task 4: Enable Android registration and update operator truth

**Files:**
- Modify: `__tests__/nativePush.test.ts`
- Modify: `components/native/NativeDeepLinks.tsx`
- Modify: `components/native/NativePushPrompt.tsx`
- Modify: `lib/nativePush.ts`
- Modify: `docs/CAPACITOR_WRAP.md`

1. Change the existing platform-support test to require both iOS and Android registration support.
2. Enable Android registration through the existing Capacitor listener and `/api/push-tokens` route.
3. Persist prompt success only after Capacitor supplies a token and the API accepts it. Treat a registration failure as a deferral, not a false enabled state.
4. Re-register enabled devices on native boot without requesting permission, so rotated APNs and FCM tokens recover on the next launch.
5. Document required Firebase service-account server variables and the owner-supplied `android/app/google-services.json` build input.
6. State that source readiness is not device delivery proof until a configured Android build receives a notification.

### Task 5: Focused verification and push

**Files:**
- Test: `__tests__/pushProvider.test.ts`
- Test: `__tests__/pushSender.test.ts`
- Test: `__tests__/nativePush.test.ts`

1. Run only the three focused Vitest files, serially.
2. Run ESLint only on touched TypeScript files.
3. Run `git diff --check` and inspect the committed diff.
4. Commit, push `codex/mobile-release-current-main`, update PR #1282, and report exact remote head.
5. Defer Xcode, Gradle, emulator, browser, signed artifacts, and store submission to the resource and owner-credential gates.
