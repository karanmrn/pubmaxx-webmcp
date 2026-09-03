import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  A2HS_DECLINE_COOLDOWN_DAYS,
  EMPTY_A2HS_STATE,
  canReoffer,
  dayBucketFromDate,
  detectA2hsPlatform,
  evaluateA2hs,
  hasProvenValue,
  isNativeAppShell,
  parseA2hsState,
  readA2hsState,
  recordA2hsVisit,
  recordVisitDay,
  registerDecline,
  registerDismissedForever,
  registerInstalled,
  writeA2hsState,
  type A2hsState,
} from "@/lib/a2hsPrompt";

// --- shared memory-storage harness (mirrors cityPreference.test.ts) ---------

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
  };
}

function installWindow(storage: Storage): void {
  (globalThis as { window?: { localStorage: Storage } }).window = { localStorage: storage };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

// UA fixtures
const UA = {
  iPhoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  iPhoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1",
  iPhoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  androidFacebook:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36 [FBAN/EMA;FBAV/1.0]",
  desktopChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
  iPadOs:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
};

describe("detectA2hsPlatform", () => {
  it("native Capacitor shell is terminal — never offer A2HS inside the app", () => {
    // The native WKWebView reports an iPhone-Safari-shaped UA, is NOT
    // display-mode standalone, and navigator.standalone is false; without the
    // native flag it would wrongly resolve to ios-safari and beg to install.
    expect(detectA2hsPlatform({ userAgent: UA.iPhoneSafari })).toBe("ios-safari");
    expect(
      detectA2hsPlatform({ userAgent: UA.iPhoneSafari, isNativeApp: true }),
    ).toBe("standalone");
    // Wins even over an Android UA.
    expect(
      detectA2hsPlatform({ userAgent: UA.androidChrome, isNativeApp: true }),
    ).toBe("standalone");
  });

  it("standalone (display-mode) wins over everything", () => {
    expect(
      detectA2hsPlatform({ userAgent: UA.iPhoneSafari, displayModeStandalone: true }),
    ).toBe("standalone");
  });

  it("iOS navigator.standalone → standalone", () => {
    expect(
      detectA2hsPlatform({ userAgent: UA.iPhoneSafari, navigatorStandalone: true }),
    ).toBe("standalone");
  });

  it("iPhone Safari → ios-safari", () => {
    expect(detectA2hsPlatform({ userAgent: UA.iPhoneSafari })).toBe("ios-safari");
  });

  it("iPadOS (desktop UA + touch) → ios-safari", () => {
    expect(detectA2hsPlatform({ userAgent: UA.iPadOs, maxTouchPoints: 5 })).toBe("ios-safari");
  });

  it("iPadOS-looking UA without touch is just desktop → unsupported", () => {
    expect(detectA2hsPlatform({ userAgent: UA.iPadOs, maxTouchPoints: 0 })).toBe("unsupported");
  });

  it("non-Safari iOS browsers cannot install → unsupported", () => {
    expect(detectA2hsPlatform({ userAgent: UA.iPhoneChrome })).toBe("unsupported");
  });

  it("iOS in-app webview → unsupported", () => {
    expect(detectA2hsPlatform({ userAgent: UA.iPhoneInstagram })).toBe("unsupported");
  });

  it("Android Chrome → android", () => {
    expect(detectA2hsPlatform({ userAgent: UA.androidChrome })).toBe("android");
  });

  it("Android in-app webview → unsupported", () => {
    expect(detectA2hsPlatform({ userAgent: UA.androidFacebook })).toBe("unsupported");
  });

  it("desktop → unsupported", () => {
    expect(detectA2hsPlatform({ userAgent: UA.desktopChrome })).toBe("unsupported");
  });

  it("is total — empty UA never throws", () => {
    expect(detectA2hsPlatform({ userAgent: "" })).toBe("unsupported");
  });
});

describe("isNativeAppShell (Capacitor bridge probe)", () => {
  type WinWithCap = { Capacitor?: { isNativePlatform?: () => boolean } };

  it("false when there is no window (SSR)", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(isNativeAppShell()).toBe(false);
  });

  it("false when no Capacitor bridge is present", () => {
    (globalThis as { window?: WinWithCap }).window = {};
    expect(isNativeAppShell()).toBe(false);
  });

  it("true when the bridge reports a native platform", () => {
    (globalThis as { window?: WinWithCap }).window = {
      Capacitor: { isNativePlatform: () => true },
    };
    expect(isNativeAppShell()).toBe(true);
  });

  it("false when the bridge reports web (Capacitor present but not native)", () => {
    (globalThis as { window?: WinWithCap }).window = {
      Capacitor: { isNativePlatform: () => false },
    };
    expect(isNativeAppShell()).toBe(false);
  });

  it("does not guess native when a partial bridge lacks isNativePlatform()", () => {
    (globalThis as { window?: WinWithCap }).window = { Capacitor: {} };
    expect(isNativeAppShell()).toBe(false);
  });

  it("never throws if the probe blows up", () => {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      get() {
        throw new Error("boom");
      },
    });
    expect(isNativeAppShell()).toBe(false);
    delete (globalThis as { window?: unknown }).window;
  });
});

describe("recordVisitDay", () => {
  it("stamps firstDayBucket on the first ever visit", () => {
    const next = recordVisitDay(EMPTY_A2HS_STATE, 100);
    expect(next.firstDayBucket).toBe(100);
    expect(next.secondDayBucket).toBeNull();
  });

  it("same-day reloads are a no-op (returns same reference)", () => {
    const first = recordVisitDay(EMPTY_A2HS_STATE, 100);
    expect(recordVisitDay(first, 100)).toBe(first);
  });

  it("a later distinct day stamps secondDayBucket", () => {
    const first = recordVisitDay(EMPTY_A2HS_STATE, 100);
    const second = recordVisitDay(first, 101);
    expect(second.secondDayBucket).toBe(101);
  });

  it("never overwrites secondDayBucket once set", () => {
    let s = recordVisitDay(EMPTY_A2HS_STATE, 100);
    s = recordVisitDay(s, 101);
    const third = recordVisitDay(s, 105);
    expect(third).toBe(s);
    expect(third.secondDayBucket).toBe(101);
  });
});

describe("hasProvenValue", () => {
  it("false on first day, no completion", () => {
    const s = recordVisitDay(EMPTY_A2HS_STATE, 100);
    expect(hasProvenValue(s, false)).toBe(false);
  });
  it("true after a second visit day", () => {
    const s = recordVisitDay(recordVisitDay(EMPTY_A2HS_STATE, 100), 101);
    expect(hasProvenValue(s, false)).toBe(true);
  });
  it("true after a first completed night even on day one", () => {
    const s = recordVisitDay(EMPTY_A2HS_STATE, 100);
    expect(hasProvenValue(s, true)).toBe(true);
  });
});

describe("canReoffer (decline cooldown)", () => {
  const declined: A2hsState = { ...EMPTY_A2HS_STATE, declinedDayBucket: 100 };
  it("true when never declined", () => {
    expect(canReoffer(EMPTY_A2HS_STATE, 100)).toBe(true);
  });
  it("false within the cooldown window", () => {
    expect(canReoffer(declined, 100 + A2HS_DECLINE_COOLDOWN_DAYS - 1)).toBe(false);
  });
  it("true exactly at the cooldown boundary", () => {
    expect(canReoffer(declined, 100 + A2HS_DECLINE_COOLDOWN_DAYS)).toBe(true);
  });
});

describe("parseA2hsState", () => {
  it("empty/garbage → empty state", () => {
    expect(parseA2hsState(null)).toEqual(EMPTY_A2HS_STATE);
    expect(parseA2hsState("")).toEqual(EMPTY_A2HS_STATE);
    expect(parseA2hsState("{not json")).toEqual(EMPTY_A2HS_STATE);
  });
  it("coerces bad field types to null / none", () => {
    const s = parseA2hsState(
      JSON.stringify({ firstDayBucket: "x", secondDayBucket: -3, declinedDayBucket: 1.5, outcome: "weird" }),
    );
    expect(s).toEqual(EMPTY_A2HS_STATE);
  });
  it("round-trips a valid state", () => {
    const original: A2hsState = {
      firstDayBucket: 10,
      secondDayBucket: 12,
      declinedDayBucket: 12,
      outcome: "installed",
    };
    expect(parseA2hsState(JSON.stringify(original))).toEqual(original);
  });
});

describe("evaluateA2hs (the gate)", () => {
  const proven: A2hsState = { ...EMPTY_A2HS_STATE, firstDayBucket: 100, secondDayBucket: 101 };

  it("never shows on unproven value", () => {
    const d = evaluateA2hs({
      platform: "ios-safari",
      state: { ...EMPTY_A2HS_STATE, firstDayBucket: 100 },
      todayBucket: 100,
      planCompleted: false,
      androidPromptReady: false,
    });
    expect(d.show).toBe(false);
    expect(d.reason).toBe("unproven-value");
  });

  it("shows the iOS sheet once proven on Safari", () => {
    const d = evaluateA2hs({
      platform: "ios-safari",
      state: proven,
      todayBucket: 101,
      planCompleted: false,
      androidPromptReady: false,
    });
    expect(d).toMatchObject({ show: true, surface: "ios", reason: "eligible" });
  });

  it("android needs a captured beforeinstallprompt", () => {
    const base = {
      platform: "android" as const,
      state: proven,
      todayBucket: 101,
      planCompleted: false,
    };
    expect(evaluateA2hs({ ...base, androidPromptReady: false }).show).toBe(false);
    expect(evaluateA2hs({ ...base, androidPromptReady: false }).reason).toBe(
      "android-prompt-unavailable",
    );
    expect(evaluateA2hs({ ...base, androidPromptReady: true })).toMatchObject({
      show: true,
      surface: "android",
    });
  });

  it("first completed night proves value even on the first day", () => {
    const d = evaluateA2hs({
      platform: "ios-safari",
      state: { ...EMPTY_A2HS_STATE, firstDayBucket: 100 },
      todayBucket: 100,
      planCompleted: true,
      androidPromptReady: false,
    });
    expect(d.show).toBe(true);
  });

  it("never shows when standalone / unsupported / already installed / dismissed", () => {
    const common = { state: proven, todayBucket: 101, planCompleted: true, androidPromptReady: true };
    expect(evaluateA2hs({ ...common, platform: "standalone" }).reason).toBe("standalone");
    expect(evaluateA2hs({ ...common, platform: "unsupported" }).reason).toBe(
      "unsupported-platform",
    );
    expect(
      evaluateA2hs({ ...common, platform: "ios-safari", state: registerInstalled(proven) }).reason,
    ).toBe("already-installed");
    expect(
      evaluateA2hs({
        ...common,
        platform: "ios-safari",
        state: registerDismissedForever(proven),
      }).reason,
    ).toBe("dismissed-forever");
  });

  it("honours the decline cooldown", () => {
    const declined = registerDecline(proven, 101);
    expect(
      evaluateA2hs({
        platform: "ios-safari",
        state: declined,
        todayBucket: 101 + 5,
        planCompleted: true,
        androidPromptReady: false,
      }).reason,
    ).toBe("decline-cooldown");
    expect(
      evaluateA2hs({
        platform: "ios-safari",
        state: declined,
        todayBucket: 101 + A2HS_DECLINE_COOLDOWN_DAYS,
        planCompleted: true,
        androidPromptReady: false,
      }).show,
    ).toBe(true);
  });
});

describe("storage-backed wrappers", () => {
  let storage: Storage;
  beforeEach(() => {
    storage = makeMemoryStorage();
    installWindow(storage);
  });

  it("reads empty on a fresh store and round-trips a write", () => {
    expect(readA2hsState()).toEqual(EMPTY_A2HS_STATE);
    writeA2hsState({ ...EMPTY_A2HS_STATE, firstDayBucket: 42 });
    expect(readA2hsState().firstDayBucket).toBe(42);
  });

  it("recordA2hsVisit accrues the second-visit-day signal across days", () => {
    const day = (n: number) => new Date(n * 86_400_000);
    recordA2hsVisit(day(100));
    expect(readA2hsState().secondDayBucket).toBeNull();
    recordA2hsVisit(day(100)); // same day — no change
    expect(readA2hsState().secondDayBucket).toBeNull();
    recordA2hsVisit(day(101)); // next day — proven
    expect(readA2hsState().secondDayBucket).toBe(dayBucketFromDate(day(101)));
  });
});
