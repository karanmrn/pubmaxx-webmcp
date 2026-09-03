import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Morning re-entry marker: TTL + one-time + same-session-suppress logic
// (lib/morningReentry.ts). The pure gate (shouldShowMorningCard) is tested
// directly; the storage wrappers run against an in-memory window (Node env),
// the same idiom as __tests__/identityNudge.test.ts / activePlan.test.ts.
import {
  MORNING_REENTRY_TTL_MS,
  MORNING_REENTRY_VERSION,
  isMorningCardShown,
  markMorningCardShown,
  parseCompletedNight,
  readPendingCompletedNight,
  readShowableMorningNight,
  recordCompletedNight,
  resetMorningReentry,
  serializeCompletedNight,
  shouldShowMorningCard,
  type CompletedNight,
} from "@/lib/morningReentry";

const PLAN_ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const NOW = 1_800_000_000_000;

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
  const w = globalThis as { window?: unknown };
  w.window = {
    localStorage: makeMemoryStorage(),
    sessionStorage: makeMemoryStorage(),
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
}

function night(completedAt: string, planId = PLAN_ID): CompletedNight {
  return { version: MORNING_REENTRY_VERSION, planId, title: "Soho three-pinter", completedAt };
}

beforeEach(() => {
  installWindow();
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("shouldShowMorningCard (pure gate)", () => {
  const iso = new Date(NOW).toISOString();

  it("returns null when there is no pending night", () => {
    expect(
      shouldShowMorningCard({ night: null, now: NOW, ttlMs: MORNING_REENTRY_TTL_MS, alreadyShown: false, suppressedThisSession: false }),
    ).toBeNull();
  });

  it("shows a fresh completed night inside the TTL", () => {
    const value = night(iso);
    expect(
      shouldShowMorningCard({ night: value, now: NOW + 60_000, ttlMs: MORNING_REENTRY_TTL_MS, alreadyShown: false, suppressedThisSession: false }),
    ).toEqual(value);
  });

  it("never shows once already shown (one-time)", () => {
    expect(
      shouldShowMorningCard({ night: night(iso), now: NOW, ttlMs: MORNING_REENTRY_TTL_MS, alreadyShown: true, suppressedThisSession: false }),
    ).toBeNull();
  });

  it("holds the card while completion is from this same session", () => {
    expect(
      shouldShowMorningCard({ night: night(iso), now: NOW, ttlMs: MORNING_REENTRY_TTL_MS, alreadyShown: false, suppressedThisSession: true }),
    ).toBeNull();
  });

  it("does not show past the TTL (not a week later)", () => {
    expect(
      shouldShowMorningCard({ night: night(iso), now: NOW + MORNING_REENTRY_TTL_MS + 1, ttlMs: MORNING_REENTRY_TTL_MS, alreadyShown: false, suppressedThisSession: false }),
    ).toBeNull();
  });

  it("shows exactly at the TTL edge but not before completion", () => {
    const value = night(iso);
    expect(
      shouldShowMorningCard({ night: value, now: NOW + MORNING_REENTRY_TTL_MS, ttlMs: MORNING_REENTRY_TTL_MS, alreadyShown: false, suppressedThisSession: false }),
    ).toEqual(value);
    expect(
      shouldShowMorningCard({ night: value, now: NOW - 1, ttlMs: MORNING_REENTRY_TTL_MS, alreadyShown: false, suppressedThisSession: false }),
    ).toBeNull();
  });

  it("rejects an unparseable completedAt", () => {
    expect(
      shouldShowMorningCard({ night: night("not-a-date"), now: NOW, ttlMs: MORNING_REENTRY_TTL_MS, alreadyShown: false, suppressedThisSession: false }),
    ).toBeNull();
  });
});

describe("parse / serialize", () => {
  it("round-trips a valid night and clamps the title", () => {
    const value = night(new Date(NOW).toISOString());
    expect(parseCompletedNight(serializeCompletedNight(value))).toEqual(value);
  });

  it("rejects malformed / wrong-version / bad-id payloads", () => {
    expect(parseCompletedNight(null)).toBeNull();
    expect(parseCompletedNight("{not json")).toBeNull();
    expect(parseCompletedNight(JSON.stringify({ version: 2, planId: PLAN_ID, completedAt: new Date(NOW).toISOString() }))).toBeNull();
    expect(parseCompletedNight(JSON.stringify({ version: MORNING_REENTRY_VERSION, planId: "nope", completedAt: new Date(NOW).toISOString() }))).toBeNull();
    expect(parseCompletedNight(JSON.stringify({ version: MORNING_REENTRY_VERSION, planId: PLAN_ID, completedAt: "bad" }))).toBeNull();
  });
});

describe("record / read / one-time storage", () => {
  it("arms a completed night that a fresh open can then show", () => {
    recordCompletedNight(night(new Date(NOW).toISOString()), { suppressThisSession: false });
    expect(readPendingCompletedNight()?.planId).toBe(PLAN_ID);
    expect(readShowableMorningNight(NOW + 60_000)?.planId).toBe(PLAN_ID);
  });

  it("suppresses the card in the session it was completed in", () => {
    recordCompletedNight(night(new Date(NOW).toISOString()), { suppressThisSession: true });
    // Still stored...
    expect(readPendingCompletedNight()?.planId).toBe(PLAN_ID);
    // ...but not eligible to show until the next (fresh) session.
    expect(readShowableMorningNight(NOW + 60_000)).toBeNull();
  });

  it("marks shown once and never resurrects the card", () => {
    recordCompletedNight(night(new Date(NOW).toISOString()), { suppressThisSession: false });
    markMorningCardShown(PLAN_ID);

    expect(isMorningCardShown(PLAN_ID)).toBe(true);
    expect(readPendingCompletedNight()).toBeNull();
    expect(readShowableMorningNight(NOW + 60_000)).toBeNull();

    // A later re-record (e.g. another re-entry seed) must not bring it back.
    recordCompletedNight(night(new Date(NOW + 1000).toISOString()), { suppressThisSession: false });
    expect(readPendingCompletedNight()).toBeNull();
    expect(readShowableMorningNight(NOW + 2000)).toBeNull();
  });

  it("keeps the newest completed night and ignores an older re-record", () => {
    const newer = new Date(NOW + 10 * 60_000).toISOString();
    const older = new Date(NOW).toISOString();
    recordCompletedNight(night(newer, PLAN_ID), { suppressThisSession: false });
    recordCompletedNight(night(older, OTHER_ID), { suppressThisSession: false });
    expect(readPendingCompletedNight()?.completedAt).toBe(newer);
    expect(readPendingCompletedNight()?.planId).toBe(PLAN_ID);
  });

  it("resetMorningReentry clears pending and per-plan shown state", () => {
    recordCompletedNight(night(new Date(NOW).toISOString()), { suppressThisSession: false });
    markMorningCardShown(PLAN_ID);
    resetMorningReentry(PLAN_ID);
    expect(readPendingCompletedNight()).toBeNull();
    expect(isMorningCardShown(PLAN_ID)).toBe(false);
  });
});
