import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ArrivalWelcomeLine } from "@/components/auth/ArrivalWelcome";
import {
  ARRIVAL_INTENT_TTL_MS,
  ARRIVAL_WELCOME_TTL_MS,
  arrivalDestination,
  arrivalWelcomeLine,
  clearArrival,
  markArrival,
  parseArrivalIntent,
  peekArrival,
  rememberChosenIntent,
  takeChosenIntent,
  type ArrivalStorage,
} from "@/lib/arrivalWelcome";

function memoryStorage(): ArrivalStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

function hostileStorage(): ArrivalStorage {
  return {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
    removeItem: () => {
      throw new Error("blocked");
    },
  };
}

describe("arrival marker", () => {
  it("survives a read so the greeting can wait for the handle lookup", () => {
    const storage = memoryStorage();
    markArrival(storage, "signin", 1_000);
    expect(peekArrival(storage, 1_100)).toBe("signin");
    // Still there: the caller clears it when it actually shows the line.
    expect(peekArrival(storage, 1_200)).toBe("signin");
    clearArrival(storage);
    expect(peekArrival(storage, 1_300)).toBeNull();
  });

  it("expires, so an abandoned sign-in never greets an unrelated page later", () => {
    const storage = memoryStorage();
    markArrival(storage, "signin", 1_000);
    expect(peekArrival(storage, 1_000 + ARRIVAL_WELCOME_TTL_MS)).toBeNull();
    expect(storage.map.size).toBe(0);
  });

  it("treats unreadable and corrupt markers as no arrival", () => {
    expect(peekArrival(hostileStorage(), 1_000)).toBeNull();
    expect(peekArrival(null, 1_000)).toBeNull();
    const storage = memoryStorage();
    storage.map.set("pubmax:arrival-welcome:v1", "{not json");
    expect(peekArrival(storage, 1_000)).toBeNull();
  });

  it("never throws when storage is blocked", () => {
    expect(() => markArrival(hostileStorage(), "signup", 1_000)).not.toThrow();
    expect(() => clearArrival(hostileStorage())).not.toThrow();
  });
});

describe("the door a person chose", () => {
  it("is remembered across the trip to the inbox, then consumed once", () => {
    const storage = memoryStorage();
    rememberChosenIntent(storage, "signup", 1_000);
    expect(takeChosenIntent(storage, 2_000)).toBe("signup");
    expect(takeChosenIntent(storage, 2_000)).toBe("signin");
  });

  it("falls back to the returning greeting when stale, missing or unreadable", () => {
    const storage = memoryStorage();
    rememberChosenIntent(storage, "signup", 1_000);
    expect(takeChosenIntent(storage, 1_000 + ARRIVAL_INTENT_TTL_MS)).toBe("signin");
    expect(takeChosenIntent(memoryStorage(), 1_000)).toBe("signin");
    expect(takeChosenIntent(hostileStorage(), 1_000)).toBe("signin");
    expect(takeChosenIntent(null, 1_000)).toBe("signin");
  });

  it("reads only the two known doors out of the URL", () => {
    expect(parseArrivalIntent("signup")).toBe("signup");
    expect(parseArrivalIntent("signin")).toBe("signin");
    expect(parseArrivalIntent("register")).toBe("signin");
    expect(parseArrivalIntent(null)).toBe("signin");
  });
});

describe("where a completed sign-in lands", () => {
  it("returns a signed-in drinker to the page they came from", () => {
    expect(arrivalDestination("signin", "/map?sel=the-eagle", "/u/you")).toBe(
      "/map?sel=the-eagle",
    );
    expect(arrivalDestination("signin", "/tonight", "/u/you")).toBe("/tonight");
  });

  it("never lands anyone back on a sign-in page", () => {
    for (const dead of ["/login", "/login?mode=signup", "/signin", "/signin/"]) {
      expect(arrivalDestination("signin", dead, "/u/you")).toBe("/u/you");
    }
  });

  it("refuses an off-site or malformed return path", () => {
    for (const hostile of ["//evil.test/map", "https://evil.test", "\\evil", "map", ""]) {
      expect(arrivalDestination("signin", hostile, "/u/you")).toBe("/u/you");
    }
    expect(arrivalDestination("signin", null, "/u/you")).toBe("/u/you");
  });

  it("sends a new account to the surface that finishes it, whatever it came from", () => {
    expect(arrivalDestination("signup", "/map", "/u/you")).toBe("/u/you");
  });
});

describe("the arrival line", () => {
  it("names the person and differs by door", () => {
    expect(arrivalWelcomeLine("signin", "karan")).toBe("Welcome back, @karan.");
    expect(arrivalWelcomeLine("signup", "karan")).toBe("You are in, @karan.");
    expect(arrivalWelcomeLine("signin", "@karan")).toBe("Welcome back, @karan.");
  });

  it("says nothing rather than greeting nobody", () => {
    expect(arrivalWelcomeLine("signin", "")).toBe("");
    expect(arrivalWelcomeLine("signup", "@")).toBe("");
  });

  it("is a live region, never a dialog that can cover a page", () => {
    const html = renderToStaticMarkup(
      createElement(ArrivalWelcomeLine, {
        line: "Welcome back, @karan.",
        leaving: false,
        onDismiss: () => {},
      }),
    );
    expect(html).toContain("Welcome back, @karan.");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("aria-modal");
    expect(html).not.toContain("Backdrop");
  });

  it("floats below the modal layer and takes no pointer events of its own", () => {
    const css = readFileSync(
      join(process.cwd(), "components/auth/arrivalWelcome.css"),
      "utf8",
    );
    expect(css).toMatch(
      /\.arrivalWelcome\s*\{[^}]*z-index: calc\(var\(--z-modal, 1200\) - 1\)/,
    );
    expect(css).toMatch(/\.arrivalWelcome\s*\{[^}]*pointer-events: none/);
    expect(css).toMatch(/\.arrivalWelcomeDismiss\s*\{[^}]*pointer-events: auto/);
    // Reduced motion keeps the greeting and drops the travel.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toContain("arrivalWelcomeFadeIn");
  });
});
