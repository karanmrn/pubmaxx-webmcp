import { describe, it, expect } from "vitest";

import {
  buildCrawlIcs,
  escapeIcsText,
  formatIcsUtc,
  defaultCrawlStart,
  icsFilename,
  type IcsCrawl,
} from "@/lib/icsExport";

// A fixed evening + stamp so every assertion is deterministic (no wall clock).
const START = new Date(Date.UTC(2026, 6, 10, 18, 0, 0)); // 2026-07-10 18:00Z
const NOW = new Date(Date.UTC(2026, 6, 6, 12, 0, 0));

const sample: IcsCrawl = {
  id: "victorian-soho",
  title: "Victorian Soho",
  blurb: "Five Dean Street snugs.",
  stops: [
    { name: "The Nellie Dean", address: "89 Dean St, W1D 3SU" },
    { name: "The Dog & Duck", address: "18 Bateman St, W1D 3AJ" },
  ],
};

describe("escapeIcsText", () => {
  it("escapes backslash, comma, semicolon and newlines per RFC 5545", () => {
    expect(escapeIcsText("a,b;c\\d")).toBe("a\\,b\\;c\\\\d");
    expect(escapeIcsText("line1\nline2")).toBe("line1\\nline2");
    expect(escapeIcsText("crlf\r\nend")).toBe("crlf\\nend");
  });
});

describe("formatIcsUtc", () => {
  it("emits the UTC date-time basic form with a trailing Z", () => {
    expect(formatIcsUtc(START)).toBe("20260710T180000Z");
  });
});

describe("defaultCrawlStart", () => {
  // Resolved against Europe/London regardless of the caller's own locale, so
  // every assertion below checks the absolute UTC instant rather than a
  // system-local getHours() read (which is what let the pre-fix bug through:
  // it only "worked" on a machine whose OS timezone happened to be London).

  it("returns tonight at 19:00 BST (18:00Z) when called before 7pm London, in summer", () => {
    // 2026-07-10 14:00Z = 15:00 BST (UTC+1), well before 19:00 London.
    const from = new Date(Date.UTC(2026, 6, 10, 14, 0, 0));
    const start = defaultCrawlStart(from);
    expect(formatIcsUtc(start)).toBe("20260710T180000Z");
  });

  it("rolls to the next day when it is already past 19:00 BST", () => {
    // 2026-07-10 19:00Z = 20:00 BST, already past 19:00 London.
    const from = new Date(Date.UTC(2026, 6, 10, 19, 0, 0));
    const start = defaultCrawlStart(from);
    expect(formatIcsUtc(start)).toBe("20260711T180000Z");
  });

  it("returns tonight at 19:00 GMT (19:00Z) in winter, when London has no DST offset", () => {
    // 2026-01-10 15:00Z = 15:00 GMT (UTC+0), before 19:00 London.
    const from = new Date(Date.UTC(2026, 0, 10, 15, 0, 0));
    const start = defaultCrawlStart(from);
    expect(formatIcsUtc(start)).toBe("20260110T190000Z");
  });

  it("resolves correctly for a visitor whose device timezone is not Europe/London", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      // 19:00Z is 15:00 EDT but 20:00 BST. London has passed 19:00, so the
      // result must be the next London evening, not 19:00 in the device zone.
      const from = new Date(Date.UTC(2026, 6, 10, 19, 0, 0));
      const start = defaultCrawlStart(from);
      expect(formatIcsUtc(start)).toBe("20260711T180000Z");
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });
});

// RFC 5545 §3.1 unfolding: a CRLF followed by a single space/tab is removed,
// rejoining a folded content line. Assert on unfolded content so line folding
// (an implementation detail) doesn't make substring checks brittle.
function unfold(ics: string): string {
  return ics.replace(/\r\n[ \t]/g, "");
}

describe("buildCrawlIcs", () => {
  const ics = buildCrawlIcs(sample, { start: START, now: NOW });
  const unfolded = unfold(ics);

  it("uses CRLF line endings and no bare LF", () => {
    expect(ics).toContain("\r\n");
    // Every LF must be preceded by a CR (no lone LFs).
    expect(/[^\r]\n/.test(ics)).toBe(false);
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("has a well-formed VCALENDAR/VEVENT envelope with required props", () => {
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("VERSION:2.0");
    expect(ics).toContain("PRODID:");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
    // Balanced BEGIN/END lines (anchor at line start so DTEND doesn't count).
    const begins = (ics.match(/(^|\r\n)BEGIN:/g) ?? []).length;
    const ends = (ics.match(/(^|\r\n)END:/g) ?? []).length;
    expect(begins).toBe(2);
    expect(ends).toBe(2);
  });

  it("carries DTSTART/DTEND/DTSTAMP in UTC and a stable UID", () => {
    expect(ics).toContain("DTSTART:20260710T180000Z");
    expect(ics).toContain("DTSTAMP:20260706T120000Z");
    // Two 30-min stops => 90 min minimum window ends at 19:30Z.
    expect(ics).toContain("DTEND:20260710T193000Z");
    expect(ics).toContain("UID:crawl-victorian-soho-20260710T180000Z@pubmaxxing");
  });

  it("lists stops in order in the description and escapes commas", () => {
    // Addresses contain commas -> must be escaped in the TEXT value.
    expect(unfolded).toContain("1. The Nellie Dean\\, 89 Dean St\\, W1D 3SU");
    expect(unfolded).toContain("2. The Dog & Duck");
    expect(unfolded).toContain("2 stops:");
  });

  it("uses the alt-style stop noun when provided", () => {
    const coffee = unfold(
      buildCrawlIcs({ ...sample, stopNoun: "coffee stop" }, { start: START, now: NOW }),
    );
    expect(coffee).toContain("2 coffee stops:");
  });

  it("sets LOCATION to the first stop's address", () => {
    expect(unfolded).toContain("LOCATION:89 Dean St\\, W1D 3SU");
  });

  it("stays valid for an empty crawl (a bookable evening block)", () => {
    const empty = buildCrawlIcs(
      { id: "empty", title: "Empty crawl", stops: [] },
      { start: START, now: NOW },
    );
    expect(empty).toContain("BEGIN:VEVENT");
    expect(empty).toContain("END:VCALENDAR");
    expect(empty).toContain("SUMMARY:Empty crawl");
    // No stop lines, no LOCATION, but a valid 90-min window.
    expect(empty).not.toContain("LOCATION:");
    expect(empty).toContain("DTEND:20260710T193000Z");
    expect(empty.endsWith("\r\n")).toBe(true);
  });

  it("folds over-long content lines to <=75 chars per RFC 5545 §3.1", () => {
    const longName = "A".repeat(120);
    const folded = buildCrawlIcs(
      { id: "long", title: longName, stops: [] },
      { start: START, now: NOW },
    );
    for (const line of folded.split("\r\n")) {
      expect(line.length).toBeLessThanOrEqual(75);
    }
    // Continuation lines start with a single space.
    expect(folded.split("\r\n").some((l) => l.startsWith(" "))).toBe(true);
  });
});

describe("icsFilename", () => {
  it("slugifies id/title to a safe .ics filename", () => {
    expect(icsFilename({ id: "victorian-soho", title: "Victorian Soho" })).toBe(
      "victorian-soho.ics",
    );
    expect(icsFilename({ id: "", title: "My Hand-Built Crawl!" })).toBe(
      "my-hand-built-crawl.ics",
    );
    expect(icsFilename({ id: "", title: "" })).toBe("crawl.ics");
  });
});
