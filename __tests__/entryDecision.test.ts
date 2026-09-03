import { describe, expect, it } from "vitest";

// Contract tests for the entry-decision seam (lib/entryDecision.ts, issue
// #439 + owner amendment 2026-07-21). Precedence under test: deep links bypass
// untouched (shell or not), then a native first-run opens the dedicated
// onboarding, then a session-revisit (the cold-start decision already ran this
// session) stays on the landing page, then a shell cold start lands on
// /tonight, then the browser keeps the landing page.
//
// The 2026-07-21 amendment relaxes "the shell never sees the landing page" to
// "the shell never COLD-STARTS on the landing page": a cold start still lands
// on /tonight, but a later in-app arrival at "/" reaches the landing page.
import {
  consumeDeepLinkBootEntry,
  decideEntry,
  entryFirstRunHref,
  hasConsumedSessionEntry,
  isAppShell,
  markSessionEntryConsumed,
  ONBOARDING_PATH,
  SHELL_START_PATH,
  type EntryContext,
} from "@/lib/entryDecision";

function makeMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

const WEB_ROOT: EntryContext = {
  path: "/",
  isNativeShell: false,
  isStandaloneDisplay: false,
  isNativeFirstRun: false,
  sessionEntryConsumed: false,
};

describe("decideEntry", () => {
  it("locks the shell start surface to /tonight", () => {
    expect(SHELL_START_PATH).toBe("/tonight");
  });

  it("web default: a browser visit at the root keeps the landing page", () => {
    expect(decideEntry(WEB_ROOT)).toEqual({ kind: "stay", reason: "web-default" });
  });

  it("native shell cold start at the root lands on /tonight", () => {
    expect(decideEntry({ ...WEB_ROOT, isNativeShell: true })).toEqual({
      kind: "route",
      href: SHELL_START_PATH,
      reason: "shell-cold-start",
    });
  });

  it("installed-PWA standalone launch at the root lands on /tonight", () => {
    expect(decideEntry({ ...WEB_ROOT, isStandaloneDisplay: true })).toEqual({
      kind: "route",
      href: SHELL_START_PATH,
      reason: "shell-cold-start",
    });
  });

  it("in-app home tap: a second arrival at the root stays on the landing (native shell)", () => {
    // Owner amendment (2026-07-21): once the session's cold-start decision has
    // run, a later navigation to "/" (wordmark tap) stays on the landing page.
    expect(
      decideEntry({ ...WEB_ROOT, isNativeShell: true, sessionEntryConsumed: true }),
    ).toEqual({ kind: "stay", reason: "session-revisit" });
  });

  it("in-app home tap: a second arrival at the root stays on the landing (standalone PWA)", () => {
    expect(
      decideEntry({ ...WEB_ROOT, isStandaloneDisplay: true, sessionEntryConsumed: true }),
    ).toEqual({ kind: "stay", reason: "session-revisit" });
  });

  it("cold start still lands on /tonight before the session flag is set", () => {
    // The very first arrival this session: flag not yet consumed → /tonight.
    expect(decideEntry({ ...WEB_ROOT, isNativeShell: true })).toEqual({
      kind: "route",
      href: SHELL_START_PATH,
      reason: "shell-cold-start",
    });
  });

  it("native first-run precedence is unchanged even after the session flag is set", () => {
    // First-run stays above the session-revisit check (amendment leaves its
    // precedence untouched): a genuine first-run still opens onboarding.
    expect(
      decideEntry({
        ...WEB_ROOT,
        isNativeShell: true,
        isNativeFirstRun: true,
        sessionEntryConsumed: true,
      }),
    ).toEqual({ kind: "route", href: ONBOARDING_PATH, reason: "native-first-run" });
  });

  it("genuine native first-run opens the dedicated onboarding", () => {
    expect(
      decideEntry({ ...WEB_ROOT, isNativeShell: true, isNativeFirstRun: true }),
    ).toEqual({ kind: "route", href: ONBOARDING_PATH, reason: "native-first-run" });
    expect(entryFirstRunHref()).toBe(ONBOARDING_PATH);
  });

  it("first-run is native-only: a spurious flag never sends a PWA to onboarding", () => {
    expect(
      decideEntry({ ...WEB_ROOT, isStandaloneDisplay: true, isNativeFirstRun: true }),
    ).toEqual({ kind: "route", href: SHELL_START_PATH, reason: "shell-cold-start" });
  });

  it("deep links bypass untouched in the native shell", () => {
    expect(
      decideEntry({ ...WEB_ROOT, path: "/plan/abc123", isNativeShell: true }),
    ).toEqual({ kind: "stay", reason: "deep-link" });
  });

  it("deep links bypass untouched in a standalone PWA", () => {
    expect(
      decideEntry({ ...WEB_ROOT, path: "/pubs/the-crossing", isStandaloneDisplay: true }),
    ).toEqual({ kind: "stay", reason: "deep-link" });
  });

  it("deep links bypass even when the first-run gate is open", () => {
    expect(
      decideEntry({
        ...WEB_ROOT,
        path: "/add/karan",
        isNativeShell: true,
        isNativeFirstRun: true,
      }),
    ).toEqual({ kind: "stay", reason: "deep-link" });
  });

  it("a web deep link never routes anywhere, including /tonight itself", () => {
    expect(decideEntry({ ...WEB_ROOT, path: "/tonight" })).toEqual({
      kind: "stay",
      reason: "deep-link",
    });
  });

  it("never redirects to the landing page from anywhere", () => {
    const contexts: EntryContext[] = [
      WEB_ROOT,
      { ...WEB_ROOT, isNativeShell: true },
      { ...WEB_ROOT, isStandaloneDisplay: true },
      { ...WEB_ROOT, isNativeShell: true, isNativeFirstRun: true },
      { ...WEB_ROOT, path: "/feed", isNativeShell: true },
    ];
    for (const ctx of contexts) {
      const decision = decideEntry(ctx);
      if (decision.kind === "route") expect(decision.href).not.toBe("/");
    }
  });
});

describe("isAppShell", () => {
  it("true for the native shell, the standalone PWA, and both together", () => {
    expect(isAppShell({ isNativeShell: true, isStandaloneDisplay: false })).toBe(true);
    expect(isAppShell({ isNativeShell: false, isStandaloneDisplay: true })).toBe(true);
    expect(isAppShell({ isNativeShell: true, isStandaloneDisplay: true })).toBe(true);
  });

  it("false on the plain web", () => {
    expect(isAppShell({ isNativeShell: false, isStandaloneDisplay: false })).toBe(false);
  });
});

describe("session-entry flag (owner amendment 2026-07-21)", () => {
  it("reads false until marked, then true for the rest of the session", () => {
    const storage = makeMemoryStorage();
    expect(hasConsumedSessionEntry(storage)).toBe(false);
    markSessionEntryConsumed(storage);
    expect(hasConsumedSessionEntry(storage)).toBe(true);
  });

  it("full cold-start → revisit lifecycle: /tonight first, landing after", () => {
    const storage = makeMemoryStorage();
    // Cold start: flag unset → shell lands on /tonight.
    const cold = decideEntry({
      ...WEB_ROOT,
      isNativeShell: true,
      sessionEntryConsumed: hasConsumedSessionEntry(storage),
    });
    expect(cold).toEqual({ kind: "route", href: SHELL_START_PATH, reason: "shell-cold-start" });
    // The component stamps the flag after deciding.
    markSessionEntryConsumed(storage);
    // In-app home tap: flag set → stays on the landing page.
    const revisit = decideEntry({
      ...WEB_ROOT,
      isNativeShell: true,
      sessionEntryConsumed: hasConsumedSessionEntry(storage),
    });
    expect(revisit).toEqual({ kind: "stay", reason: "session-revisit" });
  });

  it("fail-safe: with no storage the flag reads false, so every arrival is a cold start", () => {
    // Passing null storage models sessionStorage being absent (SSR, private
    // mode, disabled). The read must fail toward the OLD behavior (cold start,
    // shell → /tonight), never toward landing-on-cold-start.
    expect(hasConsumedSessionEntry(null)).toBe(false);
    // Marking is a silent no-op when there is no storage — the flag still reads
    // false the next time, so a shell keeps cold-starting on /tonight.
    markSessionEntryConsumed(null);
    expect(hasConsumedSessionEntry(null)).toBe(false);
    expect(
      decideEntry({
        ...WEB_ROOT,
        isNativeShell: true,
        sessionEntryConsumed: hasConsumedSessionEntry(null),
      }),
    ).toEqual({ kind: "route", href: SHELL_START_PATH, reason: "shell-cold-start" });
  });
});

// ---------------------------------------------------------------------------
// Deep-link boot stamp (2026-07-22): the installed PWA cold-starts on the
// manifest start_url (/tonight), never mounting AppEntryRoute at "/". Without
// this stamp the first in-app wordmark tap to "/" read as a cold start and
// bounced back to /tonight (owner report).
// ---------------------------------------------------------------------------
describe("consumeDeepLinkBootEntry", () => {
  it("a non-root boot consumes the session entry, so the home tap stays", () => {
    const storage = makeMemoryStorage();
    // Installed PWA boots on the manifest start_url — a deep-link entry.
    expect(consumeDeepLinkBootEntry(SHELL_START_PATH, storage)).toBe(true);
    expect(hasConsumedSessionEntry(storage)).toBe(true);
    // First wordmark tap to "/" now reads as a session revisit, not a cold
    // start — the landing page is reached.
    expect(
      decideEntry({
        ...WEB_ROOT,
        isStandaloneDisplay: true,
        sessionEntryConsumed: hasConsumedSessionEntry(storage),
      }),
    ).toEqual({ kind: "stay", reason: "session-revisit" });
  });

  it("a root boot does NOT stamp — the cold-start decision stays with AppEntryRoute", () => {
    const storage = makeMemoryStorage();
    expect(consumeDeepLinkBootEntry("/", storage)).toBe(false);
    expect(hasConsumedSessionEntry(storage)).toBe(false);
    // The Capacitor shell (which loads the site root) still cold-starts on
    // /tonight exactly as before.
    expect(
      decideEntry({
        ...WEB_ROOT,
        isNativeShell: true,
        sessionEntryConsumed: hasConsumedSessionEntry(storage),
      }),
    ).toEqual({ kind: "route", href: SHELL_START_PATH, reason: "shell-cold-start" });
  });

  it("no storage: stamping is a silent no-op and boots keep the old behavior", () => {
    expect(consumeDeepLinkBootEntry(SHELL_START_PATH, null)).toBe(true);
    expect(hasConsumedSessionEntry(null)).toBe(false);
  });
});
