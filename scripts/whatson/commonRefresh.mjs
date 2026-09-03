// scripts/whatson/commonRefresh.mjs
//
// Common linked-card reader. robots.txt allows the sitemap. We fetch each
// /post/* page for og:title + og:description ONLY, then derive place + date
// from the OG prefix ("<place> · <date> - ..."). The description text and
// any names inside it are never stored or rendered. Captain 2026-08-16:
// Common cards = facts only + link out.
//
// Rows join public/data/whats_on/events_london.json under source "common".
// Polite: 1 request per second, UA names PUBMAXX and the public contact.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { DATE_ONLY_TIME_EVIDENCE } from "../../lib/whatson/eventNormalise.mjs";
import { eventsOutputPath } from "./eventsOutputPath.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export const COMMON_SITEMAP_URL = "https://www.common-social.com/sitemap.xml";
export const COMMON_SOURCE = {
  label: "common",
  url: "https://www.common-social.com/",
};
export const COMMON_USER_AGENT =
  "PUBMAXX/1 (+https://pubmaxxing.com; contact karanszdy@gmail.com)";
export const COMMON_FETCH_GAP_MS = 1000;
// The sitemap grows with the site's whole history and every fetch costs a
// polite second, so a run that re-read all of it would grow without limit. A
// post we already hold a live row for is not re-read, and the remainder is
// capped per run. Both counts are reported: a skip is a finding, never silence.
export const COMMON_MAX_FETCHES_PER_RUN = 60;

const MONTHS = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function stableId(prefix, input) {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(36)}`;
}

export function parseCommonOgPrefix(text) {
  if (!nonEmptyString(text)) return null;
  const parts = text
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const placeName = parts[0];
  const dateText = parts[1].split(/\s+[\u2014\u2013-]\s+/)[0].trim();
  if (!nonEmptyString(placeName) || !nonEmptyString(dateText)) return null;
  return { placeName, dateText };
}

function metaContent(html, property) {
  const propertyRe = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`,
    "i",
  );
  const contentFirst = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  );
  return propertyRe.exec(html)?.[1] ?? contentFirst.exec(html)?.[1] ?? null;
}

export function parseCommonPostHtml(html) {
  if (!nonEmptyString(html)) return null;
  const title = metaContent(html, "og:title")?.trim();
  const description = metaContent(html, "og:description");
  const prefix = parseCommonOgPrefix(description ?? "");
  if (!nonEmptyString(title) || !prefix) return null;
  return { title, placeName: prefix.placeName, dateText: prefix.dateText };
}

export function parseCommonSitemap(xml) {
  return parseCommonSitemapEntries(xml).map((entry) => entry.url);
}

/** Every /post/* entry in DOCUMENT order, with its stated lastmod when the
 *  sitemap carries one. */
export function parseCommonSitemapEntries(xml) {
  if (!nonEmptyString(xml)) return [];
  const entries = [];
  const seen = new Set();
  const blockRe = /<url\b[\s\S]*?<\/url>/gi;
  const blocks = String(xml).match(blockRe) ?? [String(xml)];
  for (const block of blocks) {
    const loc = /<loc>\s*([^<]+?)\s*<\/loc>/i.exec(block)?.[1]?.trim();
    if (!nonEmptyString(loc)) continue;
    try {
      const url = new URL(loc);
      if (url.hostname !== "www.common-social.com") continue;
      if (!url.pathname.startsWith("/post/")) continue;
      const href = url.toString();
      if (seen.has(href)) continue;
      seen.add(href);
      const lastmodText = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i.exec(block)?.[1]?.trim();
      const lastmod = lastmodText && Number.isFinite(Date.parse(lastmodText))
        ? Date.parse(lastmodText)
        : null;
      entries.push({ url: href, lastmod });
    } catch {
      // skip a malformed loc
    }
  }
  return entries;
}

/**
 * The order the crawl budget is spent in: freshest published post first.
 *
 * A sitemap grows with the site's whole history, and the budget is finite, so
 * spending it in document order re-reads the same oldest, long-past posts every
 * run and never reaches an upcoming night. `lastmod` decides when the sitemap
 * states one; an undated entry goes last, in REVERSE document order, because a
 * sitemap that appends is newest at the end.
 */
export function commonCrawlOrder(entries) {
  const dated = [];
  const undated = [];
  entries.forEach((entry, index) => {
    if (typeof entry.lastmod === "number") dated.push({ entry, index });
    else undated.push({ entry, index });
  });
  dated.sort((left, right) => right.entry.lastmod - left.entry.lastmod || left.index - right.index);
  undated.reverse();
  return [...dated, ...undated].map((held) => held.entry.url);
}

// A Common post states a day and a month and no year, so the year is resolved
// against the POST'S OWN publication day - the sitemap's `lastmod` - and never
// against today. A post published on 18 December stating "5 Jan" means the
// January a fortnight ahead of ITSELF; one published on 2 January stating
// "1 Jan" means the day before itself, and is past. Anchoring on today instead
// rolled every post older than the grace window into next year, so the site's
// whole history came back as nights nobody scheduled.
//
// With no stated lastmod there is no anchor but today, and then the day-month
// is read as this year and dropped when it is past: a guess that resurrects a
// listing is worse than a listing we decline to date.
const YEAR_ROLLOVER_GRACE_DAYS = 120;
const DAY_MS = 24 * 60 * 60 * 1000;

function isCalendarDay(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function calendarDayMs(value) {
  return Date.UTC(
    Number(value.slice(0, 4)),
    Number(value.slice(5, 7)) - 1,
    Number(value.slice(8, 10)),
  );
}

function parseDayMonth(dateText, todayLondon, publishedOn = null) {
  const match = /^(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.exec(
    String(dateText ?? "").trim(),
  );
  if (!match) return null;
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
  const day = Number(match[1]);
  if (month === undefined || !Number.isFinite(day)) return null;

  const anchored = isCalendarDay(publishedOn);
  const anchor = anchored ? publishedOn : todayLondon;
  const year = Number(anchor.slice(0, 4));
  const sameYearMs = Date.UTC(year, month, day);
  if (anchored && calendarDayMs(anchor) - sameYearMs > YEAR_ROLLOVER_GRACE_DAYS * DAY_MS) {
    return { year: year + 1, month, day };
  }
  return { year, month, day };
}

export function isStaleCommonDate(dateText, todayLondon, publishedOn = null) {
  const parsed = parseDayMonth(dateText, todayLondon, publishedOn);
  if (!parsed) return true;
  const dateMs = Date.UTC(parsed.year, parsed.month, parsed.day);
  const todayMs = Date.UTC(
    Number(todayLondon.slice(0, 4)),
    Number(todayLondon.slice(5, 7)) - 1,
    Number(todayLondon.slice(8, 10)),
  );
  return dateMs < todayMs;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

// The DATE the post states, and nothing more. Common publishes no clock time,
// so no clock time is written down: a row carries `startsDate` plus a
// timeEvidence line saying the start is not published, and every surface
// windows it against that evening's own service window. An invented 20:00 is
// the exact shape the harvest rule forbids.
export function commonStartsDate(dateText, todayLondon, publishedOn = null) {
  const parsed = parseDayMonth(dateText, todayLondon, publishedOn);
  if (!parsed) return null;
  return `${parsed.year}-${pad2(parsed.month + 1)}-${pad2(parsed.day)}`;
}

export const COMMON_TIME_EVIDENCE = DATE_ONLY_TIME_EVIDENCE;

function sourceIdFromUrl(url) {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "");
    const slug = path.split("/").filter(Boolean).pop();
    return nonEmptyString(slug) ? slug : url;
  } catch {
    return url;
  }
}

export function toCommonEventRow({ url, parsed, observedAt, todayLondon, publishedOn = null }) {
  if (!parsed || !nonEmptyString(url) || !nonEmptyString(parsed.title)) return null;
  if (isStaleCommonDate(parsed.dateText, todayLondon, publishedOn)) return null;
  const startsDate = commonStartsDate(parsed.dateText, todayLondon, publishedOn);
  if (!startsDate) return null;
  return {
    id: stableId("events-cm", url),
    placeName: parsed.placeName,
    kind: "event",
    startsDate,
    timeEvidence: COMMON_TIME_EVIDENCE,
    title: parsed.title,
    source: { label: COMMON_SOURCE.label, url },
    observedAt,
    confidence: "listed",
    sourceId: sourceIdFromUrl(url),
  };
}

function londonToday(nowMs = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(nowMs));
  const get = (type) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function serialiseFile(payload) {
  const meta = JSON.stringify({ ...payload, rows: undefined }, null, 2)
    .replace(/\n\}$/, "")
    .replace(/\s*"rows": undefined,?/, "");
  const rowLines = payload.rows.map((row) => `    ${JSON.stringify(row)}`).join(",\n");
  return payload.rows.length
    ? `${meta},\n  "rows": [\n${rowLines}\n  ]\n}\n`
    : `${meta},\n  "rows": []\n}\n`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchText(url, fetchImpl) {
  const res = await fetchImpl(url, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": COMMON_USER_AGENT,
    },
  });
  if (!res.ok) {
    await res.arrayBuffer();
    throw new Error(`Common fetch ${url} returned ${res.status}`);
  }
  return res.text();
}

export async function refreshCommonEvents({
  nowMs = Date.now(),
  fetchImpl = fetch,
  outPath = eventsOutputPath("london"),
  gapMs = COMMON_FETCH_GAP_MS,
  maxFetches = COMMON_MAX_FETCHES_PER_RUN,
  allowEmpty = false,
} = {}) {
  const observedAt = new Date(nowMs).toISOString();
  const todayLondon = londonToday(nowMs);

  let existing = {
    generatedAt: observedAt,
    kind: "events",
    region: "greater-london",
    sources: [],
    rows: [],
  };
  if (existsSync(outPath)) {
    try {
      existing = JSON.parse(readFileSync(outPath, "utf8"));
    } catch {
      // keep the empty shell
    }
  }
  const existingRows = Array.isArray(existing.rows) ? existing.rows : [];
  const kept = existingRows.filter((row) => row?.source?.label?.toLowerCase() !== "common");
  const existingCommonRows = existingRows.filter(
    (row) => row?.source?.label?.toLowerCase() === "common",
  );
  // A post we already hold a still-upcoming row for is not re-read: the OG
  // prefix cannot change the day it already stated, and re-reading it is the
  // whole of the unbounded cost.
  const heldByUrl = new Map();
  for (const row of existingRows) {
    if (row?.source?.label?.toLowerCase() !== "common") continue;
    if (!nonEmptyString(row?.source?.url)) continue;
    if (!nonEmptyString(row?.startsDate)) continue;
    if (row.startsDate < todayLondon) continue;
    heldByUrl.set(row.source.url, row);
  }

  const sitemap = await fetchText(COMMON_SITEMAP_URL, fetchImpl);
  const entries = parseCommonSitemapEntries(sitemap);
  const publishedByUrl = new Map();
  for (const entry of entries) {
    if (typeof entry.lastmod === "number") publishedByUrl.set(entry.url, londonToday(entry.lastmod));
  }
  const posts = commonCrawlOrder(entries);
  const rows = [];
  let droppedStale = 0;
  let droppedUnparseable = 0;
  let droppedFetch = 0;
  let reusedHeld = 0;
  let skippedOverBudget = 0;
  let fetched = 0;

  for (const url of posts) {
    const held = heldByUrl.get(url);
    if (held) {
      rows.push(held);
      reusedHeld += 1;
      continue;
    }
    if (fetched >= maxFetches) {
      skippedOverBudget += 1;
      continue;
    }
    if (fetched > 0 && gapMs > 0) await sleep(gapMs);
    fetched += 1;
    try {
      const html = await fetchText(url, fetchImpl);
      const parsed = parseCommonPostHtml(html);
      if (!parsed) {
        droppedUnparseable += 1;
        continue;
      }
      const row = toCommonEventRow({
        url,
        parsed,
        observedAt,
        todayLondon,
        publishedOn: publishedByUrl.get(url) ?? null,
      });
      if (!row) {
        droppedStale += 1;
        continue;
      }
      rows.push(row);
    } catch {
      droppedFetch += 1;
    }
  }

  // Fail closed, the way the provider lane already does. `fetchText` throws
  // only on a non-2xx, so a 200 that is a sitemap index, a renamed post path or
  // a challenge page parses to NO posts, reuses none of the rows the file
  // already holds, and would rewrite the file with the Common lane emptied -
  // silently, and straight into a review PR. A run that can see nothing is an
  // upstream fault rather than a city with nothing on, so it writes nothing.
  const refusalReason =
    rows.length === 0 && heldByUrl.size > 0
      ? `parsed 0 Common rows while the file holds ${heldByUrl.size} upcoming one(s)`
      : posts.length === 0 && existingCommonRows.length > 0
        ? "the sitemap listed no /post/ entry while the file holds Common rows"
        : null;
  if (refusalReason && !allowEmpty) {
    console.error(
      `commonRefresh: refusing to write ${outPath} - ${refusalReason}. ` +
        `Held rows are left in place (fetched ${fetched}, dropped fetch=${droppedFetch} ` +
        `unparseable=${droppedUnparseable}). Pass allowEmpty to override.`,
    );
    return {
      rows: [],
      wrote: false,
      refused: refusalReason,
      droppedStale,
      droppedUnparseable,
      droppedFetch,
      reusedHeld,
      skippedOverBudget,
      fetched,
    };
  }

  const merged = [...kept, ...rows];
  const sources = Array.isArray(existing.sources) ? existing.sources.filter((s) => s?.provider !== "common") : [];
  sources.push({
    ...COMMON_SOURCE,
    firstParty: false,
    provider: "common",
    rowsEmitted: rows.length,
    notes:
      "Common sitemap + OG prefix only. Place and date from the prefix; description text is never stored.",
  });
  const payload = {
    ...existing,
    // This run REGENERATES the file, so it stamps its own generatedAt. Keeping
    // the previous stamp while writing rows observed later makes every reader
    // (which dates the file by generatedAt) refuse those rows as future.
    generatedAt: observedAt,
    kind: existing.kind ?? "events",
    region: existing.region ?? "greater-london",
    sources,
    rows: merged,
  };
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, serialiseFile(payload));
  console.log(
    `commonRefresh: wrote ${rows.length} common rows into ${outPath} ` +
      `(kept ${kept.length} other; fetched ${fetched} reused ${reusedHeld} ` +
      `skipped-over-budget ${skippedOverBudget}; ` +
      `dropped stale=${droppedStale} unparseable=${droppedUnparseable} fetch=${droppedFetch})`,
  );
  return {
    rows,
    wrote: true,
    droppedStale,
    droppedUnparseable,
    droppedFetch,
    reusedHeld,
    skippedOverBudget,
    fetched,
  };
}

async function main() {
  try {
    const report = await refreshCommonEvents();
    if (report?.refused) process.exitCode = 1;
  } catch (err) {
    console.error(`commonRefresh: failed (${err.message}). Leaving events_london.json untouched.`);
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
void ROOT;
