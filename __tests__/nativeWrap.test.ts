import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import capacitorConfig from "../capacitor.config";
import { APP_NAME } from "@/lib/brandNaming";

const rootFile = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Capacitor wrapped-build contract", () => {
  it("uses the canonical app name on both native install surfaces", () => {
    expect(capacitorConfig.appName).toBe(APP_NAME);

    const info = rootFile("ios/App/App/Info.plist");
    expect(info).toContain(
      `<key>CFBundleDisplayName</key>\n        <string>${APP_NAME}</string>`,
    );

    const strings = rootFile("android/app/src/main/res/values/strings.xml");
    expect(strings).toContain(`<string name="app_name">${APP_NAME}</string>`);
  });

  it("loads production remotely and has a bundled, truthful outage fallback", () => {
    expect(capacitorConfig.webDir).toBe("native/web-stub");
    expect(capacitorConfig.server?.url).toBe("https://pubmaxxing.com");
    expect(capacitorConfig.server?.cleartext).not.toBe(true);
    expect(capacitorConfig.server?.errorPath).toBe("offline.html");

    const offline = rootFile("native/web-stub/offline.html");
    expect(offline).toContain("Nothing stale is being shown.");
    expect(offline).toContain("prefers-color-scheme: dark");
    expect(offline).toContain("env(safe-area-inset-top, 0px)");
    expect(offline).toContain("https://pubmaxxing.com");
  });

  it("keeps system bars visible and enables Capacitor safe-area correction", () => {
    expect(capacitorConfig.plugins?.SystemBars).toEqual({
      hidden: false,
      style: "DEFAULT",
      insetsHandling: "css",
    });
  });

  it("preserves iOS camera permissions, APNs forwarding, and universal-link forwarding", () => {
    const info = rootFile("ios/App/App/Info.plist");
    expect(info).toContain("NSCameraUsageDescription");
    expect(info).toContain("NSPhotoLibraryUsageDescription");
    expect(info).not.toContain("NSPhotoLibraryAddUsageDescription");

    const delegate = rootFile("ios/App/App/AppDelegate.swift");
    expect(delegate).toContain("capacitorDidRegisterForRemoteNotifications");
    expect(delegate).toContain("capacitorDidFailToRegisterForRemoteNotifications");
    expect(delegate).toContain("continue userActivity: NSUserActivity");
    expect(delegate).toContain("ApplicationDelegateProxy.shared.application");

    expect(rootFile("ios/App/CapApp-SPM/Package.swift")).toContain("CapacitorApp");
    expect(rootFile("android/app/capacitor.build.gradle")).toContain(
      "implementation project(':capacitor-app')",
    );
  });

  it("declares foreground location access for native nearby and walk-time flows", () => {
    const info = rootFile("ios/App/App/Info.plist");
    expect(info).toContain("NSLocationWhenInUseUsageDescription");
    expect(info).not.toContain("NSLocationAlwaysAndWhenInUseUsageDescription");

    const manifest = rootFile("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain(
      'android.permission.ACCESS_COARSE_LOCATION',
    );
    expect(manifest).toContain(
      'android.permission.ACCESS_FINE_LOCATION',
    );
    expect(manifest).not.toContain(
      'android.permission.ACCESS_BACKGROUND_LOCATION',
    );
  });

  it("uses the canonical app name in iOS permission explanations", () => {
    const info = rootFile("ios/App/App/Info.plist");
    expect(info).toContain(
      `<string>${APP_NAME} uses the camera so you can take photos of your night and save them as private Moments.</string>`,
    );
    expect(info).toContain(
      `<string>${APP_NAME} uses your location while the app is open to find nearby pubs and calculate walk times.</string>`,
    );
    expect(info).toContain(
      `<string>${APP_NAME} opens your photo library so you can add existing photos to your private Moments.</string>`,
    );
  });

  it("declares the same supported paths for iOS and Android deep links", () => {
    const aasa = JSON.parse(
      rootFile("public/.well-known/apple-app-site-association"),
    ) as { applinks: { details: Array<{ appIDs: string[]; components: Array<{ "/": string }> }> } };
    const detail = aasa.applinks.details[0];
    expect(detail?.appIDs).toEqual(["TEAMID.com.pubmaxx.app"]);
    expect(detail?.components.map((component) => component["/"])).toEqual([
      "/plan/*",
      "/rounds/*",
      "/p/*",
      "/auth/callback",
    ]);

    const manifest = rootFile("android/app/src/main/AndroidManifest.xml");
    const verifiedFilters = [
      ...manifest.matchAll(
        /<intent-filter android:autoVerify="true">([\s\S]*?)<\/intent-filter>/g,
      ),
    ].map((match) => match[1] ?? "");
    expect(verifiedFilters).toHaveLength(4);
    for (const path of ["/plan/", "/rounds/", "/p/"]) {
      expect(manifest).toContain(`android:pathPrefix="${path}"`);
      expect(
        verifiedFilters.some((filter) =>
          filter.includes(`android:pathPrefix="${path}"`),
        ),
      ).toBe(true);
    }
    for (const filter of verifiedFilters) {
      expect(filter).toContain('android:name="android.intent.action.VIEW"');
      expect(filter).toContain('android:name="android.intent.category.BROWSABLE"');
      expect(filter).toContain('android:scheme="https"');
      expect(filter).toContain('android:host="pubmaxxing.com"');
    }
    expect(manifest).toContain('android:path="/auth/callback"');
    expect(manifest).toContain('android:host="pubmaxxing.com"');
    expect(manifest).toContain('android:launchMode="singleTask"');
  });

  it("keeps store identity, Android toolchain, and location answers truthful", () => {
    const readiness = rootFile("docs/STORE_READINESS.md");
    expect(readiness).toContain("Create the app record in App Store Connect: name PUBMAXXING");
    expect(readiness).toContain("Create the app in the Play Console: name PUBMAXXING");
    expect(readiness).toContain("JDK 21");
    expect(readiness).toContain("Precise location");
    expect(readiness).toContain("ephemeral");
    expect(readiness).not.toContain("Location is never transmitted to the server");
    expect(readiness).not.toContain("Coordinates are never sent to our servers");
    expect(readiness).not.toContain("Location: Not collected (processed on-device only)");
  });
});
