// Editorial RSS overlay: allowlisted feeds, a tiny XML parse, excerpt cap,
// and dedup. The poller and the app both read this file so a second copy of
// the item shape cannot drift. Never store content:encoded or Atom content.

export const EDITORIAL_USER_AGENT = "PubmaxxBot/1.0 (+https://pubmaxxing.com)";
export const EDITORIAL_EXCERPT_MAX = 240;
export const EDITORIAL_BACKOFF_MS = 24 * 60 * 60 * 1000;
export const EDITORIAL_FETCH_TIMEOUT_MS = 15_000;
export const EDITORIAL_ITEM_KEYS = Object.freeze([
  "source_id",
  "title",
  "canonical_url",
  "published_at",
  "excerpt",
  "attribution_label",
]);

/** Live A+B feeds the captain named. ArtRabbit stays out. */
export const EDITORIAL_FEEDS = Object.freeze([
  {
    id: "deserter",
    name: "Deserter",
    url: "https://deserter.co.uk/feed/",
    site: "https://deserter.co.uk",
    cadenceHours: 84,
    licence: "rss-std",
  },
  {
    id: "enjoying-pubs",
    name: "Enjoying pubs",
    url: "https://enjoyingpubs.substack.com/feed",
    site: "https://enjoyingpubs.substack.com",
    cadenceHours: 84,
    licence: "rss-std",
  },
  {
    id: "leytonstoner",
    name: "Leytonstoner",
    url: "https://leytonstoner.substack.com/feed",
    site: "https://leytonstoner.substack.com",
    cadenceHours: 24,
    licence: "rss-std",
  },
  {
    id: "londonist-ttd",
    name: "Londonist Things To Do",
    url: "https://londonistlistings.substack.com/feed",
    site: "https://londonistlistings.substack.com",
    cadenceHours: 24,
    licence: "rss-std",
  },
  {
    id: "londonist",
    name: "Londonist",
    url: "https://londonist.com/feed",
    site: "https://londonist.com",
    cadenceHours: 12,
    licence: "rss-std",
  },
  {
    id: "timeout-london",
    name: "Time Out London",
    url: "https://www.timeout.com/london/feed.rss",
    site: "https://www.timeout.com/london",
    cadenceHours: 12,
    licence: "rss-std",
  },
  {
    id: "ianvisits-calendar",
    name: "ianVisits",
    url: "https://www.ianvisits.co.uk/calendar/feed/",
    site: "https://www.ianvisits.co.uk/calendar",
    cadenceHours: 24,
    licence: "rss-std",
  },
  {
    id: "ianvisits-articles",
    name: "ianVisits",
    url: "https://www.ianvisits.co.uk/articles/feed/",
    site: "https://www.ianvisits.co.uk",
    cadenceHours: 12,
    licence: "rss-std",
  },
  {
    id: "so-whats-the-sitch",
    name: "so what's the sitch",
    url: "https://sowhatsthesitch.substack.com/feed",
    site: "https://sowhatsthesitch.substack.com",
    cadenceHours: 24,
    licence: "rss-std",
  },
  {
    id: "secret-london",
    name: "Secret London",
    url: "https://secretldn.com/feed/",
    site: "https://secretldn.com",
    cadenceHours: 12,
    licence: "rss-std",
  },
  {
    id: "hot-dinners-features",
    name: "Hot Dinners",
    url: "https://www.hot-dinners.com/Features/?format=feed&type=rss",
    site: "https://www.hot-dinners.com",
    cadenceHours: 24,
    licence: "rss-std",
  },
  {
    id: "late-filing",
    name: "Late Filing",
    url: "https://latefiling.substack.com/feed",
    site: "https://latefiling.substack.com",
    cadenceHours: 24,
    licence: "rss-std",
  },
  {
    id: "wooden-city",
    name: "Wooden City",
    url: "https://woodencity.substack.com/feed",
    site: "https://woodencity.substack.com",
    cadenceHours: 84,
    licence: "rss-std",
  },
  {
    id: "gla-80117",
    name: "Greater London Authority",
    url: "https://www.london.gov.uk/rss-feeds/80117",
    site: "https://www.london.gov.uk",
    cadenceHours: 84,
    licence: "ogl",
  },
]);

function unwrapCdata(value) {
  return String(value).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

export function decodeXmlEntities(value) {
  const decodeCodePoint = (code, original) => {
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return "\ufffd";
    if (code === 8212 || code === 8211) return "-";
    try {
      return String.fromCodePoint(code);
    } catch {
      return original;
    }
  };
  return unwrapCdata(String(value))
    .replace(/&nbsp;/gi, " ")
    .replace(/&hellip;/gi, "...")
    .replace(/&mdash;|&ndash;|&minus;/gi, "-")
    .replace(/&rsquo;|&lsquo;|&apos;/gi, "'")
    .replace(/&rdquo;|&ldquo;|&quot;/gi, '"')
    .replace(/&#(\d+);/g, (original, digits) => {
      const code = Number(digits);
      return decodeCodePoint(code, original);
    })
    .replace(/&#x([0-9a-f]+);/gi, (original, hex) => {
      const code = parseInt(hex, 16);
      return decodeCodePoint(code, original);
    })
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\u2014|\u2013/g, "-");
}

function collapseSpace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function stripTags(value) {
  return collapseSpace(decodeXmlEntities(value).replace(/<[^>]+>/g, " ")).replace(
    /\s+([.,!?;:'")\]])/g,
    "$1",
  );
}

export function excerptFromDescription(raw) {
  if (typeof raw !== "string" || raw.length === 0) return "";
  const text = stripTags(raw);
  if (text.length <= EDITORIAL_EXCERPT_MAX) return text;
  return text.slice(0, EDITORIAL_EXCERPT_MAX);
}

function tagBlocks(xml, tag) {
  const re = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "gi");
  return xml.match(re) ?? [];
}

function innerTag(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = xml.match(re);
  return match ? unwrapCdata(match[1]) : "";
}

function tagAttr(xml, tag, attr) {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}\\s*=\\s*["']([^"']+)["'][^>]*/?>`, "i");
  const match = xml.match(re);
  return match ? match[1] : "";
}

export function canonicalEditorialUrl(raw) {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  try {
    const url = new URL(decodeXmlEntities(raw).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function publishedAtFromBlock(block) {
  const raw =
    innerTag(block, "pubDate") ||
    innerTag(block, "published") ||
    innerTag(block, "updated") ||
    innerTag(block, "dc:date");
  const ms = Date.parse(decodeXmlEntities(raw).trim());
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function linkFromBlock(block) {
  const textLink = innerTag(block, "link");
  if (textLink && !textLink.includes("<")) {
    return canonicalEditorialUrl(textLink);
  }
  const href = tagAttr(block, "link", "href");
  return canonicalEditorialUrl(href);
}

function titleFromBlock(block) {
  return collapseSpace(stripTags(innerTag(block, "title")));
}

function excerptFromBlock(block) {
  // Description / summary only. content:encoded and Atom <content> stay on the floor.
  const raw = innerTag(block, "description") || innerTag(block, "summary");
  return excerptFromDescription(raw);
}

export function storedEditorialItem(item, attributionLabel) {
  return {
    source_id: item.source_id,
    title: item.title,
    canonical_url: item.canonical_url,
    published_at: item.published_at,
    excerpt: item.excerpt,
    attribution_label: attributionLabel ?? item.attribution_label,
  };
}

function parseBlock(block, sourceId, attributionLabel) {
  const title = titleFromBlock(block);
  const canonical_url = linkFromBlock(block);
  const published_at = publishedAtFromBlock(block);
  if (!title || !canonical_url || !published_at) return null;
  return storedEditorialItem(
    {
      source_id: sourceId,
      title,
      canonical_url,
      published_at,
      excerpt: excerptFromBlock(block),
      attribution_label: attributionLabel,
    },
    attributionLabel,
  );
}

export function parseEditorialFeedXml(xml, sourceId) {
  const feed = EDITORIAL_FEEDS.find((row) => row.id === sourceId);
  const label = feed?.name ?? sourceId;
  const source = typeof xml === "string" ? xml : "";
  const itemBlocks = [...tagBlocks(source, "item"), ...tagBlocks(source, "entry")];
  const items = [];
  for (const block of itemBlocks) {
    const parsed = parseBlock(block, sourceId, label);
    if (parsed) items.push(parsed);
  }
  return { itemCount: itemBlocks.length, items };
}

function londonDay(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const value = (type) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function dedupeEditorialItems(items) {
  const byAge = [...items].sort(
    (left, right) => Date.parse(right.published_at) - Date.parse(left.published_at),
  );
  const seenUrl = new Set();
  const seenDay = new Set();
  const out = [];
  for (const item of byAge) {
    const url = canonicalEditorialUrl(item.canonical_url) ?? item.canonical_url;
    if (seenUrl.has(url)) continue;
    const dayKey = `${item.source_id}|${item.title}|${londonDay(item.published_at)}`;
    if (seenDay.has(dayKey)) continue;
    seenUrl.add(url);
    seenDay.add(dayKey);
    out.push({ ...item, canonical_url: url });
  }
  return out;
}

export function interpretEditorialResponse(status, itemCount) {
  if (status === 403 || status === 429) return { status: "backoff" };
  if (status === 304) return { status: "not-modified" };
  if (status === 200 && itemCount === 0) return { status: "degraded" };
  if (status === 200) return { status: "ready" };
  return { status: "degraded" };
}

export function feedIsDue(feed, feedState = {}, now = Date.now(), options = {}) {
  if (options.force) return true;
  if (typeof feedState.backoffUntil === "number" && feedState.backoffUntil > now) {
    return false;
  }
  if (typeof feedState.lastFetchedAt === "number") {
    const ageHours = (now - feedState.lastFetchedAt) / 3_600_000;
    if (ageHours < feed.cadenceHours) return false;
  }
  return true;
}

export function licenceForSource(sourceId) {
  return EDITORIAL_FEEDS.find((feed) => feed.id === sourceId)?.licence ?? "rss-std";
}

export function attributionLabelForSource(sourceId) {
  return EDITORIAL_FEEDS.find((feed) => feed.id === sourceId)?.name ?? null;
}
