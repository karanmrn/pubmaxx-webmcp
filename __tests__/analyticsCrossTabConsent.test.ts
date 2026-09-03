import { afterEach, describe, expect, it, vi } from "vitest";

const CONSENT_KEY = "pubmaxx:analytics-consent:v1";
const OUTBOX_KEY = "pubmaxx:analytics-verified-outbox:v1";
const posthogState = vi.hoisted(() => ({
  initCount: 0,
  moduleLoads: 0,
  optedIn: false,
}));

vi.mock("posthog-js", () => {
  posthogState.moduleLoads += 1;
  return {
    default: {
      init: () => { posthogState.initCount += 1; },
      opt_in_capturing: () => { posthogState.optedIn = true; },
      opt_out_capturing: () => { posthogState.optedIn = false; },
      has_opted_in_capturing: () => posthogState.optedIn,
    },
  };
});

type StorageListener = (event: StorageEvent) => void;
type TestWindow = Window & {
  __listeners: Set<StorageListener>;
  __navigator: Navigator;
};

function setGlobal(name: "window" | "navigator", value: unknown): void {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
}

class SharedLocalStorage {
  private readonly values = new Map<string, string>();
  private readonly windows = new Set<TestWindow>();

  createWindow(): TestWindow {
    const listeners = new Set<StorageListener>();
    const storage = {
      get length() { return 0; },
      clear: () => undefined,
      key: () => null,
      getItem: (key: string) => this.values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        const oldValue = this.values.get(key) ?? null;
        this.values.set(key, value);
        this.dispatch(owner, key, oldValue, value);
      },
      removeItem: (key: string) => {
        const oldValue = this.values.get(key) ?? null;
        this.values.delete(key);
        this.dispatch(owner, key, oldValue, null);
      },
    } satisfies Storage;
    const owner = {
      __listeners: listeners,
      __navigator: { doNotTrack: "0" } as Navigator,
      location: { pathname: "/plan" },
      localStorage: storage,
      addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
        if (type === "storage" && typeof listener === "function") {
          listeners.add(listener as StorageListener);
        }
      },
    } as unknown as TestWindow;
    this.windows.add(owner);
    return owner;
  }

  private dispatch(owner: TestWindow, key: string, oldValue: string | null, newValue: string | null): void {
    for (const target of this.windows) {
      if (target === owner) continue;
      const previousWindow = globalThis.window;
      const previousNavigator = globalThis.navigator;
      setGlobal("window", target);
      setGlobal("navigator", target.__navigator);
      for (const listener of target.__listeners) {
        listener({ key, oldValue, newValue, storageArea: target.localStorage } as StorageEvent);
      }
      setGlobal("window", previousWindow);
      setGlobal("navigator", previousNavigator);
    }
  }
}

async function inWindow<T>(target: TestWindow, run: () => T | Promise<T>): Promise<T> {
  const previousWindow = globalThis.window;
  const previousNavigator = globalThis.navigator;
  setGlobal("window", target);
  setGlobal("navigator", target.__navigator);
  try {
    return await run();
  } finally {
    setGlobal("window", previousWindow);
    setGlobal("navigator", previousNavigator);
  }
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setGlobal("window", undefined);
  setGlobal("navigator", undefined);
  posthogState.initCount = 0;
  posthogState.moduleLoads = 0;
  posthogState.optedIn = false;
});

describe("verified analytics cross-tab consent", () => {
  it("loads the browser SDK only after consent is granted", async () => {
    const previousToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";

    try {
      vi.resetModules();
      const posthogClient = await import("@/lib/posthogClient");

      expect(posthogState.moduleLoads).toBe(0);
      posthogClient.initializePosthog(false);
      expect(posthogState.initCount).toBe(0);
      expect(posthogState.moduleLoads).toBe(0);

      posthogClient.syncPosthogConsent(true);
      await vi.waitFor(() => {
        expect(posthogState.initCount).toBe(1);
        expect(posthogState.optedIn).toBe(true);
      });
    } finally {
      if (previousToken === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
      else process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = previousToken;
    }
  });

  it("does not initialize the browser SDK after consent is revoked during loading", async () => {
    const previousToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";

    try {
      vi.resetModules();
      const posthogClient = await import("@/lib/posthogClient");

      posthogClient.syncPosthogConsent(true);
      posthogClient.syncPosthogConsent(false);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(posthogState.initCount).toBe(0);
      expect(posthogState.optedIn).toBe(false);
    } finally {
      if (previousToken === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
      else process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = previousToken;
    }
  });

  it("opts the browser SDK out when another tab revokes consent", async () => {
    const previousToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
    process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
    const shared = new SharedLocalStorage();
    const tabA = shared.createWindow();
    const tabB = shared.createWindow();

    try {
      vi.resetModules();
      const analytics = await inWindow(tabA, () => import("@/lib/analytics"));
      const posthogClient = await inWindow(tabA, () => import("@/lib/posthogClient"));
      await inWindow(tabA, () => {
        posthogClient.initializePosthog(false);
        analytics.setAnalyticsConsent(true);
      });
      await vi.waitFor(() => expect(posthogState.optedIn).toBe(true));

      await inWindow(tabB, () => tabB.localStorage.removeItem(CONSENT_KEY));

      expect(posthogState.optedIn).toBe(false);
    } finally {
      if (previousToken === undefined) delete process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
      else process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = previousToken;
    }
  });

  it("cannot replay a tab-local verified event after another tab revokes then re-grants consent", async () => {
    const shared = new SharedLocalStorage();
    const tabA = shared.createWindow();
    const tabB = shared.createWindow();
    let resolveDelivery!: (response: Response) => void;
    const delivery = new Promise<Response>((resolve) => { resolveDelivery = resolve; });
    const fetchMock = vi.fn().mockReturnValue(delivery);
    vi.stubGlobal("fetch", fetchMock);

    vi.resetModules();
    const analyticsA = await inWindow(tabA, () => import("@/lib/analytics"));
    await inWindow(tabA, async () => {
      analyticsA.setAnalyticsConsent(true);
      analyticsA.trackEvent("plan_accepted", {
        stops: 3,
        grounded: true,
        anchored: true,
        routeReady: true,
        source: "near",
      }, { deliveryToken: "signed-token-tab-a" });
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    });
    expect(tabA.localStorage.getItem(OUTBOX_KEY)).toContain("signed-token-tab-a");

    vi.resetModules();
    const analyticsB = await inWindow(tabB, () => import("@/lib/analytics"));
    await inWindow(tabB, () => analyticsB.setAnalyticsConsent(false));

    expect(tabA.localStorage.getItem(CONSENT_KEY)).toBe("denied");
    expect(tabA.localStorage.getItem(OUTBOX_KEY)).toBeNull();
    const firstSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal as AbortSignal;
    expect(firstSignal.aborted).toBe(true);

    await inWindow(tabB, () => analyticsB.setAnalyticsConsent(true));
    resolveDelivery(new Response(null, {
      status: 204,
      headers: { "x-analytics-delivery": "delivered" },
    }));
    await Promise.resolve();
    await inWindow(tabA, () => analyticsA.flushVerifiedAnalyticsOutbox());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tabA.localStorage.getItem(OUTBOX_KEY)).toBeNull();
  });
});
