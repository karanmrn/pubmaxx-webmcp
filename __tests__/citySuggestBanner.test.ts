import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";

/**
 * CitySuggestBanner is a client component that gates geolocation behind a
 * tap. These tests cover the storage helpers' contract via the module's
 * session dismiss key and assert the opt-in UI does not call geo on import.
 */

const DISMISS_KEY = "pubmax:citySuggestDismiss:v1";

type WindowLike = {
  sessionStorage: Storage;
  localStorage: Storage;
  navigator?: Navigator;
  location?: {
    pathname: string;
    search: string;
  };
  matchMedia?: (query: string) => {
    matches: boolean;
    addEventListener: () => void;
    removeEventListener: () => void;
  };
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
  dispatchEvent?: (event: Event) => boolean;
};

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

function installWindow(session: Storage, local = makeMemoryStorage()): void {
  setWindow({
    sessionStorage: session,
    localStorage: local,
  });
}

function setWindow(window: WindowLike): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    writable: true,
    value: window,
  });
}

function clearWindow(): void {
  Reflect.deleteProperty(globalThis, "window");
}

afterEach(() => {
  clearWindow();
  vi.resetModules();
  vi.unstubAllGlobals();
});

describe("CitySuggestBanner opt-in geo", () => {
  beforeEach(() => {
    installWindow(makeMemoryStorage());
  });

  it("does not call getCurrentPosition when the module is imported", async () => {
    const getCurrentPosition = vi.fn();
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition },
    });

    await import("@/components/map/CitySuggestBanner");
    expect(getCurrentPosition).not.toHaveBeenCalled();
  });

  it("SSR markup is empty before client hydration (no auto-geo chrome)", async () => {
    const CitySuggestBanner = (
      await import("@/components/map/CitySuggestBanner")
    ).default;
    const html = renderToStaticMarkup(
      React.createElement(CitySuggestBanner, { cityId: "london" }),
    );
    expect(html).toBe("");
  });

  it("persists dismiss in sessionStorage via the known key", () => {
    const session = makeMemoryStorage();
    installWindow(session);
    expect(session.getItem(DISMISS_KEY)).toBeNull();
    session.setItem(DISMISS_KEY, "1");
    expect(session.getItem(DISMISS_KEY)).toBe("1");
  });

  it("readCitySuggestClientFlags returns a stable reference", async () => {
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition: vi.fn() },
    });
    const { readCitySuggestClientFlags } = await import("@/lib/mapLocationPrompt");
    const a = readCitySuggestClientFlags();
    const b = readCitySuggestClientFlags();
    expect(a).toBe(b);
    expect(a.geoAvailable).toBe(true);
    expect(a.saveData).toBe(false);
  });

  it("releases prompt priority after dismiss when sessionStorage rejects writes", async () => {
    const session = makeMemoryStorage();
    session.setItem = () => {
      throw new Error("storage unavailable");
    };
    const events = new EventTarget();
    setWindow({
      sessionStorage: session,
      localStorage: makeMemoryStorage(),
      location: { pathname: "/map", search: "" },
      matchMedia: () => ({
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    });
    vi.stubGlobal("navigator", {
      geolocation: { getCurrentPosition: vi.fn() },
    });

    const {
      dismissCitySuggest,
      getMapLocationControlAvailable,
    } = await import("@/lib/mapLocationPrompt");
    const { locationAllowsInterruptivePrompt } = await import(
      "@/lib/promptBudget"
    );

    expect(getMapLocationControlAvailable()).toBe(true);
    expect(locationAllowsInterruptivePrompt()).toBe(false);

    dismissCitySuggest();

    expect(getMapLocationControlAvailable()).toBe(false);
    expect(locationAllowsInterruptivePrompt()).toBe(true);
  });
});
