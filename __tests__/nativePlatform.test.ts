import { afterEach, describe, expect, it } from "vitest";

// The native-shell detection seam must be SSR-safe (no window in the node test
// environment) and must only report native when the injected Capacitor bridge
// says so. window is stubbed per-case and always restored.
import { isNativeApp, nativePlatform } from "@/lib/nativePlatform";

type AnyGlobal = { window?: unknown };
const g = globalThis as AnyGlobal;

function stubWindow(capacitor: unknown): void {
  g.window = { Capacitor: capacitor };
}

afterEach(() => {
  delete g.window;
});

describe("isNativeApp", () => {
  it("is false on the server (no window)", () => {
    expect(isNativeApp()).toBe(false);
  });

  it("is false on the plain web (window without Capacitor)", () => {
    g.window = {};
    expect(isNativeApp()).toBe(false);
  });

  it("is false when the bridge reports a web platform", () => {
    stubWindow({ isNativePlatform: () => false });
    expect(isNativeApp()).toBe(false);
  });

  it("is true only when the bridge reports native", () => {
    stubWindow({ isNativePlatform: () => true });
    expect(isNativeApp()).toBe(true);
  });
});

describe("nativePlatform", () => {
  it("is null on server / web", () => {
    expect(nativePlatform()).toBeNull();
    g.window = {};
    expect(nativePlatform()).toBeNull();
  });

  it("reports ios / android from the bridge, null for anything else", () => {
    stubWindow({ isNativePlatform: () => true, getPlatform: () => "ios" });
    expect(nativePlatform()).toBe("ios");
    stubWindow({ isNativePlatform: () => true, getPlatform: () => "android" });
    expect(nativePlatform()).toBe("android");
    stubWindow({ isNativePlatform: () => true, getPlatform: () => "web" });
    expect(nativePlatform()).toBeNull();
  });
});
