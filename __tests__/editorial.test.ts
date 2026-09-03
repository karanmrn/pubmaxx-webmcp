import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EDITORIAL_DEGRADED_EMPTY_LINE,
  EDITORIAL_DEGRADED_LINE,
  EDITORIAL_EMPTY_LINE,
  EDITORIAL_ITEM_KEYS,
  EDITORIAL_OGL_ATTRIBUTION,
  EDITORIAL_OGL_URL,
  EDITORIAL_RAIL_TITLE,
  EDITORIAL_SNAPSHOT_MAX_AGE_MS,
  EDITORIAL_STALE_LINE,
  editorialOglMark,
  editorialOglAttributionForSource,
  editorialSnapshotIsStale,
  editorialThisWeekItems,
  editorialViaChip,
  parseEditorialSnapshot,
} from "@/lib/editorial";
import { EDITORIAL_PATH, loadEditorialSnapshot } from "@/lib/editorialLoader";
import {
  EDITORIAL_EXCERPT_MAX,
  EDITORIAL_FEEDS,
  EDITORIAL_USER_AGENT,
  decodeXmlEntities,
  dedupeEditorialItems,
  excerptFromDescription,
  parseEditorialFeedXml,
  storedEditorialItem,
} from "@/lib/editorialRss.mjs";

const ROOT = resolve(__dirname, "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

const sourceFiles = [
  ...walk(join(ROOT, "app")),
  ...walk(join(ROOT, "components")),
  ...walk(join(ROOT, "lib")),
  ...walk(join(ROOT, "scripts")),
];

const RSS_WITH_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Test</title>
    <item>
      <title><![CDATA[New taproom in Leyton]]></title>
      <link>https://example.com/taproom</link>
      <pubDate>Sat, 16 Aug 2026 09:00:00 GMT</pubDate>
      <description><![CDATA[<p>A short note about a <strong>new taproom</strong>.</p>]]></description>
      <content:encoded><![CDATA[<p>The FULL post that must never be stored or reprinted. Secret recipe. Private email hello@example.com.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

const EMPTY_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Empty</title></channel></rss>`;

const ATOM_WITH_CONTENT = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom</title>
  <entry>
    <title>Walk: Greenwich tunnels</title>
    <link href="https://example.com/walk" rel="alternate"/>
    <published>2026-08-16T08:00:00Z</published>
    <summary>A walk along the river.</summary>
    <content type="html">&lt;p&gt;The full Atom body that must never be stored.&lt;/p&gt;</content>
  </entry>
</feed>`;

describe("editorial overlay: allowlisted feeds only", () => {
  it("starts with the live A+B feeds the captain named, and no ArtRabbit", () => {
    const ids = EDITORIAL_FEEDS.map((feed) => feed.id);
    expect(ids).toEqual([
      "deserter",
      "enjoying-pubs",
      "leytonstoner",
      "londonist-ttd",
      "londonist",
      "timeout-london",
      "ianvisits-calendar",
      "ianvisits-articles",
      "so-whats-the-sitch",
      "secret-london",
      "hot-dinners-features",
      "late-filing",
      "wooden-city",
      "gla-80117",
    ]);
    expect(EDITORIAL_FEEDS.some((feed) => /artrabbit/i.test(feed.url))).toBe(false);
    expect(EDITORIAL_FEEDS.some((feed) => /artrabbit/i.test(feed.id))).toBe(false);
    const gla = EDITORIAL_FEEDS.find((feed) => feed.id === "gla-80117");
    expect(gla?.licence).toBe("ogl");
    expect(gla?.url).toBe("https://www.london.gov.uk/rss-feeds/80117");
  });

  it("names PUBMAXXING in the poller UA with a contact URL", () => {
    expect(EDITORIAL_USER_AGENT).toBe("PubmaxxBot/1.0 (+https://pubmaxxing.com)");
  });
});

describe("editorial overlay: excerpt cap and no republication", () => {
  it("does not throw on numeric entities outside Unicode range", () => {
    expect(() => decodeXmlEntities("Bad &#x110000; and &#99999999; entities")).not.toThrow();
    expect(decodeXmlEntities("Bad &#x110000; and &#99999999; entities")).toContain("\ufffd");
  });

  it("strips tags and hard-caps at 240 characters", () => {
    const long = `<p>${"word ".repeat(80)}</p>`;
    const excerpt = excerptFromDescription(long);
    expect(excerpt.includes("<")).toBe(false);
    expect(excerpt.length).toBe(EDITORIAL_EXCERPT_MAX);
    expect(EDITORIAL_EXCERPT_MAX).toBe(240);
  });

  it("decodes leftover HTML entities and never keeps an em dash", () => {
    expect(excerptFromDescription("Mayfair &amp; Queen's Park. Read More &hellip;")).toBe(
      "Mayfair & Queen's Park. Read More...",
    );
    expect(excerptFromDescription("A night out &mdash; later")).toBe("A night out - later");
  });

  it("takes the RSS description and drops content:encoded on the floor", () => {
    const parsed = parseEditorialFeedXml(RSS_WITH_BODY, "leytonstoner");
    expect(parsed.itemCount).toBe(1);
    expect(parsed.items).toHaveLength(1);
    const item = storedEditorialItem(parsed.items[0]!, "Leytonstoner");
    expect(item.excerpt).toBe("A short note about a new taproom.");
    expect(JSON.stringify(item)).not.toMatch(/FULL post/);
    expect(JSON.stringify(item)).not.toMatch(/Secret recipe/);
    expect(JSON.stringify(item)).not.toMatch(/hello@example.com/);
    expect(Object.keys(item).sort()).toEqual([...EDITORIAL_ITEM_KEYS].sort());
  });

  it("takes Atom summary and never Atom content", () => {
    const parsed = parseEditorialFeedXml(ATOM_WITH_CONTENT, "ianvisits-calendar");
    expect(parsed.items[0]?.excerpt).toBe("A walk along the river.");
    expect(JSON.stringify(parsed.items)).not.toMatch(/full Atom body/);
  });
});

describe("editorial overlay: dedup", () => {
  it("keeps one row per canonical URL", () => {
    const items = dedupeEditorialItems([
      {
        source_id: "hot-dinners-features",
        title: "Openings",
        canonical_url: "https://www.hot-dinners.com/Features/openings",
        published_at: "2026-08-16T09:00:00.000Z",
        excerpt: "First",
        attribution_label: "Hot Dinners",
      },
      {
        source_id: "hot-dinners-features",
        title: "Openings, rewritten",
        canonical_url: "https://www.hot-dinners.com/Features/openings#comments",
        published_at: "2026-08-17T09:00:00.000Z",
        excerpt: "Second",
        attribution_label: "Hot Dinners",
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.excerpt).toBe("Second");
  });

  it("keeps one row per source, title and London day when the URL rotates", () => {
    const items = dedupeEditorialItems([
      {
        source_id: "hot-dinners-features",
        title: "London restaurant openings",
        canonical_url: "https://www.hot-dinners.com/Features/openings?v=1",
        published_at: "2026-08-16T09:00:00.000Z",
        excerpt: "Monday",
        attribution_label: "Hot Dinners",
      },
      {
        source_id: "hot-dinners-features",
        title: "London restaurant openings",
        canonical_url: "https://www.hot-dinners.com/Features/openings?v=2",
        published_at: "2026-08-16T18:00:00.000Z",
        excerpt: "Monday evening",
        attribution_label: "Hot Dinners",
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]?.excerpt).toBe("Monday evening");
  });
});

describe("editorial overlay: degraded reads are not empty", () => {
  it("treats a parsed channel with no items as a degraded feed, not an empty city", () => {
    const parsed = parseEditorialFeedXml(EMPTY_RSS, "timeout-london");
    expect(parsed.itemCount).toBe(0);
    expect(parsed.items).toEqual([]);
  });

  it("names a missing or unreadable snapshot degraded, never ready with zero picks", () => {
    expect(parseEditorialSnapshot(null).status).toBe("degraded");
    expect(parseEditorialSnapshot(null).items).toEqual([]);
    expect(parseEditorialSnapshot({ version: 1 }).status).toBe("degraded");
  });

  it("reads the static overlay path and degrades when the browser fetch cannot run", async () => {
    expect(EDITORIAL_PATH).toBe("/data/editorial/latest.json");
    const snapshot = await loadEditorialSnapshot();
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.items).toEqual([]);
  });

  it("keeps a ready snapshot with no this-week rows as an honest empty, not a failed read", () => {
    const snapshot = parseEditorialSnapshot({
      version: 1,
      generatedAt: "2026-08-16T10:00:00.000Z",
      status: "ready",
      items: [
        {
          source_id: "deserter",
          title: "Last month's crawl",
          canonical_url: "https://deserter.co.uk/old",
          published_at: "2026-07-01T12:00:00.000Z",
          excerpt: "A crawl.",
          attribution_label: "Deserter",
        },
      ],
    });
    expect(snapshot.status).toBe("ready");
    const week = editorialThisWeekItems(snapshot, Date.parse("2026-08-16T12:00:00.000Z"));
    expect(week).toEqual([]);
  });

  it("strips extra stored keys so a body cannot ride in on a future poll", () => {
    const snapshot = parseEditorialSnapshot({
      version: 1,
      generatedAt: "2026-08-16T10:00:00.000Z",
      status: "ready",
      items: [
        {
          source_id: "leytonstoner",
          title: "Point Taproom",
          canonical_url: "https://leytonstoner.substack.com/p/point",
          published_at: "2026-08-16T09:00:00.000Z",
          excerpt: "A new tap.",
          attribution_label: "Leytonstoner",
          body: "The full post",
          "content:encoded": "<p>nope</p>",
        },
      ],
    });
    expect(snapshot.items).toHaveLength(1);
    expect(Object.keys(snapshot.items[0]!).sort()).toEqual([...EDITORIAL_ITEM_KEYS].sort());
    expect(JSON.stringify(snapshot.items)).not.toMatch(/full post/i);
  });

  it("rejects a snapshot row that credits a different publisher", () => {
    const snapshot = parseEditorialSnapshot({
      version: 1,
      generatedAt: "2026-08-16T10:00:00.000Z",
      status: "ready",
      items: [
        {
          source_id: "gla-80117",
          title: "Diwali on the Square",
          canonical_url: "https://www.london.gov.uk/events/diwali",
          published_at: "2026-08-16T09:00:00.000Z",
          excerpt: "A civic night.",
          attribution_label: "A different publisher",
        },
      ],
    });
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.items).toEqual([]);
  });

  it("degrades a ready snapshot when it drops malformed rows", () => {
    const snapshot = parseEditorialSnapshot({
      version: 1,
      generatedAt: "2026-08-16T10:00:00.000Z",
      status: "ready",
      items: [
        {
          source_id: "deserter",
          title: "Valid row",
          canonical_url: "https://deserter.co.uk/valid",
          published_at: "2026-08-16T09:00:00.000Z",
          excerpt: "A valid row.",
          attribution_label: "Deserter",
        },
        { source_id: "deserter", title: "Missing URL" },
      ],
    });
    expect(snapshot.status).toBe("degraded");
    expect(snapshot.items).toHaveLength(1);
  });

  it("keeps a valid empty ready snapshot distinct from a stale snapshot", () => {
    expect(EDITORIAL_SNAPSHOT_MAX_AGE_MS).toBe(48 * 60 * 60 * 1000);
    const now = Date.parse("2026-08-18T12:00:00.000Z");
    const fresh = parseEditorialSnapshot({
      version: 1,
      generatedAt: "2026-08-18T10:00:00.000Z",
      status: "ready",
      items: [],
    });
    const old = parseEditorialSnapshot({
      version: 1,
      generatedAt: "2026-08-15T10:00:00.000Z",
      status: "ready",
      items: [],
    });
    expect(editorialSnapshotIsStale(fresh, now)).toBe(false);
    expect(editorialSnapshotIsStale(old, now)).toBe(true);
    expect(EDITORIAL_STALE_LINE).toBe("No fresh picks to show just now.");
  });

  it("a shipped overlay file never stores a body or extra keys", () => {
    const path = join(ROOT, "public/data/editorial/latest.json");
    if (!existsSync(path)) return;
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      status?: string;
      items?: Array<Record<string, unknown>>;
    };
    expect("state" in data).toBe(false);
    expect(["ready", "degraded"]).toContain(data.status);
    expect(Array.isArray(data.items)).toBe(true);
    for (const item of data.items ?? []) {
      expect(Object.keys(item).sort()).toEqual([...EDITORIAL_ITEM_KEYS].sort());
      expect(String(item.excerpt).length).toBeLessThanOrEqual(EDITORIAL_EXCERPT_MAX);
      expect(JSON.stringify(item)).not.toMatch(/content:encoded/i);
    }
  });
});

describe("editorial overlay: copy", () => {
  it("credits a link-out rail, never an observation PUBMAXX made", () => {
    expect(EDITORIAL_RAIL_TITLE).toBe("Also picked this week");
    expect(editorialViaChip("Deserter")).toBe("via Deserter");
    expect(editorialOglMark("ogl")).toBe("OGL");
    expect(editorialOglMark("rss-std")).toBeNull();
    expect(editorialOglAttributionForSource("gla-80117")).toEqual({
      label: EDITORIAL_OGL_ATTRIBUTION,
      url: EDITORIAL_OGL_URL,
    });
    expect(editorialOglAttributionForSource("deserter")).toBeNull();
    expect(EDITORIAL_OGL_ATTRIBUTION).toBe(
      "Contains public sector information licensed under the Open Government Licence v3.0.",
    );
    expect(EDITORIAL_OGL_URL).toBe(
      "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/",
    );
    expect(EDITORIAL_EMPTY_LINE).toBe("No picks this week.");
    expect(EDITORIAL_DEGRADED_LINE).toBe("Some picks could not be checked.");
    expect(EDITORIAL_DEGRADED_EMPTY_LINE).toBe("Picks could not be checked.");
    const copy = [
      EDITORIAL_RAIL_TITLE,
      EDITORIAL_EMPTY_LINE,
      EDITORIAL_DEGRADED_LINE,
      EDITORIAL_DEGRADED_EMPTY_LINE,
    ].join(" ");
    expect(copy).not.toMatch(/observed/i);
    expect(copy).not.toMatch(/starts? at/i);
  });
});

describe("editorial overlay: import fence", () => {
  it("is not reached from the map canvas or the harvest policy", () => {
    const forbidden = [
      "components/map",
      "components/PubMap.tsx",
      "lib/harvest",
    ];
    for (const file of sourceFiles) {
      const rel = relative(ROOT, file);
      if (rel.startsWith("lib/editorial") || rel.startsWith("scripts/editorial")) continue;
      if (!forbidden.some((prefix) => rel.startsWith(prefix))) continue;
      const source = readFileSync(file, "utf8");
      expect(source, `${rel} must not import the editorial overlay`).not.toMatch(
        /editorialRss|@\/lib\/editorial/,
      );
    }
  });

  it("does not reuse harvest sourcePolicy", () => {
    const overlay = sourceFiles.filter((file) => {
      const rel = relative(ROOT, file);
      return rel.startsWith("lib/editorial") || rel.startsWith("scripts/editorial");
    });
    expect(overlay.length).toBeGreaterThan(0);
    for (const file of overlay) {
      expect(readFileSync(file, "utf8")).not.toMatch(/sourcePolicy/);
    }
  });
});
