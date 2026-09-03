import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  COMMON_SITEMAP_URL,
  COMMON_SOURCE,
  COMMON_TIME_EVIDENCE,
  COMMON_USER_AGENT,
  commonCrawlOrder,
  commonStartsDate,
  isStaleCommonDate,
  parseCommonOgPrefix,
  parseCommonPostHtml,
  parseCommonSitemap,
  parseCommonSitemapEntries,
  refreshCommonEvents,
  toCommonEventRow,
} from "../scripts/whatson/commonRefresh.mjs";
import { isValidWhatsOnRow, parseWhatsOnRows } from "@/lib/whatsOn";

const TODAY = "2026-08-16";
const NOW = Date.parse("2026-08-16T10:00:00.000Z");

describe("OG prefix parse", () => {
  it("takes place and date from the OG prefix and ignores the rest", () => {
    expect(parseCommonOgPrefix("Hackney · 27 Aug — Saturday night with the regulars")).toEqual({
      placeName: "Hackney",
      dateText: "27 Aug",
    });
    expect(parseCommonOgPrefix("Peckham · 20 Aug · a long description we must never store")).toEqual({
      placeName: "Peckham",
      dateText: "20 Aug",
    });
  });

  it("returns null when the prefix is not place · date", () => {
    expect(parseCommonOgPrefix("Just a caption with no prefix")).toBeNull();
    expect(parseCommonOgPrefix("")).toBeNull();
  });
});

describe("common post HTML", () => {
  it("builds an event row from og:title plus the OG prefix and never stores the description", () => {
    const html = `
      <meta property="og:title" content="Sunday roast club" />
      <meta property="og:description" content="Camberwell · 20 Aug — Come down, bring a friend, names in the body" />
    `;
    const parsed = parseCommonPostHtml(html);
    expect(parsed).toEqual({
      title: "Sunday roast club",
      placeName: "Camberwell",
      dateText: "20 Aug",
    });
    expect(parsed).not.toBeNull();
    if (!parsed) return;
    const row = toCommonEventRow({
      url: "https://www.common-social.com/post/abc",
      parsed,
      observedAt: "2026-08-16T10:00:00.000Z",
      todayLondon: TODAY,
    });
    expect(row).toMatchObject({
      kind: "event",
      title: "Sunday roast club",
      placeName: "Camberwell",
      source: { label: "common", url: "https://www.common-social.com/post/abc" },
      confidence: "listed",
    });
    expect((row as { venueId?: string } | null)?.venueId).toBeUndefined();
    expect(JSON.stringify(row)).not.toMatch(/Come down/);
    expect(JSON.stringify(row)).not.toMatch(/bring a friend/);
    expect(JSON.stringify(row)).not.toMatch(/names in the body/);
    expect(isValidWhatsOnRow(row as unknown, NOW)).toBe(true);
  });

  it("drops a post whose date is before today", () => {
    expect(isStaleCommonDate("15 Aug", TODAY)).toBe(true);
    expect(isStaleCommonDate("16 Aug", TODAY)).toBe(false);
    expect(isStaleCommonDate("20 Aug", TODAY)).toBe(false);
    const row = toCommonEventRow({
      url: "https://www.common-social.com/post/old",
      parsed: { title: "Last week", placeName: "Soho", dateText: "10 Aug" },
      observedAt: "2026-08-16T10:00:00.000Z",
      todayLondon: TODAY,
    });
    expect(row).toBeNull();
  });
});

describe("a stated date is never a stated time", () => {
  it("carries the date and says the start time is not published", () => {
    const row = toCommonEventRow({
      url: "https://www.common-social.com/post/abc",
      parsed: { title: "Sunday roast club", placeName: "Camberwell", dateText: "20 Aug" },
      observedAt: "2026-08-16T10:00:00.000Z",
      todayLondon: TODAY,
    });
    expect(row).not.toBeNull();
    expect(row?.startsDate).toBe("2026-08-20");
    expect((row as unknown as { startsAt?: string })?.startsAt).toBeUndefined();
    expect(row?.timeEvidence).toBe(COMMON_TIME_EVIDENCE);
    expect(JSON.stringify(row)).not.toContain("20:00");
    expect(isValidWhatsOnRow(row as unknown, NOW)).toBe(true);
  });

  it("resolves the year against the post's own publication day", () => {
    // Published 18 December, "5 Jan" is a fortnight ahead of the post itself.
    expect(commonStartsDate("5 Jan", "2026-12-20", "2026-12-18")).toBe("2027-01-05");
    expect(isStaleCommonDate("5 Jan", "2026-12-20", "2026-12-18")).toBe(false);
    // Published 2 January, "1 Jan" is the day before the post, and is past.
    expect(commonStartsDate("1 Jan", "2026-12-20", "2026-01-02")).toBe("2026-01-01");
    expect(isStaleCommonDate("1 Jan", "2026-12-20", "2026-01-02")).toBe(true);
    // A day-month just behind today is genuinely past, and still stale.
    expect(commonStartsDate("15 Dec", "2026-12-20", "2026-12-01")).toBe("2026-12-15");
    expect(isStaleCommonDate("15 Dec", "2026-12-20", "2026-12-01")).toBe(true);
  });

  it("never resurrects an old post as a night a year away", () => {
    // The sitemap carries the site's whole history, so the budget reaches
    // posts from months ago. Anchoring the year on TODAY rolled every one of
    // them into next year and wrote a listing nobody scheduled.
    expect(commonStartsDate("1 Jan", "2026-08-16", "2026-01-01")).toBe("2026-01-01");
    expect(isStaleCommonDate("1 Jan", "2026-08-16", "2026-01-01")).toBe(true);
    expect(commonStartsDate("1 Mar", "2026-08-16", "2026-02-28")).toBe("2026-03-01");
    expect(isStaleCommonDate("1 Mar", "2026-08-16", "2026-02-28")).toBe(true);
    expect(
      toCommonEventRow({
        url: "https://www.common-social.com/post/january",
        parsed: { title: "New year session", placeName: "Peckham", dateText: "1 Jan" },
        observedAt: "2026-08-16T10:00:00.000Z",
        todayLondon: TODAY,
        publishedOn: "2026-01-01",
      }),
    ).toBeNull();
  });

  it("reads an undated post as this year, and drops it when that is past", () => {
    // No lastmod is no anchor, and a guess that resurrects a listing is worse
    // than one we decline to date.
    expect(commonStartsDate("5 Jan", "2026-08-16")).toBe("2026-01-05");
    expect(isStaleCommonDate("5 Jan", "2026-08-16")).toBe(true);
    expect(commonStartsDate("20 Aug", "2026-08-16")).toBe("2026-08-20");
    expect(isStaleCommonDate("20 Aug", "2026-08-16")).toBe(false);
  });
});

describe("refreshCommonEvents", () => {
  const NOW_MS = Date.parse("2026-08-16T10:00:00.000Z");

  function post(url: string) {
    return `<meta property="og:title" content="Night at ${url.slice(-3)}" />
      <meta property="og:description" content="Camberwell · 20 Aug - never stored" />`;
  }

  function makeFetch(urls: string[], seen: string[]) {
    const sitemap = `<urlset>${urls
      .map((url) => `<url><loc>${url}</loc></url>`)
      .join("")}</urlset>`;
    return async (target: string | URL) => {
      const href = String(target);
      if (href === COMMON_SITEMAP_URL) {
        return new Response(sitemap, { status: 200 });
      }
      seen.push(href);
      return new Response(post(href), { status: 200 });
    };
  }

  it("drops a historical post rather than writing it out as next year's night", async () => {
    const dir = mkdtempSync(join(tmpdir(), "common-refresh-"));
    const outPath = join(dir, "events_london.json");
    const old = "https://www.common-social.com/post/january";
    const upcoming = "https://www.common-social.com/post/august";
    const sitemap =
      `<urlset>` +
      `<url><loc>${old}</loc><lastmod>2025-12-20</lastmod></url>` +
      `<url><loc>${upcoming}</loc><lastmod>2026-08-10</lastmod></url>` +
      `</urlset>`;
    const fetchImpl = (async (target: string | URL) => {
      const href = String(target);
      if (href === COMMON_SITEMAP_URL) return new Response(sitemap, { status: 200 });
      const dateText = href === old ? "5 Jan" : "20 Aug";
      return new Response(
        `<meta property="og:title" content="A night" />` +
          `<meta property="og:description" content="Camberwell \u00b7 ${dateText} - never stored" />`,
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const report = await refreshCommonEvents({ nowMs: NOW_MS, fetchImpl, outPath, gapMs: 0 });

    // "5 Jan" on a post published in December 2025 is January 2026, which is
    // past; only the genuinely upcoming night is written.
    expect(report.rows.map((row) => row.startsDate)).toEqual(["2026-08-20"]);
    expect(report.droppedStale).toBe(1);
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(JSON.stringify(written)).not.toContain("2027-01-05");
    rmSync(dir, { recursive: true, force: true });
  });

  it("stamps its own generatedAt so the rows it just wrote still validate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "common-refresh-"));
    const outPath = join(dir, "events_london.json");
    writeFileSync(
      outPath,
      JSON.stringify({
        generatedAt: "2026-07-18T00:00:00.000Z",
        kind: "events",
        region: "greater-london",
        sources: [],
        rows: [],
      }),
    );
    const seen: string[] = [];
    await refreshCommonEvents({
      nowMs: NOW_MS,
      fetchImpl: makeFetch(["https://www.common-social.com/post/one"], seen) as typeof fetch,
      outPath,
      gapMs: 0,
    });
    const written = JSON.parse(readFileSync(outPath, "utf8"));
    expect(written.generatedAt).toBe(new Date(NOW_MS).toISOString());
    // The file's own stamp is what every reader dates its rows by, so the rows
    // this run wrote must survive that read.
    const parsed = parseWhatsOnRows(written, Date.parse(written.generatedAt));
    expect(parsed.map((row) => row.source.label)).toEqual(["common"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses its own write rather than emptying the rows it already holds", async () => {
    // fetchText throws only on a non-2xx, so a 200 that is a sitemap index, a
    // renamed post path or a challenge page parses to no posts at all. The old
    // write rewrote the file with the Common lane emptied, and the run reported
    // success.
    const dir = mkdtempSync(join(tmpdir(), "common-refresh-"));
    const outPath = join(dir, "events_london.json");
    const held = toCommonEventRow({
      url: "https://www.common-social.com/post/one",
      parsed: { title: "Held", placeName: "Camberwell", dateText: "20 Aug" },
      observedAt: "2026-08-15T10:00:00.000Z",
      todayLondon: TODAY,
    });
    const before = JSON.stringify({
      generatedAt: "2026-08-15T10:00:00.000Z",
      kind: "events",
      region: "greater-london",
      sources: [],
      rows: [held],
    });
    writeFileSync(outPath, before);

    const report = await refreshCommonEvents({
      nowMs: NOW_MS,
      fetchImpl: (async () =>
        new Response("<urlset></urlset>", { status: 200 })) as unknown as typeof fetch,
      outPath,
      gapMs: 0,
    });

    expect(report.wrote).toBe(false);
    expect(report.refused).toEqual(expect.any(String));
    expect(readFileSync(outPath, "utf8")).toBe(before);
    rmSync(dir, { recursive: true, force: true });
  });

  it("still writes a genuinely empty answer when it held nothing upcoming", async () => {
    const dir = mkdtempSync(join(tmpdir(), "common-refresh-"));
    const outPath = join(dir, "events_london.json");
    const report = await refreshCommonEvents({
      nowMs: NOW_MS,
      fetchImpl: (async () =>
        new Response("<urlset></urlset>", { status: 200 })) as unknown as typeof fetch,
      outPath,
      gapMs: 0,
    });
    expect(report.refused).toBeUndefined();
    expect(report.wrote).toBe(true);
    expect(JSON.parse(readFileSync(outPath, "utf8")).rows).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reuses a post it already holds and caps the rest, reporting both", async () => {
    const dir = mkdtempSync(join(tmpdir(), "common-refresh-"));
    const outPath = join(dir, "events_london.json");
    const held = toCommonEventRow({
      url: "https://www.common-social.com/post/one",
      parsed: { title: "Held", placeName: "Camberwell", dateText: "20 Aug" },
      observedAt: "2026-08-15T10:00:00.000Z",
      todayLondon: TODAY,
    });
    writeFileSync(
      outPath,
      JSON.stringify({
        generatedAt: "2026-08-15T10:00:00.000Z",
        kind: "events",
        region: "greater-london",
        sources: [],
        rows: [held],
      }),
    );
    const urls = [
      "https://www.common-social.com/post/one",
      "https://www.common-social.com/post/two",
      "https://www.common-social.com/post/thr",
    ];
    const seen: string[] = [];
    const report = await refreshCommonEvents({
      nowMs: NOW_MS,
      fetchImpl: makeFetch(urls, seen) as typeof fetch,
      outPath,
      gapMs: 0,
      maxFetches: 1,
    });
    // Undated sitemap: the budget walks from the end, so the newest untouched
    // post is read and the one already held is not re-fetched.
    expect(seen).toEqual(["https://www.common-social.com/post/thr"]);
    expect(report.reusedHeld).toBe(1);
    expect(report.fetched).toBe(1);
    expect(report.skippedOverBudget).toBe(1);
    expect(report.rows).toHaveLength(2);
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("sitemap + UA", () => {
  it("keeps only /post/* locs", () => {
    const xml = `<?xml version="1.0"?>
      <urlset>
        <url><loc>https://www.common-social.com/post/one</loc></url>
        <url><loc>https://www.common-social.com/</loc></url>
        <url><loc>https://www.common-social.com/friends</loc></url>
        <url><loc>https://www.common-social.com/post/two</loc></url>
      </urlset>`;
    expect(parseCommonSitemap(xml)).toEqual([
      "https://www.common-social.com/post/one",
      "https://www.common-social.com/post/two",
    ]);
  });

  it("names PUBMAXX and the public contact in the UA string", () => {
    expect(COMMON_USER_AGENT).toMatch(/PUBMAXX/);
    expect(COMMON_USER_AGENT).toMatch(/karanszdy@gmail\.com/);
    expect(COMMON_SOURCE.label).toBe("common");
  });
});

describe("the crawl budget advances", () => {
  it("spends the budget on the freshest published posts, not the oldest", () => {
    const xml = `<?xml version="1.0"?>
      <urlset>
        <url><loc>https://www.common-social.com/post/ancient</loc><lastmod>2024-01-01</lastmod></url>
        <url><loc>https://www.common-social.com/post/recent</loc><lastmod>2026-08-14</lastmod></url>
        <url><loc>https://www.common-social.com/post/newest</loc><lastmod>2026-08-15</lastmod></url>
      </urlset>`;
    const entries = parseCommonSitemapEntries(xml);
    expect(entries).toHaveLength(3);
    expect(commonCrawlOrder(entries)).toEqual([
      "https://www.common-social.com/post/newest",
      "https://www.common-social.com/post/recent",
      "https://www.common-social.com/post/ancient",
    ]);
  });

  it("walks an undated sitemap from the end, where a growing sitemap appends", () => {
    const xml = `<urlset>
      <url><loc>https://www.common-social.com/post/one</loc></url>
      <url><loc>https://www.common-social.com/post/two</loc></url>
      <url><loc>https://www.common-social.com/post/three</loc></url>
    </urlset>`;
    expect(commonCrawlOrder(parseCommonSitemapEntries(xml))).toEqual([
      "https://www.common-social.com/post/three",
      "https://www.common-social.com/post/two",
      "https://www.common-social.com/post/one",
    ]);
  });

  it("reaches an upcoming post that a document-order crawl would never fetch", async () => {
    const dir = mkdtempSync(join(tmpdir(), "common-refresh-"));
    const outPath = join(dir, "events_london.json");
    const nowMs = Date.parse("2026-08-16T10:00:00.000Z");
    const stale = "https://www.common-social.com/post/stale";
    const upcoming = "https://www.common-social.com/post/upcoming";
    const xml = `<urlset>
      <url><loc>${stale}</loc><lastmod>2024-01-01</lastmod></url>
      <url><loc>${upcoming}</loc><lastmod>2026-08-15</lastmod></url>
    </urlset>`;
    const seen: string[] = [];
    const fetchImpl = async (target: string | URL) => {
      const href = String(target);
      if (href === COMMON_SITEMAP_URL) return new Response(xml, { status: 200 });
      seen.push(href);
      const when = href === stale ? "1 Jan" : "20 Aug";
      return new Response(
        `<meta property="og:title" content="A night" />
         <meta property="og:description" content="Camberwell · ${when} - never stored" />`,
        { status: 200 },
      );
    };
    const report = await refreshCommonEvents({
      nowMs,
      fetchImpl: fetchImpl as typeof fetch,
      outPath,
      gapMs: 0,
      maxFetches: 1,
    });
    expect(seen).toEqual([upcoming]);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].startsDate).toBe("2026-08-20");
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("Common lane independence", () => {
  // The scheduler spawns Common as its OWN command so a quiet provider window
  // cannot stop it, which means nothing in Common's module graph may depend on
  // the provider lane loading. Node's type stripping is what lets a plain .mjs
  // script import a TypeScript module, so a child with stripping DISABLED
  // refuses any graph that reaches TypeScript. Common must load in that child.
  const loadUnderNoStripTypes = (specifier: string, cwd: string) => {
    try {
      execFileSync(
        process.execPath,
        [
          "--no-experimental-strip-types",
          "--input-type=module",
          "-e",
          `await import(${JSON.stringify(specifier)});`,
        ],
        { cwd, stdio: "pipe" },
      );
      return { loaded: true, output: "" };
    } catch (error) {
      const err = error as { stderr?: Buffer | string; message?: string };
      return { loaded: false, output: String(err.stderr ?? err.message ?? "") };
    }
  };

  // The control is a throwaway pair rather than a repository module, so the
  // probe is proved to detect TypeScript in a graph without pinning any real
  // script's current shape as a requirement.
  function probeDetectsTypeScript() {
    const dir = mkdtempSync(join(tmpdir(), "no-strip-types-probe-"));
    try {
      writeFileSync(join(dir, "typed.ts"), "export const answer: number = 1;\n");
      writeFileSync(join(dir, "entry.mjs"), 'export { answer } from "./typed.ts";\n');
      return !loadUnderNoStripTypes("./entry.mjs", dir).loaded;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const probeWorks = probeDetectsTypeScript();

  it.skipIf(!probeWorks)("loads with no TypeScript anywhere in its graph", () => {
    const common = loadUnderNoStripTypes("./scripts/whatson/commonRefresh.mjs", process.cwd());
    expect(common.output).not.toContain("ERR_UNKNOWN_FILE_EXTENSION");
    expect(common.loaded).toBe(true);
  });
});
