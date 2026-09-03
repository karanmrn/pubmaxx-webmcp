# PUBMAXX Store Readiness Pack

**Status:** Everything on this page is pre-writable now, without an Apple or Google developer account. It is the copy, metadata, and answer sheet the owner pastes into App Store Connect and the Google Play Console once enrolment clears. Paid-account work includes enrolment, certificates, Sign in with Apple activation, and the first binary upload, listed as the owner checklist in the last section.

**App:** PUBMAXXING. London pub finder, crawl planner, and night log, wrapped in a Capacitor shell over `https://pubmaxxing.com` (see `docs/IOS_APP_PRD.md`, `docs/CAPACITOR_WRAP.md`).

**Identity (already fixed in the repo, do not change):**

| Field | Value | Source |
| --- | --- | --- |
| App name | PUBMAXXING | `capacitor.config.ts` `appName`; iOS `CFBundleDisplayName`; Android `app_name` |
| iOS bundle id | `com.pubmaxx.app` | `capacitor.config.ts` `appId` |
| Android applicationId | `com.pubmaxx.app` | `android/app/build.gradle` (same string, iOS convention) |
| Version name | 1.0 | `android/app/build.gradle` `versionName`; iOS `MARKETING_VERSION` |
| Version code / build | 1 | `android/app/build.gradle` `versionCode`; iOS `CURRENT_PROJECT_VERSION` |
| Category | Food & Drink | Both stores |
| Min OS | iOS 15+; Android 7.0, API 24 | `ios/App/CapApp-SPM/Package.swift`; `android/variables.gradle` `minSdkVersion = 24` |
| Target SDK (Android) | 36 | `android/variables.gradle` `targetSdkVersion = 36`, clears the Play 2025 target-API floor |

---

## 1. App Store Optimisation (ASO)

Keep the name clean and let the subtitle and keyword field carry the search terms. Do not stuff keywords into the name or subtitle, both stores penalise it and Apple bins duplicates between the name, subtitle, and keyword field.

**App name (30 char max, Apple / 30 char, Google):**
> PUBMAXXING

**Subtitle (Apple, 30 char max):**
> Cheap pints near you, tonight

(29 characters. Alternatives if that reads wrong: "London pubs and pint prices" (27), "Find the cheap pint near you" (28).)

**Promotional text (Apple, 170 char, editable without review):**
> Leaving the office and want a good cheap pint near you? PUBMAXX shows the nearest pubs, what a pint costs, and a crawl route home. London only, for now.

**Keyword field (Apple, 100 char, comma-separated, no spaces after commas to save characters):**
> london pubs,pub crawl,pint prices,cheap pint,near me,nightlife,beer,happy hour,bars,pub finder,drinks

(That string is 100 characters exactly. Do not repeat words already in the app name or subtitle, Apple indexes those for free. "pub" and "london" are already implied by the listing.)

**Google Play short description (80 char max):**
> The nearest London pubs, what a pint costs, and a crawl route home.

**Primary ASO targets (the searches this listing is built to win):**
- london pubs
- pub crawl
- pint prices / cheap pint
- pubs near me
- happy hour london

---

## 2. Description drafts

Same body works for both stores. Google Play allows 4000 characters and renders line breaks. Apple allows 4000 in the description field. Dry, plain, no exclamation marks, no "unleash" or "seamless" filler.

### Short version (safe for both)

> PUBMAXX finds you a good cheap pint near where you are, then gets you home.
>
> You have left work. You want a decent pint that does not cost a fortune, somewhere close, without reading forty reviews first. PUBMAXX opens straight on the map, shows the nearest pubs, tells you roughly what a pint costs, and lays out a short crawl you can actually walk.
>
> What you get:
>
> - Nearest pubs, ranked by distance, with pint prices where we have them.
> - A one-tap crawl route that keeps the walking sensible and ends near a way home.
> - Opening hours, last orders, and what is on tonight.
> - A private log of your nights out, with photos if you want them. Yours, on your phone, not a feed for strangers.
>
> London only for now. More cities later.
>
> A note on prices: pubs change them and we do not. We show the best figure we have and when we last saw it. Treat it as a steer, not a promise.
>
> PUBMAXX is free. No account needed to find a pint.

### Long version (Google Play, room to breathe)

> PUBMAXX finds you a good cheap pint near where you are, then gets you home.
>
> Most nights out start the same way. You have left the office, you are somewhere in London, and you want a decent pint that does not cost eight pounds fifty, somewhere you can walk to, without wading through star ratings. PUBMAXX is built for exactly that moment. It opens on the map, works out where you are, and shows you the nearest pubs first.
>
> Find a pint
> - The nearest pubs, ranked by how far you actually have to walk.
> - Pint prices where we have them, with the date we last checked, so you know how fresh the number is.
> - Opening hours and last orders, so you do not arrive to a locked door.
>
> Plan the night
> - Tap once for a crawl route that keeps the walking honest and finishes near a bus, tube, or night route home.
> - See what is on tonight near you.
>
> Keep the night
> - A private log of where you went, kept on your phone. Add a photo from the night if you like. It is yours. It is not posted anywhere and it is not a feed.
>
> Straight answers on prices
> Pubs change their prices and we are not standing at the bar. We show the best figure we hold and when we last saw it. Use it as a rough steer, check at the bar, and do not hold us to the penny.
>
> Privacy
> Full GPS precision stays on your phone. If you ask for nearby events, transport or a journey, the app sends a rounded point for that request. It is not tied to your public profile. Usage analytics are off until you turn them on. There are no adverts and nothing is sold on.
>
> London only for now. More cities are coming.
>
> Free to use. You do not need an account to find a pint.

---

## 3. Category and content

- **Primary category:** Food & Drink (both stores).
- **Secondary category (Apple, optional):** Travel or Lifestyle. Travel fits the "near me while out" use better.
- **Google Play tags:** Food & Drink; optionally "Maps & Navigation" as a secondary.
- **Contains ads:** No.
- **In-app purchases:** No.
- **Price:** Free.

---

## 4. Age rating

The app is about pubs, beer, and pint prices. Alcohol is the subject, not an incidental mention, so answer the alcohol questions as frequent and central. Do not undersell this, an under-rating is a takedown risk.

### Apple App Store (App Store Connect questionnaire)

Answer the ratings questionnaire as follows. Everything not listed is None / No.

| Question | Answer |
| --- | --- |
| Alcohol, Tobacco, or Drug Use or References | **Frequent/Intense** |
| Contests | None |
| Gambling | No (no real or simulated gambling) |
| Horror/Fear, Violence (all kinds) | None |
| Sexual Content or Nudity, Profanity, Crude Humor | None |
| Mature/Suggestive Themes | None |
| Medical/Treatment Information | None |
| Unrestricted Web Access | **Yes** (the shell loads a live website in a web view) |
| Age Verification / Made for Kids | Not made for kids |

Expected result: **17+** (Apple's new 17+ tier for frequent alcohol references, formerly reported as the same band). The "Unrestricted Web Access" yes on its own forces 17+ anyway, which is consistent.

### Google Play (IARC questionnaire)

| Question | Answer |
| --- | --- |
| App category | Reference, News, or Educational / Utility. Choose the closest, then answer content questions honestly. |
| Does the app contain references to alcohol, tobacco, or drugs? | **Yes, references to alcohol** (finding and pricing alcoholic drinks is the core function) |
| Promotes or facilitates the purchase of alcohol? | No (we do not sell or take orders) |
| Gambling, violence, sexual content, language | No / None |
| Does the app share the user's location with other users? | No |
| Users interact / share content? | **Yes.** Social, Messages, Visit Reports, community prices, venue reports, recommendations, and public Moments can carry user content. Reporting, moderation, blocking, account deletion, and the public support contact must work in the submitted build. |

Expected result: **PEGI 18 / ESRB Mature 17+ / "Parental guidance"** band driven by the alcohol reference. Target audience in the Play Console: **18 and over**. Do not select any age band under 18 and do not opt into the Designed for Families / Teacher Approved programmes.

---

## 5. Privacy questionnaire answers

These are derived from the actual code, not aspirations. File references are inline so the owner can verify each line before submitting.

### What the app collects

| Data | Collected? | Linked to identity? | Used for tracking? | Purpose | Evidence |
| --- | --- | --- | --- | --- | --- |
| Precise location | **Yes, only when the user asks for a location feature.** Full GPS precision stays on the device. The app rounds a viewer point to three decimal places before network egress. That is about 70 to 110 metres in London and still falls within Apple and Google Play's precise-location definitions. Request handlers use it ephemerally for nearby listings, conditions, transport, and journey options. | No | No | App functionality | `lib/geo.ts` owns the one three-decimal egress seam. `/api/whats-on`, `/api/tonight-conditions`, `/api/last-train`, `/api/tfl-disruption`, and `/api/citymcp/journey` process the rounded point. TfL, CityMCP, and a user-opened Google Maps journey can receive that rounded point for the requested result. `app/privacy/page.tsx` lists each path. |
| Product interaction / usage data | **Yes, only after the user opts in.** A closed set of named UI events with allow-listed fixed-schema props, plus browser, operating system, device type, screen and viewport size, referrer, campaign parameters, and Web Vitals. | No (pseudonymous device profile only) | No | Analytics | `lib/analytics.ts`: consent-gated (default off), honours Do Not Track, forwards to PostHog EU ingest only when consent is granted; `lib/analyticsEvents.ts` owns closed property schemas with no coordinates or free text. |
| Pseudonymous analytics id | Yes, only after opt-in | No (contains no account or contact data) | No | Analytics | `lib/analytics.ts` `anonymousAnalyticsId()`: an `anon_` UUID created only once consent is `granted`, stored in localStorage and used as PostHog's persistent device identity across page loads and sessions. |
| Device/web push delivery material | Yes, when the user enables notifications | No (stored with no user or plan link) | No | App functionality (public night-signal and installed-web daily-brief pushes) | `lib/nativePush.ts` or explicitly-invoked `lib/webPush.ts` posts to `POST /api/push-tokens`; `lib/pushTokenStore.ts` stores it with no identity column (migrations 0039 + 0046). |
| Photos (Moments) | Only when the user chooses to share a Moment. Drafts stay on the phone. | Tied to that content only, not to a real-world identity | No | User content | `lib/momentDraft.ts` keeps drafts in IndexedDB/localStorage on the device; `lib/nightMomentMedia.ts` uploads to Supabase storage only on publish. Camera access is via `lib/nativeCamera.ts` with the usage strings in `ios/App/App/Info.plist`. |
| Email address | Only if the user signs in, or asks us to cover an area they name | Yes (it is the contact) | No | Account sign-in, and telling one person we reached the area they asked for | Sign-in is a Supabase magic link (`components/auth/AuthProvider.tsx`); the optional area-demand contact is `app/api/area-demand/route.ts` (most rows carry no address at all). There is no marketing list and no digest capture (`docs/EMAIL_CAPTURE.md`). |

### What the app does not do

- No advertising SDKs, no ad identifiers, no cross-app tracking. Nothing on this list is used to track the user across other companies' apps or sites.
- No selling or sharing of personal data with data brokers.
- No account required to find a pint. Identity is optional and prompted contextually, not at launch.
- No background location access. Full-precision viewer coordinates stay on the device. Rounded coordinates are not shown to other users and are used only to answer a location request.

### Apple App Privacy label (App Store Connect > App Privacy)

Declare the following. Everything else: Not Collected.

- **Data Used to Track You:** None.
- **Data Linked to You:** Contact Info > Email Address (account sign-in or optional area-demand contact), purpose App Functionality. User Content > Photos or Videos (Moments, on publish), purpose App Functionality.
- **Data Not Linked to You:** Identifiers > Device ID (push token), purpose App Functionality. Usage Data > Product Interaction (opt-in analytics), purpose Analytics. Precise Location, purpose App Functionality, only when the user starts a location feature.
- **Location processing:** declare Precise Location because three decimal places is about 70 to 110 metres. Mark it optional, not linked, not used for tracking, and used for App Functionality. The app processes the rounded point ephemerally. Confirm current processor retention terms in App Store Connect before submission.

### Google Play Data safety form

- **Does your app collect or share any of the required user data types?** Yes.
- **Precise location:** Collected, optional, processed ephemerally, purpose App functionality, not used for tracking. Full GPS precision stays on the device; only the three-decimal point leaves it. In the Data safety flow, identify the ephemeral processing and current service-provider or user-initiated transfers exactly as the form asks.
- **Personal info > Email address:** Collected, not shared, optional, purpose App functionality. Encrypted in transit. Account deletion removes the sign-in address; other erasure requests use the public contact in `lib/siteContact.ts`.
- **Photos and videos:** Collected (on Moment publish), not shared publicly by default, purpose App functionality.
- **App activity > Product interaction:** Collected, not shared, optional (opt-in), purpose Analytics. Encrypted in transit.
- **Device or other IDs:** Collected (push token), not shared, purpose App functionality.
- **Is all data encrypted in transit?** Yes (HTTPS only, the shell loads `https://pubmaxxing.com`).
- **Can users request data deletion?** Yes. Account deletion covers account-linked data; the public contact in `lib/siteContact.ts` handles other requests, including an optional area-demand address and Moments.

**Privacy policy URL:** required by both stores. Use `https://pubmaxxing.com/privacy` — the site publishes it (with `/terms`) from `app/privacy` / `app/terms`; see the AGENTS.md privacy-notice entry for the keep-it-honest rule.

---

## 6. Screenshot shot list

Screenshots already exist in `docs/screenshots` from the Gate Z set (`docs/screenshots/GATE_Z_2026-07-12.md`), rendered at phone widths (390 and 430) in light and dark. Use the 430-wide light frames as the base, they map cleanly to the 6.5" and 6.7" required sizes. Reshoot inside the shell only if a device pass shows shell-specific chrome worth capturing.

**Order (first three carry the listing, most installs decide on those):**

1. **Map, nearest pubs**: `map-clean-*-430.png` or `map-sheet-*-430.png`. Caption: "London pubs on the map." This is the core promise, lead with it.
2. **Pint price on a venue**: `venue-desktop` equivalent at 430, or `map-sheet` with a price visible. Caption: "What a pint actually costs."
3. **Crawl route**: `crawls-*-430.png` or `mobile-suggested-crawl.png`. Caption: "A crawl you can actually walk."
4. **Tonight / what is on**: `tonight-*-430.png` or `w1-tonight-sheet-*.png`. Caption: "What is on across London tonight."
5. **Activity / feed**: `activity-*-430.png` or `feed-*-430.png`. Caption: "Your night, logged."
6. **Profile / private log**: `profile-you-*-430.png`. Caption: "Private. Yours. Not a feed."

**Required device sizes:**
- Apple: 6.7" (1290x2796) and 6.5" (1242x2688) are the two that satisfy the current iPhone requirement. One set can cover both if uploaded at 6.7". iPad screenshots only needed if the app is offered on iPad (it is universal-capable, so either provide 12.9" iPad shots or set availability to iPhone only).
- Google Play: minimum two, up to eight, phone screenshots at 16:9 or 9:16, min 320px, max 3840px. The 430-wide frames upscale fine. A feature graphic (1024x500) is also required, build it from the brand mark on the coral field.

**Feature graphic (Google Play, 1024x500):** ink-deep field (`#060607`) with the coral double-struck X mark, per the identity lock in section 7, plus wordmark "PUBMAXX" and tagline "Cheap pints near you." (text is fine on the feature graphic, the no-text rule applies to the icon and splash). Start from the `public/store-assets/splash.svg` composition (which keeps the ink field).

---

## 7. Store visual identity: icon + splash set (issue #440)

**Owner lock (Wave C, #520/#523):** the icon is a clean **white tile with the coral double-struck X**, no text; no ember (static exports drop it). The **splash keeps the ink-deep field** (splashes are not icons, per #523) with the same coral X. This supersedes both the earlier coral-field sources in `assets/` (from the #377 native-readiness pass) and the retired ink-tile / Clink lock; regenerate the native projects from these masters at the next `npx cap sync` (see wiring below).

### SVG masters (source of truth, `public/store-assets/`)

| File | Native size | Role |
| --- | --- | --- |
| `icon-square.svg` | 1024 | Icon master: pure white (`#ffffff`) field, coral double-struck X at scale 0.82. Full bleed, no rounding (both stores mask). |
| `icon-square-small.svg` | 64 | Small-size optics for exports at or under 64px: same white tile, but the single-slash `slashSimple` + thick stroke (the double-struck channel closes up below ~24px). |
| `play-adaptive-foreground.svg` | 1024 | Play adaptive foreground: coral double-struck X on transparent, 108dp canvas, mark inside the 66dp safe circle (farthest stroke corner ~29.3dp from centre at scale 0.9). |
| `play-adaptive-background.svg` | 1024 | Play adaptive background: solid white, deliberately flat (parallax layer). |
| `splash.svg` | 2732 | Splash: ink-deep field (kept per #523), centred coral X at scale 0.28, faint glow. One splash serves light and dark. |

Colour and geometry are pinned to `lib/ogBrand.tsx` / `docs/BRAND_MARK.md` by `__tests__/storeAssets.test.ts` (hexes, canonical double-struck X endpoints, white icon tile, no ember, no `<text>`, flat background layer).

### PNG export set (committed, `public/store-assets/png/`)

Regenerate any time the masters change:

```
node scripts/gen-store-assets.mjs
```

| Output | Sizes | Notes |
| --- | --- | --- |
| `ios/AppIcon-{size}.png` | 20, 29, 40, 58, 60, 76, 80, 87, 120, 152, 167, 180, 1024 | Opaque, alpha stripped (the 1024 marketing slot rejects alpha). Sizes at or under 64 render from the small-optics master. |
| `play/play-store-512.png` | 512 | Play Console listing icon. |
| `play/adaptive-foreground-432.png` | 432 | 108dp at xxxhdpi, keeps transparency. |
| `play/adaptive-background-432.png` | 432 | Flat white. |
| `splash/splash-2732.png` | 2732 | Capacitor splash source, covers the largest iPad requirement. |

### Legibility at small sizes (checked)

Coral `#ff5a5f` on a white `#ffffff` tile measures ~3.7:1 contrast — comfortably above the 3:1 large-graphic threshold and crisper on a home screen than the retired coral-on-ink treatment. The full double-struck X holds at 40px+, but its two thin ascending strokes (~4u channel) merge below ~24px, so the ≤64px small-optics master takes the single-slash `slashSimple` + thick descending stroke instead — one clean forward slash that stays legible at the 20px slot. No ember at any tier (the crossing is already the event). Verified by sampling rendered pixels on the 29px, 512px and 1024px exports (white field, coral stroke).

### Wiring into the native shells (when syncing)

- **iOS:** `ios/App/App/Assets.xcassets/AppIcon.appiconset/` uses a single universal 1024 (`AppIcon-512@2x.png`); replace its contents with `png/ios/AppIcon-1024.png` at the next native pass. The full classic slot set exists for older Xcode setups and App Store Connect uploads.
- **Android / Play:** upload `play-store-512.png` in the Play Console; the adaptive layers feed `@capacitor/assets` (or hand-placed `mipmap` resources) at sync time.
- **Capacitor splash:** feed `splash/splash-2732.png` as both `splash` and `splash-dark` sources, the ink-dark art is the same for both (the splash keeps the ink field even though the icon is now a white tile), then `npx @capacitor/assets@3 generate` (fetched ephemerally, see the header of `scripts/gen-native-app-icons.mjs` for the npm-audit rationale).

### Manual export fallback (no sharp)

`scripts/gen-store-assets.mjs` needs the `sharp` package (already a dependency). If it cannot load in some environment, do not add a new raster dependency: open each SVG master in any renderer (`rsvg-convert -w <size> -h <size>`, Inkscape, Figma) and export the table above, using `icon-square-small.svg` for sizes at or under 64px and stripping alpha on the iOS set.

---

## 8. Owner-only remaining steps

Everything above is done or ready to paste. The steps below need a real account, real money, or a physical signing step, and only the owner can do them. Nothing here is blocked by the codebase.

### Apple App Store

- [ ] **Enrol** in the Apple Developer Program, 99 USD per year, at developer.apple.com. Individual or Organization. Note the **Team ID** once issued.
- [ ] **Activate Sign in with Apple when wanted:** create the App ID, Services ID, return URL, and provider key, then enable Apple in Supabase. [`DEPLOYMENT.md`](./DEPLOYMENT.md#apple) owns the detailed provider setup.
- [ ] **Verify native auth return:** replace the `TEAMID` placeholder, add the Associated Domains capability, deploy the updated association file, then prove email, Google, and Apple callback URLs return to the signed-in app on a physical iPhone. Code accepts exact `/auth/callback`; association and device proof remain owner gates.
- [ ] **Install full Xcode** from the Mac App Store (not just Command Line Tools). Confirm `xcode-select -p` points at `…/Xcode.app`.
- [ ] `npm ci` then `npx cap sync ios`, then `npx cap open ios` to open the project in Xcode.
- [ ] **Signing:** App target > Signing & Capabilities, select the team, confirm bundle id `com.pubmaxx.app`. Let Xcode manage signing.
- [ ] **Certificates and profiles** are auto-managed by Xcode once the team is set. No manual keychain work needed for a first upload.
- [ ] **Push (only when you want notifications live):** add the Push Notifications capability, create an APNs Auth Key in the developer portal, and set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, and `APNS_ENV` on the server. Use `APNS_ENV=production` for TestFlight and App Store production tokens. Use `APNS_ENV=sandbox` only for development-signed sandbox tokens. Missing or invalid `APNS_ENV` fails closed when credentials are configured. Never commit the `.p8` key. Verify delivery on the matching signed device. The APNs HTTP/2 transport exists in `lib/pushProvider.ts`; credentials, entitlement, signing, and device proof remain owner-only. See `docs/CAPACITOR_WRAP.md`.
- [ ] **Universal links:** add the Associated Domains capability `applinks:pubmaxxing.com`, and replace the `TEAMID` placeholder in `public/.well-known/apple-app-site-association` with the real Team ID. Sign-in return depends on this gate.
- [ ] **Create the app record in App Store Connect: name PUBMAXXING**, bundle id `com.pubmaxx.app`, primary language English (UK), category Food & Drink.
- [ ] **Paste metadata** from sections 1 to 5 of this doc. Upload screenshots from section 6.
- [ ] **Archive and upload** the first build: Xcode > Product > Archive > Distribute App > App Store Connect.
- [ ] **TestFlight** internal test on your own device before submitting for review.
- [ ] **Submit for review.** Do not submit until the three native superpowers are demonstrably live (real camera, push delivery, universal links), or expect a thin-wrapper rejection. See `docs/IOS_APP_PRD.md` section 4 step 9.

### Google Play

- [ ] **Enrol** in the Google Play Console, 25 USD one-time, at play.google.com/console. Complete identity verification (can take a few days for individual accounts, start this early, it is the long pole).
- [ ] **Install Android Studio** for signing and bundle work, plus **JDK 21**. Confirm `java -version` reports 21 before `./gradlew` runs in `android/`; generated Capacitor Gradle compiles with Java 21.
- [ ] `npm ci` then `npx cap sync android`, then `npx cap open android` to open the project in Android Studio.
- [ ] **Upload key / signing:** opt into Play App Signing (recommended). Generate an upload keystore once (`keytool` or Android Studio > Generate Signed Bundle), keep it safe, it signs every future update. This is the one irreversible owner step, do not lose the keystore.
- [ ] **Build the release bundle:** Android Studio > Build > Generate Signed App Bundle (.aab), or `./gradlew bundleRelease`. Target SDK is already 36, which clears the Play target-API requirement.
- [ ] **Push:** source delivery is implemented through platform-routed FCM HTTP v1. Create a Firebase project, add Android package `com.pubmaxx.app`, and place its real `google-services.json` in `android/app/`. Set all four server values `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY_ID`, and `FCM_PRIVATE_KEY`. Then prove token registration, notification receipt, and safe tap navigation on a physical configured build. Never commit the service-account JSON or private key.
- [ ] **Publish verified App Links:** add the release signing fingerprint to `/.well-known/assetlinks.json`, deploy it, then prove email, Google, and Apple callback URLs return to the signed-in app on a physical Android device.
- [ ] **Create the app in the Play Console: name PUBMAXXING**, category Food & Drink, free.
- [ ] **Complete the Data safety form** and **content rating (IARC) questionnaire** from sections 4 and 5.
- [ ] **Set target audience** to 18 and over. Do not opt into Designed for Families.
- [ ] **Paste metadata** from sections 1 to 3. Upload screenshots and the 1024x500 feature graphic from section 6.
- [ ] **Upload the .aab** to the Internal testing track first, install on your own device, then promote to Production.
- [ ] **Roll out.** New personal Play accounts created after Nov 2023 also need a closed test with 12+ testers for 14 days before production, budget for that.

### Shared, not account-blocked

- [x] **Publish a privacy policy page** — done: `https://pubmaxxing.com/privacy` (and `/terms`) ship from `app/privacy` / `app/terms`, linked in the site footer. Use that URL in both listings.
