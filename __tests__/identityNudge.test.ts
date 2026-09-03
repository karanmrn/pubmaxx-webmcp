import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Gate + storage behaviour for the signed-out identity nudge
// (lib/identityNudge.ts). The nudge must never fire once signed in, never for a
// crawler/SSR path, only after a qualifying plan/moment action, and — unlike the
// native push gate — stay shut for N days after a "not now" before re-opening on
// the next qualifying action. Browsing is never gated: no trigger, no nudge.
//
// Node env (vitest.config.ts): we install an in-memory window/localStorage the
// same way __tests__/activePlan.test.ts does, and stub dispatchEvent so the
// same-tab notify() never throws.
import {
  IDENTITY_NUDGE_COOLDOWN_MS,
  IDENTITY_NUDGE_PENDING_TTL_MS,
  getIdentityNudgeClientSnapshot,
  getIdentityNudgeServerSnapshot,
  identityNudgeAuthNext,
  isIdentityNudgePending,
  isWebCrawler,
  markIdentityNudgeAccepted,
  markIdentityNudgeDismissed,
  recordMomentNudgeTrigger,
  recordPlanNudgeTrigger,
  resetIdentityNudge,
  shouldOfferIdentityNudge,
  type IdentityNudgeGateState,
} from "@/lib/identityNudge";
import { accountClaimReturnToFromUrl } from "@/lib/accountClaimReturnTo";

type WindowLike = { localStorage: Storage };

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

function installWindow(): void {
  const w = globalThis as { window?: WindowLike };
  w.window = { localStorage: makeMemoryStorage() };
  (w.window as unknown as { dispatchEvent?: () => boolean }).dispatchEvent = () => true;
}

function clearWindow(): void {
  delete (globalThis as { window?: WindowLike }).window;
}

const NOW = 1_800_000_000_000;
const PLAN_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function baseState(): IdentityNudgeGateState {
  return {
    pendingTrigger: "plan",
    signedIn: false,
    isCrawler: false,
    lastDismissedAt: null,
    now: NOW,
    cooldownMs: IDENTITY_NUDGE_COOLDOWN_MS,
  };
}

afterEach(() => {
  clearWindow();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("shouldOfferIdentityNudge — pure gate", () => {
  it("offers after a qualifying action for a signed-out human", () => {
    expect(shouldOfferIdentityNudge(baseState())).toBe(true);
  });

  it("never offers with no pending trigger (browsing is never gated)", () => {
    expect(shouldOfferIdentityNudge({ ...baseState(), pendingTrigger: null })).toBe(false);
  });

  it("never offers once signed in", () => {
    expect(shouldOfferIdentityNudge({ ...baseState(), signedIn: true })).toBe(false);
  });

  it("never offers to a web crawler / SSR path", () => {
    expect(shouldOfferIdentityNudge({ ...baseState(), isCrawler: true })).toBe(false);
  });

  it("stays shut within the cooldown after a 'not now'", () => {
    expect(
      shouldOfferIdentityNudge({
        ...baseState(),
        lastDismissedAt: NOW - (IDENTITY_NUDGE_COOLDOWN_MS - 1),
      }),
    ).toBe(false);
  });

  it("re-opens once the cooldown has fully elapsed", () => {
    expect(
      shouldOfferIdentityNudge({
        ...baseState(),
        lastDismissedAt: NOW - IDENTITY_NUDGE_COOLDOWN_MS,
      }),
    ).toBe(true);
  });

  it("offers for the moment trigger too", () => {
    expect(shouldOfferIdentityNudge({ ...baseState(), pendingTrigger: "moment" })).toBe(true);
  });
});

describe("isWebCrawler", () => {
  it("is false when navigator is absent (SSR / node)", () => {
    expect(isWebCrawler()).toBe(false);
  });

  it("detects a bot user-agent", () => {
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)" });
    expect(isWebCrawler()).toBe(true);
  });

  it("passes a normal mobile browser user-agent", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    });
    expect(isWebCrawler()).toBe(false);
  });
});

describe("identity nudge store (localStorage-backed)", () => {
  beforeEach(() => {
    installWindow();
    resetIdentityNudge();
    vi.spyOn(Date, "now").mockReturnValue(NOW);
  });

  it("arms the plan trigger and surfaces it in the client snapshot", () => {
    expect(getIdentityNudgeClientSnapshot()).toBeNull();
    recordPlanNudgeTrigger();
    expect(getIdentityNudgeClientSnapshot()).toBe("plan");
    expect(isIdentityNudgePending()).toBe(true);
  });

  it("carries the Plan return through account claim completion", () => {
    recordPlanNudgeTrigger(PLAN_ID);
    const next = identityNudgeAuthNext();

    expect(next).toBe(`/u/you?returnTo=${encodeURIComponent(`/plan/${PLAN_ID}`)}`);
    expect(accountClaimReturnToFromUrl(`https://pubmaxxing.com${next}`)).toBe(
      `/plan/${PLAN_ID}`,
    );

    markIdentityNudgeAccepted();
    expect(identityNudgeAuthNext()).toBeUndefined();
  });

  it("arms the moment trigger", () => {
    recordMomentNudgeTrigger();
    expect(getIdentityNudgeClientSnapshot()).toBe("moment");
  });

  it("keeps the first trigger's copy when a second action arrives before resolution", () => {
    recordPlanNudgeTrigger();
    recordMomentNudgeTrigger();
    expect(getIdentityNudgeClientSnapshot()).toBe("plan");
  });

  it("'not now' clears the pending trigger and starts the cooldown", () => {
    recordPlanNudgeTrigger();
    markIdentityNudgeDismissed();
    expect(getIdentityNudgeClientSnapshot()).toBeNull();
    expect(isIdentityNudgePending()).toBe(false);

    // A fresh action during the cooldown does not re-open the nudge...
    recordPlanNudgeTrigger();
    expect(getIdentityNudgeClientSnapshot()).toBeNull();

    // ...but a fresh action once the cooldown has elapsed does. (The action must
    // be fresh — a pending trigger armed 7 days earlier is long past its TTL, so
    // we re-arm at the post-cooldown moment rather than reusing the stale flag.)
    vi.spyOn(Date, "now").mockReturnValue(NOW + IDENTITY_NUDGE_COOLDOWN_MS);
    recordPlanNudgeTrigger();
    expect(getIdentityNudgeClientSnapshot()).toBe("plan");
  });

  it("accepting clears the pending trigger without arming the cooldown", () => {
    recordPlanNudgeTrigger();
    markIdentityNudgeAccepted();
    expect(getIdentityNudgeClientSnapshot()).toBeNull();
    // No cooldown was set, so the very next qualifying action can offer again.
    recordPlanNudgeTrigger();
    expect(getIdentityNudgeClientSnapshot()).toBe("plan");
  });

  it("resetIdentityNudge clears both pending and cooldown state", () => {
    recordPlanNudgeTrigger();
    markIdentityNudgeDismissed();
    resetIdentityNudge();
    recordMomentNudgeTrigger();
    expect(getIdentityNudgeClientSnapshot()).toBe("moment");
  });

  it("expires a stale pending trigger after the TTL and self-clears it on read", () => {
    recordPlanNudgeTrigger();
    expect(getIdentityNudgeClientSnapshot()).toBe("plan");

    // Still valid a moment before the TTL elapses.
    vi.spyOn(Date, "now").mockReturnValue(NOW + IDENTITY_NUDGE_PENDING_TTL_MS - 1);
    expect(getIdentityNudgeClientSnapshot()).toBe("plan");

    // At/after the TTL the stale trigger no longer surfaces and is cleared —
    // this is the "fires at first paint long after the action" bug, fixed.
    vi.spyOn(Date, "now").mockReturnValue(NOW + IDENTITY_NUDGE_PENDING_TTL_MS);
    expect(getIdentityNudgeClientSnapshot()).toBeNull();
    expect(isIdentityNudgePending()).toBe(false);
  });

  it("re-arms cleanly when a fresh action follows an expired pending", () => {
    recordPlanNudgeTrigger();
    // Jump past the TTL: the old plan trigger is now stale.
    vi.spyOn(Date, "now").mockReturnValue(NOW + IDENTITY_NUDGE_PENDING_TTL_MS);
    expect(getIdentityNudgeClientSnapshot()).toBeNull();
    // A genuinely recent action arms afresh (not swallowed by the stale flag).
    recordMomentNudgeTrigger();
    expect(getIdentityNudgeClientSnapshot()).toBe("moment");
  });
});

describe("identity nudge — SSR safety", () => {
  it("no-ops and stays hidden with no window", () => {
    // No installWindow(): typeof window === "undefined".
    expect(() => recordPlanNudgeTrigger()).not.toThrow();
    expect(getIdentityNudgeClientSnapshot()).toBeNull();
    expect(getIdentityNudgeServerSnapshot()).toBeNull();
    expect(isIdentityNudgePending()).toBe(false);
  });
});

// `window.localStorage` is a PROPERTY GETTER that RAISES when the browser
// refuses site data (Chrome "Block all cookies", or a sandboxed frame without
// allow-same-origin), so naming the identifier is itself a throwing expression.
// AuthProvider renders the nudge on EVERY page, and its client snapshot runs
// during render, so a throw here is not a lost nudge - it is the whole site on
// the error boundary.
describe("identity nudge — the browser refuses site data", () => {
  function installBlockedWindow(): void {
    const refuse = (): never => {
      throw new Error("SecurityError: site data is blocked");
    };
    const w = globalThis as { window?: unknown };
    const blocked = { dispatchEvent: () => true };
    Object.defineProperty(blocked, "localStorage", { configurable: true, get: refuse });
    w.window = blocked;
  }

  beforeEach(() => {
    installBlockedWindow();
  });

  afterEach(() => {
    clearWindow();
  });

  it("reads as no nudge rather than throwing out of the render", () => {
    expect(() => getIdentityNudgeClientSnapshot()).not.toThrow();
    expect(getIdentityNudgeClientSnapshot()).toBeNull();
    expect(() => isIdentityNudgePending()).not.toThrow();
    expect(isIdentityNudgePending()).toBe(false);
  });

  it("swallows every write the same way", () => {
    expect(() => recordPlanNudgeTrigger()).not.toThrow();
    expect(() => recordMomentNudgeTrigger()).not.toThrow();
    expect(() => markIdentityNudgeDismissed()).not.toThrow();
    expect(() => markIdentityNudgeAccepted()).not.toThrow();
    expect(() => resetIdentityNudge()).not.toThrow();
  });
});
