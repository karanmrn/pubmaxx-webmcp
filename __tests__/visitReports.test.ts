import { describe, expect, it } from "vitest";

import {
  cleanBusyness,
  cleanNoise,
  cleanSeating,
  cleanServiceWait,
  earliestVisitedAt,
  hasSignal,
  latestVisitedAt,
  londonEveningKey,
  MAX_VISIT_AGE_DAYS,
  MAX_VISIT_NOTE,
  normalizeHandle,
  resolveVisitedAt,
  toVisitReportDTO,
  validateVisitReport,
  VISIT_REPORT_PROMPT_SURFACE,
  type VisitReport,
} from "@/lib/visitReports";
import { claimPromptBudget, hasPromptBudgetFor } from "@/lib/promptBudget";

const NOW = new Date("2026-07-21T20:00:00Z");

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

function makeDecidedConsentStorage(): Storage {
  const storage = makeMemoryStorage();
  storage.setItem("pubmaxx:analytics-consent:v1", "denied");
  return storage;
}

describe("visit report vocab coercion", () => {
  it("accepts allowlist values case-insensitively, rejects the rest", () => {
    expect(cleanBusyness("RAMMED")).toBe("rammed");
    expect(cleanBusyness("packed")).toBeNull();
    expect(cleanNoise("Easy-To-Talk")).toBe("easy-to-talk");
    expect(cleanNoise("banging")).toBeNull();
    expect(cleanSeating("standing")).toBe("standing");
    expect(cleanSeating("loads")).toBeNull();
    expect(cleanServiceWait("some-wait")).toBe("some-wait");
    expect(cleanServiceWait("forever")).toBeNull();
  });

  it("normalizes a handle like the rest of the app", () => {
    expect(normalizeHandle("@Karan_99!")).toBe("karan_99");
    expect(normalizeHandle(42)).toBe("");
  });
});

describe("londonEveningKey / resolveVisitedAt", () => {
  it("folds pre-dawn hours onto the previous evening", () => {
    // 02:00 UTC on the 21st is the small hours of the night that began the 20th.
    expect(londonEveningKey(new Date("2026-07-21T02:00:00Z"))).toBe("2026-07-20");
    // An 8pm visit stays on its own day.
    expect(londonEveningKey(new Date("2026-07-21T19:00:00Z"))).toBe("2026-07-21");
  });

  it("takes a bare date verbatim and defaults to today's London date", () => {
    expect(resolveVisitedAt("2026-07-19", NOW)).toBe("2026-07-19");
    expect(resolveVisitedAt(undefined, NOW)).toBe(latestVisitedAt(NOW));
  });

  it("rejects a future night and an invalid date", () => {
    const marchNow = new Date("2026-03-10T12:00:00Z");
    expect(resolveVisitedAt("2099-01-01", NOW)).toBeNull();
    expect(resolveVisitedAt("2026-13-40", NOW)).toBeNull();
    expect(resolveVisitedAt("2026-02-29", marchNow)).toBeNull();
    expect(resolveVisitedAt("2026-02-30", marchNow)).toBeNull();
    expect(resolveVisitedAt("not-a-date", NOW)).toBeNull();
  });

  it("holds the 90-calendar-day window at both ends", () => {
    // The visited date is authority-bearing (the public lane sorts on it), so
    // the window is calendar days, both ends inclusive. NOW is the evening of
    // 2026-07-21, so 90 days back is 2026-04-22.
    expect(MAX_VISIT_AGE_DAYS).toBe(90);
    expect(earliestVisitedAt(NOW)).toBe("2026-04-22");

    // Today: in, whatever the time of day (a midday and a late-night NOW both
    // accept their own evening date).
    expect(resolveVisitedAt("2026-07-21", NOW)).toBe("2026-07-21");
    expect(resolveVisitedAt("2026-07-21", new Date("2026-07-21T11:00:00Z"))).toBe("2026-07-21");
    // Pre-dawn London is still the same calendar day for a date input. The
    // evening-date fold must not make today's date look like tomorrow.
    const preDawn = new Date("2026-07-21T01:00:00Z"); // 02:00 Europe/London
    expect(latestVisitedAt(preDawn)).toBe("2026-07-21");
    expect(resolveVisitedAt("2026-07-21", preDawn)).toBe("2026-07-21");
    expect(earliestVisitedAt(preDawn)).toBe("2026-04-22");
    // Exactly 90 days ago: the last night that still counts.
    expect(resolveVisitedAt("2026-04-22", NOW)).toBe("2026-04-22");
    // 91 days ago: out.
    expect(resolveVisitedAt("2026-04-21", NOW)).toBeNull();
    // Tomorrow: out (a night that hasn't happened).
    expect(resolveVisitedAt("2026-07-22", NOW)).toBeNull();
  });
});

describe("hasSignal", () => {
  const base = {
    busyness: null,
    noise: null,
    seating: null,
    serviceWait: null,
    note: "",
  };
  it("is false with nothing and true with any one field", () => {
    expect(hasSignal(base)).toBe(false);
    expect(hasSignal({ ...base, busyness: "steady" })).toBe(true);
    expect(hasSignal({ ...base, note: "great night" })).toBe(true);
  });
});

describe("validateVisitReport", () => {
  it("requires a venue, a handle, and at least one signal", () => {
    expect(validateVisitReport({ handle: "sam", busyness: "steady" }, NOW).ok).toBe(false);
    expect(validateVisitReport({ venueId: "v1", busyness: "steady" }, NOW).ok).toBe(false);
    // No signal at all — a report of nothing is refused.
    const nothing = validateVisitReport({ venueId: "v1", handle: "sam" }, NOW);
    expect(nothing.ok).toBe(false);
  });

  it("normalises the fields and stamps tonight's evening by default", () => {
    const result = validateVisitReport(
      {
        venueId: "venue-1",
        handle: "@Sam",
        busyness: "Rammed",
        noise: "had-to-shout",
        seating: "standing",
        serviceWait: "long",
      },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      venueId: "venue-1",
      handle: "sam",
      busyness: "rammed",
      noise: "had-to-shout",
      seating: "standing",
      serviceWait: "long",
      visitedAt: londonEveningKey(NOW),
    });
  });

  it("refuses a night outside the window whatever else the body carries", () => {
    const base = { venueId: "v1", handle: "sam", busyness: "steady" };
    // The bound is enforced HERE, in the domain core the route calls, so a
    // hand-rolled POST that skips the composer meets the same window.
    for (const visitedAt of ["2026-04-21", "2026-07-22"]) {
      const result = validateVisitReport({ ...base, visitedAt }, NOW);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain(`last ${MAX_VISIT_AGE_DAYS} days`);
    }
    expect(validateVisitReport({ ...base, visitedAt: "2026-04-22" }, NOW).ok).toBe(true);
  });

  it("drops an off-allowlist field to null rather than storing it raw", () => {
    const result = validateVisitReport(
      { venueId: "v1", handle: "sam", busyness: "steady", noise: "bussin" },
      NOW,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.noise).toBeNull();
  });

  it("does not turn recommendation proxies into a visit report", () => {
    const result = validateVisitReport(
      {
        venueId: "v1",
        handle: "sam",
        wouldReturn: "yes",
        priceSanity: "fine",
      },
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  it("slop-filters the note at write time", () => {
    // A marketing-slop note is dropped to "" — if it were the only signal, the
    // whole report is refused.
    const slopOnly = validateVisitReport(
      { venueId: "v1", handle: "sam", note: "Welcome to the vibrant hidden gem, something for everyone!" },
      NOW,
    );
    expect(slopOnly.ok).toBe(false);

    // A genuine, specific note survives.
    const real = validateVisitReport(
      { venueId: "v1", handle: "sam", note: "Quiz on Tuesdays, good corner by the fire." },
      NOW,
    );
    expect(real.ok).toBe(true);
    if (!real.ok) return;
    expect(real.value.note).toContain("Quiz on Tuesdays");
  });

  it("caps the note at the shared low ceiling", () => {
    const long = "a".repeat(300);
    const result = validateVisitReport({ venueId: "v1", handle: "sam", note: long }, NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.note).toHaveLength(MAX_VISIT_NOTE);
  });
});

describe("toVisitReportDTO", () => {
  it("strips the moderation trail from a public read", () => {
    const report: VisitReport = {
      id: "r1",
      venueId: "v1",
      handle: "sam",
      visitedAt: "2026-07-20",
      busyness: "steady",
      noise: "easy-to-talk",
      seating: "plenty",
      serviceWait: "quick",
      note: "good one",
      status: "visible",
      createdAt: "2026-07-21T00:00:00.000Z",
      reportCount: 1,
      reportActors: ["hash-a"],
      reportReason: "spam",
      moderatorNote: "kept",
    };
    const dto = toVisitReportDTO(report) as Record<string, unknown>;
    expect(dto.handle).toBe("sam");
    expect(dto.reportCount).toBeUndefined();
    expect(dto.reportActors).toBeUndefined();
    expect(dto.reportReason).toBeUndefined();
    expect(dto.moderatorNote).toBeUndefined();
    expect(dto.status).toBeUndefined();
  });
});

describe("prompt budget respect", () => {
  it("uses a stable surface id that competes for the shared session budget", () => {
    const s = makeMemoryStorage();
    const consent = makeDecidedConsentStorage();
    expect(VISIT_REPORT_PROMPT_SURFACE).toBe("visit-report");
    // Free budget → the visit-report ask may show and claims it.
    expect(hasPromptBudgetFor(VISIT_REPORT_PROMPT_SURFACE, s, consent)).toBe(true);
    expect(claimPromptBudget(VISIT_REPORT_PROMPT_SURFACE, s, consent)).toBe(true);
    // Now a sibling surface is blocked this session, and vice versa.
    expect(hasPromptBudgetFor("identity-nudge", s, consent)).toBe(false);
  });

  it("stands down when another surface already spent the budget", () => {
    const s = makeMemoryStorage();
    const consent = makeDecidedConsentStorage();
    expect(claimPromptBudget("first-run-tour", s, consent)).toBe(true);
    // The visit-report ask must not stack on top of the first-run tour.
    expect(hasPromptBudgetFor(VISIT_REPORT_PROMPT_SURFACE, s, consent)).toBe(false);
    expect(claimPromptBudget(VISIT_REPORT_PROMPT_SURFACE, s, consent)).toBe(false);
  });
});
